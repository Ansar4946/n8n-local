/*
 * Applies the 15 blog-quality rules to "SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json".
 *   node scripts/apply-quality-rules.js
 * A backup copy is written to scripts/backup/ first. The script is strict: if a text marker it expects is
 * missing from the workflow it stops with an error instead of guessing.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const F = path.join(ROOT, "SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json");
const QA_SRC = fs.readFileSync(path.join(ROOT, "validation", "qa-metrics.js"), "utf8").split("//__EXPORTS__")[0];
const code = (name) => fs.readFileSync(path.join(__dirname, "node-code", name), "utf8").replace("/*__QA__*/", QA_SRC);

// Always patch the ORIGINAL workflow (kept as a backup the first time), so running this script again gives the same result.
const BACKUP = path.join(__dirname, "backup", "workflow-before-quality-rules.json");
fs.mkdirSync(path.join(__dirname, "backup"), { recursive: true });
if (!fs.existsSync(BACKUP)) fs.copyFileSync(F, BACKUP);

const w = JSON.parse(fs.readFileSync(BACKUP, "utf8"));
const N = (n) => { const x = w.nodes.find((y) => y.name === n); if (!x) throw new Error("missing node: " + n); return x; };
const rep = (s, from, to) => {
  const c = s.split(from).length - 1;
  if (c !== 1) throw new Error("marker found " + c + " times (need exactly 1): " + from.slice(0, 90));
  return s.split(from).join(to);
};
const between = (s, start, end, to) => {
  const a = s.indexOf(start);
  if (a < 0) throw new Error("start marker missing: " + start.slice(0, 80));
  const b = s.indexOf(end, a);
  if (b < 0) throw new Error("end marker missing: " + end.slice(0, 80));
  return s.slice(0, a) + to + s.slice(b + end.length);
};
const setCode = (name, text) => { N(name).parameters.jsCode = text; };
const edit = (name, fn) => { N(name).parameters.jsCode = fn(N(name).parameters.jsCode); };
const editText = (name, fn) => { N(name).parameters.text = fn(N(name).parameters.text); };

/* ============ Config: limits for every rule ============ */
edit("⚙️ Config", (c) => {
  c = rep(c, "article_min_words: 2500,", "article_min_words: 1500,");
  c = rep(c, "article_max_words: 3200,", "article_max_words: 2000,");
  c = rep(c, "meta_min_chars: 140,", "meta_min_chars: 120,");
  c = rep(c, "meta_max_chars: 160,", "meta_max_chars: 150,");
  c = rep(c, "faq_count: 6,", "faq_count: 6 + Math.floor(Math.random() * 3), // 6, 7 or 8 FAQs, random for every blog");
  c = rep(c, "h2_max: 8,", "h2_max: 8,\n    h3_min: 2,\n    max_paragraph_words: 300,\n    max_passive_pct: 10,\n    min_transition_pct: 35,\n    kw_density_min: 2,\n    kw_density_max: 2.5,\n    conclusion_min_sentences: 6,\n    max_images: 4,\n    faq_word_budget: 350,");
  return c;
});

/* ============ Word budget for the writer (point 4: max 2000 words in total) ============ */
edit("📋 Build Brief Input", (c) => between(c, "const cfgW =", "const target = Math.round((safeMin + safeMax) / 2);",
  "const cfgW = $('⚙️ Config').first().json;\n" +
  "const totalMax = Number(cfgW.article_max_words || 2000);\n" +
  "const totalMin = Number(cfgW.article_min_words || 1500);\n" +
  "const faqBudget = Number(cfgW.faq_word_budget || 350);\n" +
  "// the FAQ block, quick-info table and link sentences are added after the writer, so the body gets what is left\n" +
  "const safeMax = Math.max(900, totalMax - faqBudget - 120);\n" +
  "const safeMin = Math.max(800, Math.min(safeMax - 150, totalMin - faqBudget + 50));\n" +
  "const target = Math.round((safeMin + safeMax) / 2 + 40);"));

