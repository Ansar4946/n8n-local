/*
 * Switches the SEO Blog Automation workflow from Gemini to the OpenAI API and cuts token waste.
 *   node scripts/apply-openai-switch.js
 * Reads the workflow JSON, writes a backup to scripts/backup/, and patches the JSON in place.
 * Safe to run once. It stops if it finds the workflow already patched.
 *
 * Model choice (official OpenAI docs, prices per 1M tokens input/output):
 *   gpt-6-luna    $0.10 / $0.50   keyword pick (data choice, code checks it)
 *   gpt-6.2-sol   $2.00 / $10.00  FAQ, plan, writer (quality steps)
 * temperature is NOT sent: the docs do not list it for these reasoning models.
 * Reasoning tokens are billed as output, so reasoning_effort is kept low and every call has a hard token cap.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json');
const BACKUP = path.join(__dirname, 'backup', 'workflow-before-openai-switch.json');

const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (wf.nodes.some(n => n.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi')) {
  console.error('Already patched (an OpenAI model node exists). Nothing changed.');
  process.exit(1);
}
fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
fs.writeFileSync(BACKUP, fs.readFileSync(FILE));

const byName = n => wf.nodes.find(x => x.name === n);
const must = (n) => { const x = byName(n); if (!x) throw new Error('Node not found: ' + n); return x; };

// ---------------------------------------------------------------- 1. OpenAI model nodes
// [old Gemini node name, new name, model id, reasoning effort, max completion tokens (includes reasoning tokens)]
const MODELS = [
  ['Google Gemini Chat Model',   'OpenAI Keyword Model (Luna)',  'gpt-6-luna',  'none', 2000],
  ['🤖 Gemini FAQ Model',        '🤖 OpenAI FAQ Model (Sol)',    'gpt-6.2-sol', 'low',  3500],
  ['🧠 Gemini Pro (Planner)',    '🧠 OpenAI Planner (Sol)',      'gpt-6.2-sol', 'low',  8000],
  ['✍️ Gemini Writer Model',     '✍️ OpenAI Writer (Sol)',       'gpt-6.2-sol', 'low',  12000]
];
const renamed = {};
for (const [oldName, newName, model, effort, cap] of MODELS) {
  const n = must(oldName);
  n.type = '@n8n/n8n-nodes-langchain.lmChatOpenAi';
  n.typeVersion = 1.2;
  n.name = newName;
  n.parameters = {
    model: { __rl: true, value: model, mode: 'id' },
    // n8n sends options.maxTokens as max_tokens, which these models reject, and its reasoningEffort option drops "none".
    // Extra Body goes straight into the request, so use it for both.
    options: { extraBody: JSON.stringify({ max_completion_tokens: cap, reasoning_effort: effort }) }
  };
  n.credentials = { openAiApi: { id: 'Xb6nmFmi5Ty5MJGK', name: 'OpenAI account' } };
  renamed[oldName] = newName;
  wf.connections[newName] = wf.connections[oldName];
  delete wf.connections[oldName];
}

// ---------------------------------------------------------------- 2. remove the AI critic call
// The code gate in "Parse Critique" already measures words, headings, tables, lists, passive voice,
// transition words, paragraph size and keyword placement. The AI critic only added ~6,000 input tokens per draft.
const CRITIC_NODE = '🔍 Critique Draft';
const CRITIC_MODEL = '🔍 Gemini Pro (Critic)';
must(CRITIC_NODE); must(CRITIC_MODEL);
wf.nodes = wf.nodes.filter(n => n.name !== CRITIC_NODE && n.name !== CRITIC_MODEL);
delete wf.connections[CRITIC_NODE];
delete wf.connections[CRITIC_MODEL];
wf.connections['✍️ Write Draft'] = { main: [[{ node: 'Parse Critique', type: 'main', index: 0 }]] };

// Parse Critique: no AI text to parse any more, start from an approved verdict and let the code gate decide.
{
  const n = must('Parse Critique');
  const start = n.parameters.jsCode.indexOf("const raw = $json || {};");
  const endMarker = "if (!critique) throw new Error('Could not parse critique JSON. Raw: ' + text.slice(0, 500));";
  const end = n.parameters.jsCode.indexOf(endMarker);
  if (start < 0 || end < 0) throw new Error('Parse Critique layout changed, patch aborted');
  n.parameters.jsCode =
    n.parameters.jsCode.slice(0, start) +
    "// No AI critic call any more (saves ~6,000 input tokens per draft). The code gate below decides.\n" +
    "let critique = { approved: true, scores: {}, issues: [], rewrite_instructions: '' };\n" +
    n.parameters.jsCode.slice(end + endMarker.length);
}

// ---------------------------------------------------------------- 3. Config: one retry, no unused Gemini keys
{
  const n = must('⚙️ Config');
  let c = n.parameters.jsCode;
  c = c.replace('max_retries: 3,', 'max_retries: 1,');
  c = c.replace(/    gemini_planner_model: .*\n    gemini_writer_model: .*\n    gemini_critic_model: .*\n    gemini_faq_model: .*\n    gemini_image_model: .*\n/,
    '    openai_keyword_model: "gpt-6-luna",\n    openai_faq_model: "gpt-6.2-sol",\n    openai_planner_model: "gpt-6.2-sol",\n    openai_writer_model: "gpt-6.2-sol",\n');
  if (!c.includes('max_retries: 1') || !c.includes('openai_writer_model')) throw new Error('Config patch failed');
  n.parameters.jsCode = c;
}

// ---------------------------------------------------------------- 4. Write Draft prompt
{
  const n = must('✍️ Write Draft');
  let t = n.parameters.text;
  const endTag = "' : '' }}";
  const e = t.indexOf(endTag);
  if (!t.startsWith('={{ $json.__retry') || e < 0) throw new Error('Write Draft prompt layout changed');
  const retryExpr = t.slice(1, e + endTag.length);          // the {{ ... }} retry block
  let rest = t.slice(e + endTag.length);                    // the static prompt
  // Prompt caching: OpenAI caches an identical prompt prefix. Keep all static text and the plan first,
  // and put the retry block (the only part that changes on a retry) at the very end.
  const anchor = 'product/concept = how it works, specs table, pros and cons, a clear verdict.';
  if (!rest.includes(anchor)) throw new Error('Niche rules anchor not found');
  rest = rest.replace(anchor, anchor +
    '\nHEALTH / FINANCE (YMYL): general educational information only, no diagnosis, no personal advice, no promised results or returns, no miracle or "guaranteed" wording. Give a figure only if it is in the research and name its source. In the conclusion add one plain sentence that this is not medical or financial advice and the reader should ask a qualified professional.' +
    '\nNEWS: the first paragraph answers who, what, when and where with the exact dates from the research. Attribute every claim to a named source, separate confirmed facts from reports, and never speculate.');
  n.parameters.text = '=' + rest.replace(/\s+$/, '') + '\n\n' + retryExpr;
}

// ---------------------------------------------------------------- 5. Plan prompt: same niche coverage
{
  const n = must('🎯 Plan Article');
  const anchor = '- TECHNOLOGY (article_type product or concept)';
  if (!n.parameters.text.includes(anchor)) throw new Error('Plan prompt anchor not found');
  n.parameters.text = n.parameters.text.replace(anchor,
    '- HEALTH / FINANCE (YMYL, article_type concept or howto): educational and cautious. Typical order: plain definition, causes or how it works, options or steps, risks and who should see a professional, common mistakes, Conclusion. Plan facts only from the research, name the source for any figure, no promised results.\n' +
    '- NEWS (article_type concept): what happened (who, what, when, where), why it matters, background, what happens next, Conclusion. Use exact dates from the research.\n' +
    anchor);
}

// ---------------------------------------------------------------- 6. Em/en dash cleanup in code (free) instead of a paid rewrite
{
  const n = must('📥 Parse Article');
  const marker = "return [{ json: { ...ctx, article_json: parsed, article: parsed,";
  if (!n.parameters.jsCode.includes(marker)) throw new Error('Parse Article layout changed');
  n.parameters.jsCode = n.parameters.jsCode.replace(marker,
    "if (parsed && typeof parsed.article === 'string') parsed.article = parsed.article.replace(/\\s*(?:\\u2014|&mdash;|&#8212;)\\s*/g, ', ').replace(/(?:\\u2013|&ndash;|&#8211;)/g, '-');\n" + marker);
}

// ---------------------------------------------------------------- 7. Title
wf.name = 'SEO Blog Automation V7.4 - OpenAI Low-Token';

fs.writeFileSync(FILE, JSON.stringify(wf, null, 2));
console.log('Patched. Backup: ' + BACKUP);
console.log('Renamed model nodes:', renamed);
