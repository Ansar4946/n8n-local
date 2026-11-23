/*__QA__*/
const ctx = $('📋 Parse Plan').first().json;
const raw = $json || {};
let text = '';
if (typeof raw.text === 'string') text = raw.text;
else if (typeof raw.output === 'string') text = raw.output;
else if (typeof raw.output === 'object' && raw.output) {
  return [{ json: { ...ctx, critique: raw.output, approved: Boolean(raw.output.approved), ...raw.output, phase_status: 'CRITIQUE_PARSED' } }];
}
if (!text) throw new Error('Critique Draft returned no text output');
text = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
let critique = null;
try { critique = JSON.parse(text); }
catch (e) { const a = text.indexOf('{'); const b = text.lastIndexOf('}'); if (a >= 0 && b > a) { try { critique = JSON.parse(text.slice(a, b + 1)); } catch (e2) {} } }
if (!critique) { const fixKeys = s => s.replace(/(^\s*|[,{]\s*)[^"\s{},:\[\]]*?(\w+)"\s*:/gm, '$1"$2":'); for (const cand of [text, text.slice(Math.max(0, text.indexOf('{')), text.lastIndexOf('}') + 1)]) { try { critique = JSON.parse(fixKeys(cand)); break; } catch (e5) {} } }
if (!critique) throw new Error('Could not parse critique JSON. Raw: ' + text.slice(0, 500));

// ---- the latest draft HTML (the critic model cannot count words or check rules, code does) ----
let draftHtml = '';
try {
  const d = $('✍️ Write Draft').first().json || {};
  if (d.output && typeof d.output === 'object') draftHtml = String(d.output.article || '');
  else {
    let t = String(typeof d.text === 'string' ? d.text : (d.output || '')).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let p = null;
    try { p = JSON.parse(t); } catch (e) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { p = JSON.parse(t.slice(a, b + 1)); } catch (e2) {} } }
    if (p && typeof p.article === 'string') draftHtml = p.article;
    else { const m = t.match(/"article"\s*:\s*"([\s\S]*)"/); if (m) draftHtml = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"'); }
  }
} catch (e) {}

// ---- deterministic quality gate (word limits, H2 max, H3, tables, lists, paragraph size, passive voice,
// ---- transition words, 3 headings with the same start, focus keyword placement) ----
const wcRange = ctx.writer_context?.wordCountRange || { min: 1200, max: 1630 };
const cfgQ = $('⚙️ Config').first().json;
let qa = null;
let draftWords = 0;
if (draftHtml) {
  draftHtml = qaFixH1Keyword(draftHtml, ctx.writer_context?.primaryKeyword || ctx.keyword);
  draftHtml = qaFixIntroKeyword(draftHtml, ctx.writer_context?.primaryKeyword || ctx.keyword); // same repair as in Validate Article, so the draft gate does not reject what code fixes anyway
  qa = qaMetrics(draftHtml, {
    primaryKeyword: ctx.writer_context?.primaryKeyword || ctx.keyword,
    title: ctx.h1_title,
    minWords: Math.round(Number(wcRange.min) * 0.92),
    densityMin: Number(cfgQ.kw_density_min || 2), densityMax: Number(cfgQ.kw_density_max || 2.5), densityWordsAdd: Number(cfgQ.faq_word_budget || 350) + 150, // the FAQ and quick info are added after the draft
    maxWords: Number(wcRange.max),
    maxH2: Number(cfgQ.h2_max || 8) - 1, // the FAQ H2 is added after the draft
    minH3: Number(cfgQ.h3_min || 2),
    maxParagraphWords: Number(cfgQ.max_paragraph_words || 300),
    maxPassivePct: Number(cfgQ.max_passive_pct || 10),
    minTransitionPct: Number(cfgQ.min_transition_pct || 35)
  });
  draftWords = qa.words;
  const softGate = ['passive', 'transitions', 'tables', 'h3-present', 'lists', 'bold', 'kw-conclusion', 'conclusion-lines', 'kw-density'];
  const gate = qa.checks.filter(c => c.pass === false && (c.hard || softGate.includes(c.id)));
  if (gate.length) {
    critique.approved = false;
    critique.qa_gate_failed = gate.map(c => c.id);
    critique.issues = [...(Array.isArray(critique.issues) ? critique.issues : []), ...gate.map(c => c.id + ': ' + c.detail)];
    critique.rewrite_instructions = 'MECHANICAL FIXES (measured by code, not opinion; the next draft is measured again): ' + gate.map(c => c.fix).join(' ') + ' Keep everything that is already good, and keep the word count between ' + wcRange.min + ' and ' + wcRange.max + '. ' + (critique.rewrite_instructions || '');
  }
}

let retriesDone = 0;
retriesDone = $runIndex;
const maxRetriesAllowed = Number($('⚙️ Config').first().json.max_retries || 2);
if (!critique.approved && retriesDone >= maxRetriesAllowed) { critique.approved = true; critique.critic_override = true; }

return [{ json: { ...ctx, ...critique, critique, approved: Boolean(critique.approved), draft_article_html: draftHtml, draft_word_count: draftWords, draft_qa: qa ? { words: qa.words, h2: qa.h2, h3: qa.h3, tables: qa.tables, passivePct: qa.passivePct, transitionPct: qa.transitionPct, maxParagraphWords: qa.maxParagraphWords, failed: qa.checks.filter(c => c.pass === false).map(c => c.id) } : null, phase_status: 'CRITIQUE_PARSED' } }];