/* ============ Planner prompt ============ */
editText("🎯 Plan Article", (t) => {
  t = rep(t, "2. Choose 7-9 H2 headings (the article must reach {{ $json.writer_context.wordCountRange.min }}+ words, so plan enough sections for real depth, never fluff).",
    "2. Choose 5 or 6 content H2 headings plus the final H2 whose title starts with the word Conclusion (6-7 H2 in total; the FAQ H2 is added later, so the finished article has at most 8 H2). The whole article including the FAQ must stay between {{ $json.writer_context.wordCountRange.min }} and {{ $json.writer_context.wordCountRange.max }} words (hard limit: 2000 words in total), so plan compact, useful sections with no fluff.");
  t = rep(t, "3. For EACH H2 provide:",
    "HEADING AND SEO RULES (checked by code after writing):\n" +
    "- NO three headings (H2 and H3 together) may start with the same first word. Vary the openings (a verb, a number, a noun, a question word, a name).\n" +
    "- Every section with target_words of 200 or more gets 2 H3 sub-headings in the field h3. H3 texts must be specific, and they follow the same no-same-start rule.\n" +
    "- The EXACT primary keyword must appear in the H1, in at least one H2, and in the meta title. The meta title is 50-60 characters with the keyword near the start. The meta description is 120-150 characters (NEVER more than 150) with the keyword.\n" +
    "- TABLES: plan one table for roughly every 700 words of article (at least 1, at most 3) and give those sections the format table or comparison.\n" +
    "- slug: 3 to 6 lowercase words separated by hyphens, built from the primary keyword.\n" +
    "3. For EACH H2 provide:");
  t = rep(t, "5. Write a meta description (140-160 chars) with the primary keyword and a reason to click.", "5. Write a meta description (120-150 chars, NEVER more than 150) with the exact primary keyword and a reason to click.");
  t = rep(t, '"meta_title": "...",', '"meta_title": "50-60 characters with the exact primary keyword near the start",');
  t = rep(t, '"meta_description": "...",', '"meta_description": "120-150 characters with the exact primary keyword",');
  t = rep(t, '"keywords": ["..."], "target_words": 250 }', '"keywords": ["..."], "h3": ["H3 sub-heading 1", "H3 sub-heading 2"], "target_words": 220 }');
  t = rep(t, '"total_planned_words": 2800', '"total_planned_words": {{ $json.writer_context.targetWordCount }}');
  return t;
});

/* ============ Keyword choice: the primary keyword must read naturally ============ */
editText("Select Primary Keyword", (t) => rep(t, "- Do NOT substitute a keyword that is not in the provided list.",
  "- Do NOT substitute a keyword that is not in the provided list.\n- The primary keyword must read as a NATURAL English phrase that can sit in a headline. When two variants of the same keyword exist (for example \"hurricane isaias\" and \"isaias hurricane\"), choose the natural word order, even if the reversed variant has a little more volume."));

/* ============ Writer prompt ============ */
editText("✍️ Write Draft", (t) => {
  t = between(t, "LENGTH: write an in-depth", "never from padding or repetition.",
    "LENGTH (HARD LIMITS, measured by code): the article body must have between {{ $json.writer_context.wordCountRange.min }} and {{ $json.writer_context.wordCountRange.max }} words. NEVER go above {{ $json.writer_context.wordCountRange.max }} words: the FAQ, the quick-info table and the links are added afterwards and need about 370 words of room under the 2000-word limit. Aim for about {{ $json.total_planned_words }}. Keep every H2 section focused (about 150-250 words). Depth comes from specifics, examples, numbers and steps, never from padding or repetition.");
  t = rep(t, "Use <h3> sub-headings in long sections.", "Write the H3 sub-headings listed in each plan section (field h3) as <h3>; every section of 200+ words gets 2 H3. You write at most 7 H2 (the FAQ H2 is added later, so the final article has at most 8).");
  t = rep(t, "- Intro of 2-3 short paragraphs (~100 words) that opens with the plan's hook, says what the reader will learn, and uses the primary keyword within the first 100 words.",
    "- Intro of 2-3 short paragraphs (~100 words) that opens with the plan's hook, says what the reader will learn, and uses the EXACT primary keyword within the first 100 words. The FIRST SENTENCE of the first paragraph MUST contain the exact primary keyword word for word (write a natural opening sentence around it).\n- Right after the intro add the bold lead-in <p><strong>Key takeaways at a glance:</strong></p> followed by a <ul> with 3-4 short bullet points (this is not a heading).");
  t = rep(t, "- Use rich formatting wherever it helps: <ul>/<ol> lists, at least one <table> (with <thead>/<tbody>) for comparisons or key numbers, a <blockquote> for a key insight or expert-style takeaway, and <strong> for important terms.",
    "- FORMATTING: use bullet points (<ul>) or numbered steps (<ol>) in most sections (at least 3 lists in total), <strong> on 6-12 important terms or numbers, and tables with <thead> and <tbody>: one table for every ~700 words of article (at least 1, at most 3), placed where the plan says table or comparison. Optionally one <blockquote>. NEVER write a paragraph longer than 120 words (hard limit 300): keep paragraphs at 2-4 sentences.");
  t = rep(t, "- Primary keyword and natural variations of it: in the H1, the first 100 words, several H2s and H3s, the closing section, and naturally through the text.",
    "- The EXACT primary keyword (copy it word for word) MUST appear in the first 100 words of the intro and the whole article (about {{ Math.round(1750 * 0.0225) }} exact uses in total (the SEO plugin wants a keyword density of 2% to 2.5%: one exact use about every 40 to 50 words), spread evenly over the intro, headings, every section, the Conclusion and the FAQ; use the keyword as a natural subject or phrase, never as a list). The H1, at least one H2 and the Conclusion must contain the keyword or at least ALL of its words (for example \"Hurricane Isaias\" for the keyword \"isaias hurricane\"). If the keyword reads awkwardly, put the exact phrase once in the first paragraph and use the natural word order in the headings.");
  t = rep(t, "- Banned phrases:",
    "- ACTIVE VOICE: at least 90% of your sentences must be active. Avoid \"is/was/are/were + past participle\" (write \"Zendaya won the award\", not \"The award was won by Zendaya\"). \"was born\" is fine.\n" +
    "- TRANSITION WORDS: at least 35% of your sentences must contain a transition word or phrase (however, also, for example, because, so, then, in addition, as a result, meanwhile, finally, still, instead, while, for instance, overall). Use them naturally.\n" +
    "- HEADINGS: no three headings (H2 and H3 together) may start with the same first word.\n" +
    "- CONCLUSION: the last H2 of the article starts with the word Conclusion (for example \"Conclusion: What to Do Next\"). Under it write one or two paragraphs with 6 to 8 full sentences (100 to 140 words) that sum up the key points, use the exact primary keyword once and end with a clear next step. It comes before the FAQ.\n" +
    "- Banned phrases:");
  t = rep(t, '"metaTitle": "50-60 chars",', '"metaTitle": "EXACTLY 50 to 60 characters with the exact primary keyword near the start",');
  t = rep(t, '"metaDescription": "140-160 chars",', '"metaDescription": "120 to 150 characters (NEVER more than 150) including the exact primary keyword",');
  t = rep(t, '"slug": "url-slug",', '"slug": "3-6 lowercase words separated by hyphens, built from the primary keyword",');
  return t;
});

/* ============ Critic prompt ============ */
editText("🔍 Critique Draft", (t) => rep(t,
  "8. DEPTH_AND_FORMAT: at least {{ $('📋 Parse Plan').first().json.writer_context.wordCountRange.min }} words of real substance (no padding), at least one <table>, lists, a <blockquote>, and <strong> used for key terms.",
  "8. DEPTH_AND_FORMAT: between {{ $('📋 Parse Plan').first().json.writer_context.wordCountRange.min }} and {{ $('📋 Parse Plan').first().json.writer_context.wordCountRange.max }} words of real substance (no padding, never above the maximum), a table where the plan says so, bullet or numbered lists, and <strong> used for key terms. A code checker measures word count, headings, paragraph size, passive voice, transition words and keyword placement after you, so do not try to count them."));

/* ============ Plan parser: keep H2 <= 8 including the FAQ, keep h3 lists ============ */
edit("📋 Parse Plan", (c) => rep(c, "if (!plan || !plan.sections) throw new Error('Could not parse plan JSON.", fs.readFileSync(path.join(__dirname, "node-code", "plan-json-repair.js"), "utf8").trimEnd() + "\nif (!plan || !plan.sections) throw new Error('Could not parse plan JSON."));
edit("📋 Parse Plan", (c) => rep(c, "return [{ json: { ...ctx, ...plan, plan, quick_info",
  "if (Array.isArray(plan.sections)) {\n" +
  "  const cfgP = (() => { try { return $('⚙️ Config').first().json; } catch (e) { return {}; } })();\n" +
  "  const maxSections = Math.max(4, Number(cfgP.h2_max || 8) - 1); // the FAQ H2 is added later\n" +
  "  if (plan.sections.length > maxSections) {\n" +
  "    const concl = plan.sections[plan.sections.length - 1];\n" +
  "    plan.sections = plan.sections.slice(0, maxSections - 1).concat([concl]);\n" +
  "  }\n" +
  "  plan.sections.forEach(s => { s.h3 = Array.isArray(s.h3) ? s.h3.slice(0, 3) : []; });\n" +
  "}\n" +
  "return [{ json: { ...ctx, ...plan, plan, quick_info"));

/* ============ Draft gate, final validation, trimming ============ */
setCode("Parse Critique", code("parse-critique.js"));
setCode("✅ Validate Article", code("validate-article.js"));
setCode("Trim Article", code("trim-article.js"));

/* ============ FAQ quality (point 15) ============ */
edit("🧩 Prep Gemini FAQ", (c) => rep(c, "return [{ json: { ...ctx, site_url, topic_id, keyword: kw, primary_keyword: kw, phase_status: 'READY_FOR_GEMINI_FAQ' } }];",
  "// real search questions from the Ahrefs list (they have search demand): the best FAQ material\n" +
  "const qRe = /^(what|how|why|when|where|who|which|is|are|can|does|do|did|will|should)\\b/i;\n" +
  "const question_keywords = (Array.isArray(ctx.secondary_keywords) ? ctx.secondary_keywords : []).map(k => typeof k === 'string' ? k : k.keyword).filter(k => k && qRe.test(k)).slice(0, 12);\n" +
  "return [{ json: { ...ctx, site_url, topic_id, keyword: kw, primary_keyword: kw, question_keywords, phase_status: 'READY_FOR_GEMINI_FAQ' } }];"));

N("🤖 Generate FAQs").parameters.text = `=You are a senior SEO editor writing the FAQ section of a blog post. Write FAQs that real searchers ask and that can win a Google FAQ rich result.

FOCUS KEYWORD: {{ $json.keyword }}
BLOG TITLE: {{ $json.title }}
SEARCH INTENT: {{ $json.search_intent || 'informational' }}

REAL SEARCH QUESTIONS from Ahrefs (they have real search demand, prefer them):
{{ JSON.stringify($json.question_keywords || [], null, 2) }}

RESEARCH (the ONLY source of facts and numbers for your answers):
{{ JSON.stringify((($('📊 Analyze SERP').first().json.competitors) || []).filter(c => c.usable).slice(0, 4).map(c => ({ domain: c.domain, text: String(c.extractedText || '').replace(/\\s+/g, ' ').slice(0, 3500) })), null, 2) }}

COMPETITOR H2s (what readers care about):
{{ JSON.stringify(($json.common_h2 || []).slice(0, 10).map(x => x.topic), null, 2) }}

TASK: write exactly {{ Number($('⚙️ Config').first().json.faq_count || 6) + 1 }} FAQs (the best {{ $('⚙️ Config').first().json.faq_count || 6 }} are kept). In at least two answers use the exact FOCUS KEYWORD naturally.

QUALITY RULES (checked by code afterwards):
1. Choose the questions readers most want answered. Use the REAL SEARCH QUESTIONS first (rewrite each into a clean, natural question) and fill the remaining slots from the research and the competitor headings. No two questions may ask for the same fact.
2. Every question ends with "?", has 5-14 words, and uses natural wording. No more than TWO questions may start with the same first word, so vary What / How / Why / When / Is / Does / Can.
3. Every answer has 35-65 words in 2-3 short sentences. The FIRST sentence answers the question directly (a snippet Google can show) and repeats the key term of the question. The next sentence adds one supporting fact: a date, number or name from the RESEARCH.
4. Facts: every number, date, name and amount comes from the RESEARCH above, copied exactly (write money as $40 million). If the research does not support an answer, replace that question with another one. Never guess, never write "unknown", never invent.
5. Active voice and plain words. Use a transition word (also, however, because, for example, so) where it sounds natural. No marketing talk, no filler such as "It is important to note" or "In today's world".
6. Never use em or en dashes. The answers must agree with each other and with the facts in the research.

OUTPUT: return ONLY this JSON (no markdown):
{
  "faqs": [
    { "question": "What is ...?", "answer": "..." }
  ]
}`;

edit("📥 Parse Gemini FAQs", (c) => between(c, "const faqs = parsed.faqs.map((f, i) => ({", "})).filter(f => f.question && f.answer);",
  "const fillerRe = /common question about|see the related discussion|as an ai|i cannot|it is important to note/i;\n" +
  "const seenQ = new Set();\n" +
  "const faqs = parsed.faqs.map(f => ({\n" +
  "  question: String(f.question || '').replace(/\\s+/g, ' ').trim().replace(/[?\\uFF1F]*$/, '?'),\n" +
  "  answer: String(f.answer || '').replace(/\\s+/g, ' ').replace(/\\s*[\\u2013\\u2014]\\s*/g, ', ').trim()\n" +
  "})).filter(f => f.question.length > 8 && f.answer)\n" +
  "  .filter(f => { const n = f.answer.split(' ').length; return n >= 25 && n <= 90 && !fillerRe.test(f.answer); })\n" +
  "  .filter(f => { const k = f.question.toLowerCase().replace(/[^a-z0-9 ]/g, ''); if (seenQ.has(k)) return false; seenQ.add(k); return true; })\n" +
  "  .map((f, i) => ({ order: i + 1, question: f.question, answer: f.answer, source: 'gemini', source_url: '' }));"));

edit("Inject FAQ Block", (c) => {
  c = rep(c, "$('✂️ Trim Article')", "$('Trim Article')");
  c = between(c, "if (!faqs.length && Array.isArray(redditFaqs) && redditFaqs.length > 0) {", "faqs = faqs.filter(f => f.question && f.answer && f.question.length > 5).slice(0, 6);", fs.readFileSync(path.join(__dirname, "node-code", "inject-faq-snippet.js"), "utf8").trimEnd());
  // FAQ questions are H3 headings (SEO plugins read them as sub-headings), the answer is a normal paragraph
  c = rep(c, "return `<details class=\"faq-item\"><summary class=\"faq-question\">${q}</summary><div class=\"faq-answer\"><p>${a}</p></div></details>`;",
    "return `<div class=\"faq-item\"><h3>${q}</h3><p>${a}</p></div>`;");
  c = rep(c, "const faqSection = `\\n${faqHtml}\\n`;",
    "const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) };\n" +
    "const faqSection = `\\n${faqHtml}\\n<script type=\"application/ld+json\">${JSON.stringify(faqLd).replace(/</g, '\\\\u003c')}</script>\\n`;");
  return c;
});

/* ============ Internal links over categories (point 10), external links by topic (point 13) ============ */
N("🔗 Fetch WP Pages (for internal links)").parameters.url = "={{ $json.site_url + '/wp-json/wp/v2/posts?per_page=100&status=publish&_embed=wp:term&_fields=id,link,slug,title,categories,_embedded,_links' }}";
setCode("🔗 Score Internal Link Candidates", code("score-internal-links.js"));
setCode("🔗 Build External Link Plan", code("build-external-link-plan.js"));

/* ============ Pictures: max 4, all of them get through (point 14) ============ */
edit("🖼️ Prepare Image Searches", (c) => rep(c, "const imageCount = Math.max(1, Number(ctx.image_count || 4));", "const imageCount = Math.min(Math.max(1, Number(ctx.image_count || 4)), Number(ctx.max_images || 4));"));
// best picture per query by score (relevance, size, shape, licence, variety); Wikimedia Commons candidates come first from the server
setCode("🖼️ Select Google Image", code("select-google-image.js"));
N("🔍 Google Images Search").parameters.jsonBody = "={{ JSON.stringify({ query: $json.imageQuery, count: 8, subject: $json.keyword || $json.primary_keyword || '' }) }}";
setCode("🖼️ Crop Image Prep", code("crop-image-prep.js"));
for (const n of ["🖼️ Crop Image (16:9)", "🖼️ Upload to WP Media", "🖼️ Set Image Metadata"]) N(n).onError = "continueRegularOutput";
edit("🖼️ Collect Media", (c) => {
  c = rep(c, "const uploaded = $input.all();", "const uploaded = $input.all();\nconst cropped = $('🖼️ Crop Image Prep').all();");
  c = rep(c, "const s = selected[i]?.json || {};", "const idx = cropped[i]?.json?.imageIndex;\n  const s = (selected.find(x => x.json && x.json.imageIndex === idx) || selected[i] || {}).json || {};");
  return rep(c, "caption: s.caption,", "caption: s.caption, attribution: s.attribution || '',");
});
// Wikimedia pictures that need a credit (CC BY, CC BY-SA) keep a small credit line even when captions are switched off
edit("🎨 Enrich Article HTML", (c) => {
  c = rep(c, "const cleanCaption = stripCaption ? '' : String(featured.caption || '');", "const cleanCaption = (stripCaption && !featured.attribution) ? '' : String(featured.caption || featured.attribution || '');");
  return rep(c, "const cleanCaption = stripCaption ? '' : String(m.caption || '');", "const cleanCaption = (stripCaption && !m.attribution) ? '' : String(m.caption || m.attribution || '');");
});
edit("🎨 Enrich Article HTML", (c) => {
  // the intro must come first (SEO plugins read the first paragraph): the quick-info table goes after the intro, before the first H2
  c = rep(c, "  if (featured?.url && html.includes(featured.url)) {\n    const featuredUrlEscaped",
    "  { const h2pos = html.search(/<h2\\b/i); if (h2pos > 0) { html = html.slice(0, h2pos) + tableHtml + '\\n' + html.slice(h2pos); quickInfoInjected = true; } }\n  if (!quickInfoInjected && featured?.url && html.includes(featured.url)) {\n    const featuredUrlEscaped");
  return c;
});
edit("🎨 Enrich Article HTML", (c) => {
  c = rep(c, "const contextual = Array.isArray(ctx.media) ? ctx.media.filter(m => m.role === 'contextual') : [];",
    "const contextual = (Array.isArray(ctx.media) ? ctx.media.filter(m => m.role === 'contextual') : []).slice(0, Math.max(0, Number(cfg.max_images || 4) - (featured && featured.url ? 1 : 0)));");
  return between(c, "if (contextFigs.length > 0) {", "const originalArticleObj", fs.readFileSync(path.join(__dirname, "node-code", "enrich-spread-images.js"), "utf8").trimEnd() + "\n\nconst originalArticleObj");
});

// Table of Contents (anchors + list before the first H2), recognised by Rank Math
edit("🎨 Enrich Article HTML", (c) => rep(c, "const originalArticleObj = typeof ctx.article", fs.readFileSync(path.join(__dirname, "node-code", "enrich-toc.js"), "utf8").trimEnd() + "\n\nconst originalArticleObj = typeof ctx.article"));

/* ============ WordPress: slug, SEO meta, final report ============ */
setCode("📦 Prep WP Payload", code("prep-wp-payload.js"));

const report = {
  parameters: { jsCode: code("final-qa-report.js") },
  type: "n8n-nodes-base.code", typeVersion: 2,
  position: [N("📦 Prep WP Payload").position[0] + 200, N("📦 Prep WP Payload").position[1] + 160],
  id: "d1f0a3b2-6c11-4f7e-9a21-5e3c7b1a9f02", name: "🧪 Final QA Report"
};
w.nodes.push(report);
w.connections["📦 Prep WP Payload"] = { main: [[{ node: "🧪 Final QA Report", type: "main", index: 0 }]] };
w.connections["🧪 Final QA Report"] = { main: [[{ node: "📝 Create WP Draft", type: "main", index: 0 }]] };

const createNode = N("📝 Create WP Draft");
const seoNode = JSON.parse(JSON.stringify(createNode));
seoNode.id = "e2a1b4c3-7d22-4a8f-8b32-6f4d8c2b0a13";
seoNode.name = "🔎 Set SEO Meta (best effort)";
seoNode.position = [createNode.position[0] + 640, createNode.position[1] + 240];
seoNode.parameters.url = "={{ $('🔧 Normalize WP Result').first().json.site_url + '/wp-json/wp/v2/posts/' + $('🔧 Normalize WP Result').first().json.wp_post_id }}";
seoNode.parameters.jsonBody = "={{ JSON.stringify({ meta: { _yoast_wpseo_title: $('🔧 Normalize WP Result').first().json.seo_meta.seo_title, _yoast_wpseo_metadesc: $('🔧 Normalize WP Result').first().json.seo_meta.meta_description, _yoast_wpseo_focuskw: $('🔧 Normalize WP Result').first().json.seo_meta.focus_keyword, rank_math_title: $('🔧 Normalize WP Result').first().json.seo_meta.seo_title, rank_math_description: $('🔧 Normalize WP Result').first().json.seo_meta.meta_description, rank_math_focus_keyword: $('🔧 Normalize WP Result').first().json.seo_meta.focus_keyword } }) }}";
seoNode.onError = "continueRegularOutput";
w.nodes.push(seoNode);
const okBranch = w.connections["❓ WP Created?"].main[0];
if (!okBranch.some((x) => x.node === seoNode.name)) okBranch.push({ node: seoNode.name, type: "main", index: 0 });

N("📊 Final Sheet Update").parameters.columns.value.seo_qa_score =
  "={{ 'QA ' + ($('🧪 Final QA Report').first().json.final_qa_summary || '-') + ' | SEO ' + ($json.seo_score ?? '-') + '/100 | Editorial ' + ($json.average ?? '-') + '/10' }}";

// Gemini 429 (rate limit): fewer blind retries, longer wait, so one failure does not burn 3 requests of the quota
for (const n of w.nodes) { if (/chainLlm|agent/i.test(n.type) && n.retryOnFail) { n.maxTries = 2; n.waitBetweenTries = 20000; } }

// import it switched OFF: the schedule (09:00 and 15:00) would otherwise start spending RankyTools credits by itself
w.active = false;
fs.writeFileSync(F, JSON.stringify(w, null, 2));
console.log("applied. nodes:", w.nodes.length);

// the SERP step: Ahrefs first, SEMrush as fallback (see apply-ahrefs-serp.js)
require("./apply-ahrefs-serp.js");
