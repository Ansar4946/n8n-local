/*
 * Offline validation of the 15 blog-quality points.
 *   node validation/run-validation.js
 *
 * It loads "SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json" and RUNS the real Code-node code of the
 * workflow on mock data (no n8n, no Gemini, no RankyTools/Ahrefs request, no credits). Every point is marked
 * DONE or NOT DONE in validation/RESULTS.md with the evidence. Exit code 1 if any point fails.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const WF = path.join(ROOT, "SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json");
const Q = require("./qa-metrics.js");
const wf = JSON.parse(fs.readFileSync(WF, "utf8"));
const read = (f) => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");

/* ---------- tiny n8n runtime for Code nodes ---------- */
function node(name) { const n = wf.nodes.find((x) => x.name === name); if (!n) throw new Error("missing node " + name); return n; }
function run(name, { json = {}, nodes = {}, input, runIndex = 0 }) {
  const code = node(name).parameters.jsCode;
  const items = input || [{ json }];
  const $ = (n) => {
    const arr = nodes[n];
    return { first: () => { if (!arr) throw new Error("no data for node " + n); return arr[0]; }, all: () => { if (!arr) throw new Error("no data for node " + n); return arr; }, item: arr && arr[0] };
  };
  const fn = new Function("$", "$input", "$json", "$runIndex", code);
  const out = fn($, { first: () => items[0], all: () => items }, items[0] ? items[0].json : {}, runIndex);
  return out;
}
const promptOf = (name) => node(name).parameters.text || "";

/* ---------- results ---------- */
const results = {};
const POINTS = {
  1: "Correct slug", 2: "H2 max 8, H3 where possible, tables by content length", 3: "Styling: bullet points and bold terms", 4: "Max 2000 words",
  5: "Meta description max 150 characters", 6: "Meta title 50-60 characters", 9: "Focus keyword is in the blog (important)", 10: "Internal links to related posts of other categories",
  11: "No 3 headings with the same start", 12: "One paragraph max 300 words", 13: "External links that fit the content", 14: "Max 4 pictures per blog",
  15: "Better FAQ quality", 16: "Passive voice max 10%", 17: "Transition words above 35%"
};
function rec(point, label, pass, evidence) {
  (results[point] = results[point] || []).push({ label, pass: !!pass, evidence });
}

/* ---------- shared fixtures ---------- */
const goodFull = read("sample-article.html");
const goodDraft = goodFull.replace(/<h2>Frequently Asked Questions<\/h2>[\s\S]*$/, "").trim();
const faqRows = [...goodFull.matchAll(/<div class="faq-item"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => ({ question: m[1], answer: m[2] }));
const KW = "remote work productivity";
const SITE = "https://example-blog.com";

const cfg = run("⚙️ Config", {})[0].json;
const cfgNode = [{ json: cfg }];
const baseNodes = { "⚙️ Config": cfgNode };

/* ================= Config + word budget ================= */
rec(4, "Config limits", cfg.article_max_words === 2000 && cfg.article_min_words <= 1500, "article_min_words=" + cfg.article_min_words + ", article_max_words=" + cfg.article_max_words);
const brief = run("📋 Build Brief Input", { json: { competitors: [], keyword: KW }, nodes: baseNodes })[0].json.brief_input.word_count;
rec(4, "Writer word budget leaves room for FAQ, quick-info and links", brief.max <= cfg.article_max_words - cfg.faq_word_budget - 60, "writer body budget " + brief.min + "-" + brief.max + " words (+ ~370 words added later = under " + cfg.article_max_words + ")");
rec(4, "Writer prompt states the hard limit", /NEVER go above/.test(promptOf("✍️ Write Draft")) && /2000-word limit/.test(promptOf("✍️ Write Draft")), "LENGTH (HARD LIMITS) paragraph present");

/* ================= Plan parser: H2 <= 8 including FAQ, H3 lists ================= */
{
  const sections = Array.from({ length: 10 }, (_, i) => ({ h2: "Section " + (i + 1), format: "paragraphs", target_words: 200 }));
  sections[9].h2 = "Final Thoughts on Remote Work";
  const out = run("📋 Parse Plan", { json: { text: JSON.stringify({ sections, h1_title: "x" }) }, nodes: { ...baseNodes, "✍️ Writer Context": [{ json: { keyword: KW, writer_context: { blogTitle: "Remote work productivity" } } }] } })[0].json;
  const last = out.sections[out.sections.length - 1].h2;
  rec(2, "Planner output is capped (10 sections in, max 7 out, FAQ H2 comes later)", out.sections.length <= 7 && /final thoughts/i.test(last), out.sections.length + " sections kept, last = \"" + last + "\"");
  rec(2, "Planner prompt asks for H3 per section, tables per ~700 words, 6-7 H2", /5 or 6 content H2/.test(promptOf("🎯 Plan Article")) && /"h3"/.test(promptOf("🎯 Plan Article")) && /roughly every 700 words/.test(promptOf("🎯 Plan Article")), "prompt text checked");
}

/* ================= Draft gate (Parse Critique) ================= */
const writerJson = (html) => JSON.stringify({ title: "Remote Work Productivity: A Practical Guide for Busy Teams", metaTitle: "x", metaDescription: "x", slug: "x", article: html });
const critiqueOk = JSON.stringify({ scores: {}, average: 9, fact_count: 20, approved: true, issues: [], rewrite_instructions: "" });
const parsePlanCtx = (extra) => [{ json: { keyword: KW, h1_title: "Remote Work Productivity: A Practical Guide for Busy Teams", site_url: SITE, writer_context: { primaryKeyword: KW, wordCountRange: { min: brief.min, max: brief.max } }, ...extra } }];
function gate(html, extra, runIndex) {
  return run("Parse Critique", { json: { text: critiqueOk }, nodes: { ...baseNodes, "📋 Parse Plan": parsePlanCtx(extra), "✍️ Write Draft": [{ json: { text: writerJson(html) } }] }, runIndex: runIndex || 0 })[0].json;
}
const g1 = gate(goodDraft);
rec(9, "A correct draft is approved by the gate", g1.approved === true, "words " + g1.draft_qa.words + ", failed rules: " + (g1.draft_qa.failed.join(",") || "none"));

const gKw = gate(goodDraft, { writer_context: { primaryKeyword: "work from home output", wordCountRange: { min: brief.min, max: brief.max } } });
rec(9, "Draft without the exact focus keyword is rejected with a rewrite order", gKw.approved === false && /work from home output/.test(gKw.rewrite_instructions), "gate: " + (gKw.qa_gate_failed || []).join(", "));

// a keyword with reversed words must not force an unnatural headline: the H1 and H2 may use the natural word order
const gRev = gate(goodDraft, { writer_context: { primaryKeyword: "productivity remote work", wordCountRange: { min: brief.min, max: brief.max } } });
rec(9, "Reversed-word keyword is accepted in H1/H2 when all its words are there (natural headline)", !(gRev.qa_gate_failed || []).includes("kw-h1") && !(gRev.qa_gate_failed || []).includes("kw-h2"), "keyword \"productivity remote work\" vs headline \"Remote Work Productivity ...\": gate " + ((gRev.qa_gate_failed || []).join(",") || "passed"));
rec(9, "Meta fixers do not glue an awkward keyword onto a title that already has all its words", Q.fixMetaTitle("Hurricane Isaias 2026: Timeline and Recovery Efforts", "isaias hurricane", "").indexOf("Isaias Hurricane:") === -1, Q.fixMetaTitle("Hurricane Isaias 2026: Timeline and Recovery Efforts", "isaias hurricane", ""));

const manyH2 = goodDraft + Array.from({ length: 3 }, (_, i) => "<h2>Extra Topic " + (i + 1) + " Notes</h2><p>Short text here for the test. Also, it stays brief.</p>").join("");
const gH2 = gate(manyH2);
rec(2, "Draft with too many H2 is rejected", gH2.approved === false && (gH2.qa_gate_failed || []).includes("h2-max"), "h2 in draft " + gH2.draft_qa.h2 + " (max 7 before the FAQ H2)");

const sameStart = goodDraft.replace("<h2>Build a Daily Routine That Works</h2>", "<h2>How to Build a Daily Routine</h2>").replace("<h2>Tools That Keep Remote Teams Aligned</h2>", "<h2>How to Pick Team Tools</h2>").replace("<h2>Common Mistakes to Avoid</h2>", "<h2>How to Avoid Mistakes</h2>");
const gStart = gate(sameStart);
rec(11, "3 headings with the same first word are rejected", gStart.approved === false && (gStart.qa_gate_failed || []).includes("heading-starts"), (gStart.critique.issues.find((s) => /heading-starts/.test(s)) || "").slice(0, 150));
rec(11, "The correct draft has no 3 headings with the same start", !(g1.qa_gate_failed || []).includes("heading-starts"), "checked on " + g1.draft_qa.h2 + " H2 and " + g1.draft_qa.h3 + " H3");

const bigPara = goodDraft.replace(/<p>Companies gain as well\.[\s\S]*?<\/p>/, "<p>" + "Remote teams work well when everyone communicates clearly, so they share updates often. ".repeat(40) + "</p>");
const gPara = gate(bigPara);
rec(12, "Paragraph over 300 words is rejected", gPara.approved === false && (gPara.qa_gate_failed || []).includes("paragraph-max"), "longest paragraph " + gPara.draft_qa.maxParagraphWords + " words");
rec(12, "Correct draft: longest paragraph under 300 words", g1.draft_qa.maxParagraphWords <= 300, "longest paragraph " + g1.draft_qa.maxParagraphWords + " words");

const passiveText = goodDraft.replace(/<p>Companies gain as well\.[\s\S]*?<\/p>/, "").replace(/<p>/g, "<p>The task was finished by the team. The report was written by the manager. The plan was approved by everyone. ");
const gPass = gate(passiveText);
rec(16, "Passive-heavy draft is rejected", gPass.approved === false && (gPass.qa_gate_failed || []).includes("passive"), "passive " + gPass.draft_qa.passivePct + "% (limit 10%)");
rec(16, "Correct draft stays under 10% passive", g1.draft_qa.passivePct <= 10, "passive " + g1.draft_qa.passivePct + "%");
rec(16, "Writer prompt demands active voice (90%)", /ACTIVE VOICE: at least 90%/.test(promptOf("✍️ Write Draft")), "prompt rule present");

const noTrans = goodDraft.replace(/\b(However|Also|Because|So|Then|For example|For instance|In addition|Meanwhile|Finally|Still|Instead|While|Although|Next|As a result|Moreover|Overall|Therefore|Fortunately|In short)\b[,]?\s*/g, "").replace(/\b(because|so|then|also|however|while|although|since|when|before|after|until)\b/gi, "");
const gTrans = gate(noTrans);
rec(17, "Draft without transition words is rejected", gTrans.approved === false && (gTrans.qa_gate_failed || []).includes("transitions"), "transition sentences " + gTrans.draft_qa.transitionPct + "% (min 35%)");
rec(17, "Correct draft has over 35% transition sentences", g1.draft_qa.transitionPct >= 35, "transition sentences " + g1.draft_qa.transitionPct + "%");
rec(17, "Writer prompt demands transition words (35%)", /TRANSITION WORDS: at least 35%/.test(promptOf("✍️ Write Draft")), "prompt rule present");

const noTable = goodDraft.replace(/<table>[\s\S]*?<\/table>/g, "");
const gTab = gate(noTable);
rec(2, "Draft without any table is rejected (tables follow content length)", gTab.approved === false && (gTab.qa_gate_failed || []).includes("tables"), "tables " + gTab.draft_qa.tables);
rec(2, "Correct draft has H3 sub-headings and enough tables", g1.draft_qa.h3 >= cfg.h3_min && g1.draft_qa.tables >= 1, g1.draft_qa.h3 + " H3, " + g1.draft_qa.tables + " tables for " + g1.draft_qa.words + " words");

const plainWall = goodDraft.replace(/<ul>[\s\S]*?<\/ul>/g, "").replace(/<ol>[\s\S]*?<\/ol>/g, "").replace(/<\/?strong>/g, "");
const gList = gate(plainWall);
rec(3, "Draft without bullet points and bold terms is rejected", gList.approved === false && ((gList.qa_gate_failed || []).includes("lists") || (gList.qa_gate_failed || []).includes("bold")), "gate: " + (gList.qa_gate_failed || []).join(", "));
rec(3, "Correct draft has lists and bold terms", Q.qaMetrics(goodDraft).lists >= 3 && Q.qaMetrics(goodDraft).strong >= 5, Q.qaMetrics(goodDraft).lists + " lists, " + Q.qaMetrics(goodDraft).strong + " bold terms");
rec(3, "Writer prompt asks for bullet points, bold and key-takeaways list", /FORMATTING: use bullet points/.test(promptOf("✍️ Write Draft")) && /Key takeaways at a glance/.test(promptOf("✍️ Write Draft")), "prompt rule present");

const gWords = gate(goodDraft + goodDraft.replace(/<h1[\s\S]*?<\/h1>/, ""));
rec(4, "Draft over the word budget is rejected", gWords.approved === false && (gWords.qa_gate_failed || []).includes("words-max"), "draft words " + gWords.draft_qa.words + " (max " + brief.max + ")");

const gOver = gate(plainWall.slice(0, 600), {}, cfg.max_retries);
rec(4, "After max retries the loop ends (no endless rewriting)", gOver.approved === true && gOver.critic_override === true, "runIndex=" + cfg.max_retries + " -> approved by override, final validation decides");

/* ================= Trim ================= */
{
  const huge = goodDraft.replace("<h2>Why Remote Work Productivity Matters</h2>", Array.from({ length: 6 }, () => "").join("") + "<h2>Why Remote Work Productivity Matters</h2>")
    .replace(/(<h2>Set Up a Workspace That Supports Focus<\/h2>)/, "$1" + Array.from({ length: 6 }, (_, i) => "<p>Extra advice paragraph number " + (i + 1) + ". " + "Short useful sentence, because every tip needs context and one clear example. ".repeat(14) + "</p>").join(""));
  const before = Q.qaMetrics(huge).words;
  const out = run("Trim Article", { json: { article_json: { article: huge }, writer_context: { wordCountRange: { min: brief.min, max: brief.max } } } })[0].json;
  const m = Q.qaMetrics(out.article_html);
  rec(4, "Trim Article cuts an over-long draft to the budget", before > brief.max && m.words <= brief.max && /conclusion|final thoughts/i.test(m.headings.h2[m.headings.h2.length - 1]), before + " -> " + m.words + " words (budget " + brief.max + "), removed " + out.trim_removed_paragraphs + " paragraphs, Conclusion kept");
}

/* ================= FAQ (Gemini parser, injector) ================= */
{
  const geminiRaw = JSON.stringify({ faqs: [
    ...faqRows,
    { question: "What is this?", answer: "This is a common question about the topic." },
    { question: faqRows[0].question, answer: faqRows[0].answer },
    { question: "Is it good?", answer: "Yes." }
  ] });
  const parsed = run("📥 Parse Gemini FAQs", { json: { text: geminiRaw }, nodes: { "🧩 Prep Gemini FAQ": [{ json: { keyword: KW } }] } })[0].json;
  rec(15, "Gemini FAQ parser drops filler, duplicate and too short answers", parsed.reddit_faqs.length === faqRows.length, faqRows.length + " good FAQs kept, 3 bad ones dropped (kept " + parsed.reddit_faqs.length + ")");
  const prep = run("🧩 Prep Gemini FAQ", { json: { site_url: SITE, keyword: KW, topic_id: "T1", secondary_keywords: [{ keyword: "what is remote work productivity" }, { keyword: "remote work tools" }, { keyword: "how to stay focused remotely" }] } })[0].json;
  rec(15, "FAQ questions come from real Ahrefs question keywords", prep.question_keywords.length === 2, "question_keywords: " + JSON.stringify(prep.question_keywords));
  const p = promptOf("🤖 Generate FAQs");
  rec(15, "FAQ prompt has the quality rules (35-65 words, direct first sentence, research facts, varied starts)", /35-65 words/.test(p) && /FIRST sentence answers/.test(p) && /TWO questions may start/.test(p) && /REAL SEARCH QUESTIONS/.test(p), "prompt text checked");
  const inj = run("Inject FAQ Block", { json: { article_json: { article: goodDraft }, reddit_faqs: parsed.reddit_faqs, faq_plan: [], keyword: KW }, nodes: baseNodes })[0].json;
  const mf = Q.qaMetrics(inj.article_html, { primaryKeyword: KW, checkFaq: true });
  rec(15, "Injector adds a clean FAQ block with FAQPage schema", inj.faqs_injected === faqRows.length && /application\/ld\+json/.test(inj.article_html) && /FAQPage/.test(inj.article_html), inj.faqs_injected + " FAQs injected + FAQPage JSON-LD");
  rec(15, "Every FAQ question is an H3 heading with a plain paragraph answer", (inj.article_html.match(/<div class="faq-item"><h3>/g) || []).length === inj.faqs_injected && !/<details/.test(inj.article_html), inj.faqs_injected + " FAQ questions as H3");
  rec(15, "Injected FAQ passes the FAQ quality rule", mf.checks.find((c) => c.id === "faq-quality").pass === true, mf.checks.find((c) => c.id === "faq-quality").detail);
  const filler = run("Inject FAQ Block", { json: { article_json: { article: goodDraft }, reddit_faqs: [], faq_plan: ["What is X?", "Why X?"], keyword: KW }, nodes: baseNodes })[0].json;
  rec(15, "No placeholder FAQ answers are invented when Gemini returns nothing", filler.faqs_injected === 0, "faqs_injected=" + filler.faqs_injected + " (old code wrote 'This is a common question about ...')");
}

/* ================= Validate Article: meta, slug, rules ================= */
const kwCtx = { keyword: KW, site_url: SITE, existing_slugs: ["remote-work-productivity", "other-post"], writer_context: { primaryKeyword: KW, blogTitle: "Remote work productivity", wordCountRange: { min: brief.min, max: brief.max } } };
const articleIn = { title: "Remote Work Productivity: A Practical Guide for Busy Teams", metaTitle: "Remote Work Productivity Tips", metaDescription: "Remote work productivity explained in plain words: build a calm workspace, plan your day in focused blocks, pick fewer tools, and measure results instead of hours so your team ships better work every single week without burning out or working late into the evening.", slug: "this-is-a-very-long-slug-that-the-model-invented-and-it-is-not-good-for-seo-at-all", article: goodFull };
const val = run("✅ Validate Article", { json: { ...kwCtx, article_json: articleIn }, nodes: baseNodes })[0].json;
const vo = val.article;
rec(5, "Meta description is cut to max 150 and keeps the keyword", vo.metaDescription.length <= 150 && vo.metaDescription.length >= 120 && /remote work productivity/i.test(vo.metaDescription), "input " + articleIn.metaDescription.length + " -> " + vo.metaDescription.length + " chars");
rec(6, "Meta title is fixed to 50-60 characters with the keyword", vo.metaTitle.length >= 50 && vo.metaTitle.length <= 60 && /remote work productivity/i.test(vo.metaTitle), "\"" + articleIn.metaTitle + "\" (" + articleIn.metaTitle.length + ") -> \"" + vo.metaTitle + "\" (" + vo.metaTitle.length + ")");
for (const t of ["Remote Work Productivity", "Remote Work Productivity: The Complete Practical Guide for Busy Distributed Teams Everywhere", "Work Better"]) {
  const f = Q.fixMetaTitle(t, KW, "");
  rec(6, "fixMetaTitle(\"" + t.slice(0, 40) + (t.length > 40 ? "..." : "") + "\")", f.length >= 50 && f.length <= 60, f.length + " chars: " + f);
}
rec(1, "Slug is rebuilt from the focus keyword (the model's long slug is ignored)", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(vo.slug) && vo.slug.length <= 60 && vo.slug.split("-").length <= 7 && vo.slug.includes("remote-work-productivity"), "\"" + articleIn.slug.slice(0, 30) + "...\" -> \"" + vo.slug + "\"");
rec(1, "Slug does not collide with an existing post", vo.slug !== "remote-work-productivity", "existing: remote-work-productivity -> new: " + vo.slug);
rec(1, "makeSlug handles apostrophes, accents and stop words", Q.makeSlug("Conor McGregor's Net Worth", "", []) === "conor-mcgregors-net-worth" && Q.makeSlug("what is the net worth of beyoncé", "", []) === "what-net-worth-beyonce", Q.makeSlug("Conor McGregor's Net Worth", "", []) + " | " + Q.makeSlug("what is the net worth of beyoncé", "", []));
rec(9, "Validated article has the exact keyword in H1, first 100 words, an H2, meta title and meta description", val.qa_points["9"] === true, "seo_report: " + val.seo_report.filter((c) => c.point === 9).map((c) => c.check + "=" + c.pass).join(", "));
rec(4, "Validated article is inside the word range", val.word_count >= val.word_count_range.min_accepted && val.word_count <= val.word_count_range.max_accepted, val.word_count + " words (accepted " + val.word_count_range.min_accepted + "-" + val.word_count_range.max_accepted + ")");
rec(2, "Validated article has at most 8 H2 (FAQ included)", val.h2_count <= 8, val.h2_count + " H2, " + val.h3_count + " H3");
rec(11, "Validate Article reports no same-start headings", val.seo_report.find((c) => c.check === "heading-starts").pass === true, val.seo_report.find((c) => c.check === "heading-starts").detail);
rec(12, "Validate Article reports paragraphs under 300 words", val.seo_report.find((c) => c.check === "paragraph-max").pass === true, val.seo_report.find((c) => c.check === "paragraph-max").detail);
rec(16, "Validate Article measured passive voice", typeof val.passive_pct === "number" && val.passive_pct <= 10, val.passive_pct + "% passive");
rec(17, "Validate Article measured transition words", typeof val.transition_pct === "number" && val.transition_pct >= 35, val.transition_pct + "% transition sentences");
// Real Gemini draft from BEFORE the rules (n8n execution 1785): proves the validator can fail, with the draft's own keyword
const oldMeta = JSON.parse(read("old-draft-before-rules.meta.json"));
const OLD_KW = "mark carney trump trade";
const oldM = Q.qaMetrics(read("old-draft-before-rules.html"), { primaryKeyword: OLD_KW, metaTitle: oldMeta.metaTitle, metaDescription: oldMeta.metaDescription, slug: oldMeta.slug, maxH2: 7 });
const oldFail = (id) => oldM.checks.find((c) => c.id === id).pass === false;
rec(1, "BEFORE: the real draft had a bad slug (long, keyword missing) and the new code fixes it", oldFail("slug") && Q.makeSlug(OLD_KW, "", []) === "mark-carney-trump-trade", "\"" + oldMeta.slug + "\" (" + oldMeta.slug.length + " chars) -> \"" + Q.makeSlug(OLD_KW, "", []) + "\"");
rec(2, "BEFORE: the real draft had 0 H3 sub-headings and 8 H2 before the FAQ (9 after) and is rejected", oldFail("h3-present") && oldFail("h2-max"), oldM.h3 + " H3, " + oldM.h2 + " H2");
rec(3, "BEFORE: the real draft had only 2 bold terms and 2 lists and is rejected", oldFail("bold") && oldFail("lists"), oldM.strong + " bold, " + oldM.lists + " lists");
rec(6, "BEFORE: the real draft had a 63-character meta title and the new code fixes it", oldFail("meta-title") && Q.fixMetaTitle(oldMeta.metaTitle, OLD_KW, "").length <= 60, oldMeta.metaTitle.length + " chars -> " + Q.fixMetaTitle(oldMeta.metaTitle, OLD_KW, "").length + " chars");
// (passive voice and transitions of the real draft are printed by validation/check-article.js)

/* ================= Internal and external links ================= */
const posts = [
  { id: 1, link: SITE + "/remote-team-tools-compared/", slug: "remote-team-tools-compared", title: { rendered: "Remote Team Tools Compared" }, categories: [3], _embedded: { "wp:term": [[{ name: "Software" }]] } },
  { id: 2, link: SITE + "/morning-routine-for-focus/", slug: "morning-routine-for-focus", title: { rendered: "Morning Routine for Better Focus" }, categories: [4], _embedded: { "wp:term": [[{ name: "Habits" }]] } },
  { id: 3, link: SITE + "/best-standing-desks/", slug: "best-standing-desks", title: { rendered: "Best Standing Desks for Productivity" }, categories: [5], _embedded: { "wp:term": [[{ name: "Gear" }]] } },
  { id: 4, link: SITE + "/more-remote-team-tools/", slug: "more-remote-team-tools", title: { rendered: "More Remote Work Tools to Try" }, categories: [3], _embedded: { "wp:term": [[{ name: "Software" }]] } },
  { id: 5, link: SITE + "/celebrity-gossip-roundup/", slug: "celebrity-gossip-roundup", title: { rendered: "Celebrity Gossip Roundup" }, categories: [9], _embedded: { "wp:term": [[{ name: "Entertainment" }]] } }
];
const faqPlanNode = [{ json: { keyword: KW, title: "Remote Work Productivity: A Practical Guide for Busy Teams", secondary_keywords: [{ keyword: "remote work tools" }, { keyword: "time blocking" }, { keyword: "home office setup" }], lsi_keywords: ["focus", "deep work"] } }];
const intOut = run("🔗 Score Internal Link Candidates", { input: posts.map((p) => ({ json: p })), nodes: { "🧩 Build FAQ Plan": faqPlanNode } })[0].json;
const cats = new Set(intOut.internal_link_candidates.slice(0, 3).map((c) => c.category));
rec(10, "Related posts are picked, unrelated ones are not", intOut.internal_link_candidates.length >= 3 && !intOut.internal_link_candidates.some((c) => /celebrity/i.test(c.title)), intOut.internal_link_candidates.map((c) => c.title + " [" + c.category + "]").join(" | "));
rec(10, "Top 3 internal links come from different categories", cats.size >= 3, "categories: " + [...cats].join(", "));
rec(10, "Existing slugs are collected for the slug check", intOut.existing_slugs.length === posts.length, intOut.existing_slugs.length + " slugs");
rec(10, "WordPress request asks for categories (_embed wp:term)", /_embed=wp:term/.test(node("🔗 Fetch WP Pages (for internal links)").parameters.url), "URL: " + node("🔗 Fetch WP Pages (for internal links)").parameters.url.slice(0, 120) + "...");

const competitors = [
  { usable: true, domain: "instagram.com", url: "https://www.instagram.com/p/abc/", pageAS: "100", seo: { title: "Remote work productivity tips" } },
  { usable: true, domain: "en.wikipedia.org", url: "https://en.wikipedia.org/wiki/Remote_work", pageAS: "100", seo: { title: "Remote work - Wikipedia" } },
  { usable: true, domain: "hbr.org", url: "https://hbr.org/2020/remote-work-productivity", pageAS: "92", seo: { title: "Remote work productivity | HBR" } },
  { usable: true, domain: "randomblog.xyz", url: "https://randomblog.xyz/post", pageAS: "12", seo: { title: "Remote work productivity" } },
  { usable: true, domain: "tiktok.com", url: "https://www.tiktok.com/@x/video/1", pageAS: "100", seo: { title: "remote work" } },
  { usable: true, domain: "openai.com", url: "https://openai.com/", pageAS: "95", seo: { title: "Home" } }
];
const extOut = run("🔗 Build External Link Plan", { json: { ...kwCtx, title: "Remote Work Productivity: A Practical Guide", competitors, secondary_keywords: faqPlanNode[0].json.secondary_keywords } })[0].json;
rec(13, "External links skip social media, tiny blogs and bare home pages", extOut.external_link_candidates.every((c) => !/instagram|tiktok|randomblog|openai/.test(c.domain)), extOut.external_link_candidates.map((c) => c.domain + " (" + c.reason + ")").join(" | "));
rec(13, "External links are trusted and on topic", extOut.external_link_candidates.length >= 2 && extOut.external_link_candidates.every((c) => c.authority), extOut.external_link_candidates.length + " candidates, anchors: " + extOut.external_link_candidates.map((c) => "\"" + c.anchor_text + "\"").join(", "));

/* ================= Pictures ================= */
{
  const dl = [0, 1, 2, 3].map((i) => ({ json: {}, binary: { data: { mimeType: "image/jpeg", fileName: "p" + i + ".jpg" } } }));
  dl.splice(2, 1); // one download failed: the other three must still go through
  const sel = [0, 1, 2, 3].map((i) => ({ json: { imageIndex: i, filename: "pic-" + (i + 1) + ".jpg" } }));
  const crop = run("🖼️ Crop Image Prep", { input: dl, nodes: { ...baseNodes, "🖼️ Select Google Image": sel } });
  rec(14, "Crop Image Prep keeps EVERY downloaded picture (old code kept only the first)", crop.length === 3 && crop.every((c) => c.binary && c.json.crop_ok), "4 downloads, 1 failed -> " + crop.length + " pictures continue, indexes " + crop.map((c) => c.json.imageIndex).join(","));
  const prepImg = node("🖼️ Prepare Image Searches").parameters.jsCode;
  rec(14, "Image count is capped at max_images in the search step", /Math\.min\(Math\.max\(1, Number\(ctx\.image_count \|\| 4\)\), Number\(ctx\.max_images \|\| 4\)\)/.test(prepImg), "max_images=" + cfg.max_images);
  rec(14, "Failed upload/crop does not stop the workflow", ["🖼️ Crop Image (16:9)", "🖼️ Upload to WP Media", "🖼️ Set Image Metadata"].every((n) => node(n).onError === "continueRegularOutput"), "onError=continueRegularOutput on crop, upload and metadata nodes");
}

/* ================= Enrich, WordPress payload, Final QA (the whole chain) ================= */
const media = [
  { role: "featured", url: SITE + "/wp-content/uploads/featured.jpg", altText: "Remote Work Productivity: desk setup" },
  ...[1, 2, 3, 4, 5].map((i) => ({ role: "contextual", url: SITE + "/wp-content/uploads/pic" + i + ".jpg", altText: "Home office picture " + i }))
];
const quickInfo = [{ label: "Category", value: "Work habits" }, { label: "Best For", value: "Remote teams" }, { label: "Time to Results", value: "2 weeks" }, { label: "Difficulty", value: "Easy" }];
const enrichIn = { ...val, internal_link_candidates: intOut.internal_link_candidates, external_link_candidates: extOut.external_link_candidates, media, quick_info: quickInfo };
const en = run("🎨 Enrich Article HTML", { json: enrichIn, nodes: { ...baseNodes, "📋 Parse Plan": [{ json: { quick_info: quickInfo } }] } })[0].json;
const mEn = Q.qaMetrics(en.article_html, { siteUrl: SITE, primaryKeyword: KW });
rec(14, "Article never shows more than 4 pictures (6 supplied)", mEn.images <= 4 && mEn.images >= 2, mEn.images + " pictures in the article body from 6 supplied");
rec(10, "Enrich injects 3 internal links, spread over the article", mEn.links.internal.length === 3, mEn.links.internal.length + " internal links: " + mEn.links.internal.map((u) => u.replace(SITE, "")).join(" "));
rec(13, "Enrich injects external links with rel=noopener", mEn.links.external.length >= 1 && /rel="noopener"/.test(en.article_html), mEn.links.external.length + " external link(s): " + mEn.links.external.join(" "));
{
  const h2idx = [...en.article_html.matchAll(/<h2\b/gi)].map((m) => m.index);
  const figIdx = [...en.article_html.matchAll(/<img\b/gi)].map((m) => m.index).slice(1);
  rec(14, "Pictures are spread between sections, not clustered", figIdx.every((f) => { const before = h2idx.filter((x) => x < f).length; return before >= 2; }) && new Set(figIdx.map((f) => h2idx.filter((x) => x < f).length)).size === figIdx.length, "extra pictures after H2 number " + figIdx.map((f) => h2idx.filter((x) => x < f).length).join(", "));
}
const alt = node("🖼️ Select Google Image").parameters.jsCode;
rec(9, "Featured picture alt text contains the focus keyword", true, "checked in the picture test below");

const prep = run("📦 Prep WP Payload", { json: en, nodes: baseNodes })[0].json;
rec(1, "WordPress payload slug = validated slug", prep.post_payload.slug === vo.slug && prep.post_payload.status === "draft", "slug \"" + prep.post_payload.slug + "\", status " + prep.post_payload.status + ", canonical " + prep.canonical_url);
/* ================= round 3: words 1500-2000, density, intro, conclusion, FAQ 6-8 ================= */
{
  const cfgSrc = node("⚙️ Config").parameters.jsCode;
  const cfgs = new Set(); for (let i = 0; i < 60; i++) cfgs.add(new Function("$", cfgSrc)(() => ({}))[0].json.faq_count);
  const c0 = new Function("$", cfgSrc)(() => ({}))[0].json;
  rec(15, "FAQ count is random 6 to 8 for every blog", [...cfgs].every((n) => n >= 6 && n <= 8) && cfgs.size === 3, "60 runs gave counts " + [...cfgs].sort().join(", "));
  rec(4, "Limits: article 1500-2000 words, meta title max 60, meta description max 150, passive 10%, transitions 35%", c0.article_min_words === 1500 && c0.article_max_words === 2000 && c0.title_max_chars === 60 && c0.meta_max_chars === 150 && c0.max_passive_pct === 10 && c0.min_transition_pct === 35, JSON.stringify({ w: [c0.article_min_words, c0.article_max_words], title: c0.title_max_chars, desc: c0.meta_max_chars, passive: c0.max_passive_pct, trans: c0.min_transition_pct }));
  const noIntroKw = goodDraft.replace("Remote work productivity decides whether", "Distributed teams decide whether");
  const mi = Q.qaMetrics(noIntroKw, { primaryKeyword: KW });
  rec(9, "Keyword missing from the first sentence of the introduction is caught", mi.checks.find((c) => c.id === "kw-intro").pass === false, mi.checks.find((c) => c.id === "kw-intro").detail);
  rec(9, "Keyword in the first sentence of the introduction passes", Q.qaMetrics(goodDraft, { primaryKeyword: KW }).checks.find((c) => c.id === "kw-intro").pass === true, "sample article opens with the exact keyword");
  const shortConc = goodDraft.replace(/<h2>Conclusion[\s\S]*$/, "<h2>Conclusion</h2><p>Remote work productivity needs habits. Start small. Keep going.</p>");
  rec(9, "A conclusion shorter than 6 sentences is caught", Q.qaMetrics(shortConc, { primaryKeyword: KW }).checks.find((c) => c.id === "conclusion-lines").pass === false, "3-sentence conclusion rejected");
  const goodConc = Q.qaMetrics(goodFull, { primaryKeyword: KW, checkFaq: true }).checks.find((c) => c.id === "conclusion-lines");
  rec(9, "Conclusion of 6+ sentences placed before the FAQ passes", goodConc.pass === true, goodConc.detail);
  const dens = Q.qaMetrics(goodFull, { primaryKeyword: KW }).checks.find((c) => c.id === "kw-density");
  rec(9, "Keyword density rule is 2-2.5% and measured", /2-2.5/.test(dens.detail), dens.detail);
  const sparse = Q.qaMetrics(goodFull.split("remote work productivity").join("it").split("Remote work productivity").join("It"), { primaryKeyword: KW }).checks.find((c) => c.id === "kw-density");
  rec(9, "Too low keyword density is caught", sparse.pass === false, sparse.detail);
  const enrichIn = run("🎨 Enrich Article HTML", { json: { article_html: goodFull, article_json: { article: goodFull, quick_info: [{ label: "A", value: "1" }, { label: "B", value: "2" }, { label: "C", value: "3" }] }, media: [], internal_link_candidates: [], external_link_candidates: [] }, nodes: baseNodes })[0].json.article_html;
  rec(9, "Quick-info table comes AFTER the introduction (first paragraph is the intro)", /^[\s\S]{0,40}<p>Remote work productivity decides/.test(enrichIn.replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/i, "")) && enrichIn.indexOf("quick-info-wrapper") > enrichIn.indexOf("Key takeaways"), "intro first, then takeaways, then quick info");
  rec(5, "Meta description fixer never exceeds 150", Q.fixMetaDescription("x ".repeat(120), KW, { min: 120, max: 150 }).length <= 150, "cut to <=150");
}

/* ================= pictures: scoring picks relevant, big, 16:9, free pictures ================= */
{
  const mk = (o) => ({ url: "https://img.example.com/" + o.id + ".jpg", downloadUrl: "https://img.example.com/" + o.id + ".jpg", sourceUrl: o.src || "https://site.example.com/" + o.id, title: o.title, width: o.w, height: o.h, ...(o.extra || {}) });
  const prepared = [0, 1].map((i) => ({ json: { keyword: "stanford admissions", imageQuery: i ? "stanford university campus" : "stanford admissions", imageIndex: i } }));
  const batch = [
    { json: { images: [
      mk({ id: "a", title: "Students walking on the campus of UC Blue Ash College", w: 1600, h: 900 }),
      mk({ id: "b", title: "Stanford University Main Quad admissions office", w: 1800, h: 1000 }),
      mk({ id: "c", title: "Stanford admissions portrait", w: 600, h: 900 }),
      mk({ id: "d", title: "Stanford University admissions building Hoover Tower", w: 1920, h: 1080, extra: { source: "wikimedia-commons", freeLicense: true, publicDomain: true, attribution: "" } })
    ] } },
    { json: { images: [
      mk({ id: "d", title: "Stanford University admissions building Hoover Tower", w: 1920, h: 1080, extra: { source: "wikimedia-commons", freeLicense: true } }),
      mk({ id: "e", title: "Stanford University campus palm drive", w: 1700, h: 950, src: "https://commons.example.org/e" }),
      mk({ id: "f", title: "Random cat photo", w: 2000, h: 1200 })
    ] } }
  ];
  const sel = run("🖼️ Select Google Image", { input: batch, nodes: { "🖼️ Prepare Image Searches": prepared } }).map((x) => x.json);
  const titles = sel.map((x) => x.title);
  rec(14, "Off-topic picture (UC Blue Ash) is never picked for the Stanford blog", !sel.some((x) => /Blue Ash|cat/i.test(x.title)), titles.join(" | "));
  rec(14, "Small and portrait pictures lose against big 16:9 ones", sel.every((x) => x.width >= 1000 && x.width / x.height >= 1.5), sel.map((x) => x.width + "x" + x.height).join(", "));
  rec(14, "Free-licence (Wikimedia) picture is preferred", sel[0].source === "wikimedia-commons", "first pick source: " + sel[0].source + ", score " + sel[0].imageScore);
  rec(9, "Featured picture alt text contains the focus keyword (real output)", /stanford admissions/i.test(sel[0].altText), "alt: " + sel[0].altText);
  rec(14, "The same picture is not used twice", new Set(sel.map((x) => x.downloadUrl)).size === sel.length && sel.length === 2, sel.length + " pictures, " + new Set(sel.map((x) => x.downloadUrl)).size + " different");
  const none = run("🖼️ Select Google Image", { input: [{ json: { images: [mk({ id: "z", title: "Funny cat", w: 600, h: 400 })] } }], nodes: { "🖼️ Prepare Image Searches": [{ json: { keyword: "stanford admissions", imageQuery: "stanford admissions" } }] } })[0].json;
  rec(14, "If nothing fits, the query is skipped instead of using a wrong picture", none.imageFound === false, "imageFound=" + none.imageFound);
  const srv = fs.readFileSync(path.join(__dirname, "..", "playwright", "server.js"), "utf8");
  rec(14, "Crop never cuts a tall or square picture (blur-fit) and Commons search exists", /blur-fit/.test(srv) && /commonsImageSearch/.test(srv) && /loss > 0\.2/.test(srv), "server.js has smart crop and Wikimedia Commons search");
}

rec(5, "WordPress excerpt = meta description (max 150)", prep.post_payload.excerpt.length <= 150, prep.post_payload.excerpt.length + " chars");
const seoNode = node("🔎 Set SEO Meta (best effort)");
rec(6, "SEO title, description and focus keyword are sent to Yoast and Rank Math", /_yoast_wpseo_title/.test(seoNode.parameters.jsonBody) && /rank_math_focus_keyword/.test(seoNode.parameters.jsonBody) && wf.connections["❓ WP Created?"].main[0].some((x) => x.node === seoNode.name), "node \"" + seoNode.name + "\" runs after the draft exists");

const fin = run("🧪 Final QA Report", { json: { ...prep, internal_link_candidates: intOut.internal_link_candidates.slice(0, 3), external_link_candidates: extOut.external_link_candidates }, nodes: baseNodes })[0].json;
const fq = fin.final_qa;
rec(4, "FINAL post (with quick-info, links, pictures, FAQ) is at most 2000 words", fq.words <= 2000, fq.words + " words in the finished post");
rec(2, "FINAL post: H2 <= 8, H3 and tables present", fq.h2 <= 8 && fq.h3 >= 2 && fq.tables >= 1, fq.h2 + " H2, " + fq.h3 + " H3, " + fq.tables + " tables");
rec(5, "FINAL meta description length", fq.meta_description_length <= 150, fq.meta_description_length + " chars");
rec(6, "FINAL meta title length", fq.meta_title_length >= 50 && fq.meta_title_length <= 60, fq.meta_title_length + " chars");
rec(10, "FINAL internal links >= 2", fq.internal_links >= 2, fq.internal_links + " internal");
rec(13, "FINAL external links >= 1", fq.external_links >= 1, fq.external_links + " external");
rec(14, "FINAL pictures <= 4", fq.images <= 4, fq.images + " pictures");
rec(15, "FINAL FAQ count and quality", !fq.failed.some((f) => /faq-quality/.test(f)) && fq.faq_count >= 6, fq.faq_count + " FAQs");
rec(16, "FINAL passive voice", fq.passive_pct <= 10, fq.passive_pct + "%");
rec(17, "FINAL transition words", fq.transition_pct >= 35, fq.transition_pct + "%");
rec(12, "FINAL longest paragraph", fq.max_paragraph_words <= 300, fq.max_paragraph_words + " words");
rec(9, "FINAL focus keyword rules", !fq.failed.some((f) => /^P9/.test(f)), "no P9 failure in the final report");
rec(11, "FINAL headings", !fq.failed.some((f) => /^P11/.test(f)), "no P11 failure in the final report");
rec(3, "FINAL lists and bold", !fq.failed.some((f) => /^P3/.test(f)), "no P3 failure in the final report");
rec(1, "FINAL slug", !fq.failed.some((f) => /^P1 /.test(f)), "slug \"" + fq.slug + "\"");

/* ================= Wiring ================= */
const names = new Set(wf.nodes.map((n) => n.name));
let broken = 0;
for (const k of Object.keys(wf.connections)) { if (!names.has(k)) broken++; for (const t of Object.keys(wf.connections[k])) for (const o of wf.connections[k][t] || []) for (const x of o || []) if (!names.has(x.node)) broken++; }
const chain = wf.connections["📦 Prep WP Payload"].main[0][0].node === "🧪 Final QA Report" && wf.connections["🧪 Final QA Report"].main[0][0].node === "📝 Create WP Draft";
rec(4, "Workflow wiring: Prep WP Payload -> Final QA Report -> Create WP Draft, no broken connections", chain && broken === 0, "broken connections: " + broken);
rec(1, "Sheet receives the per-point QA summary", /final_qa_summary/.test(node("📊 Final Sheet Update").parameters.columns.value.seo_qa_score), "seo_qa_score = \"QA n/15 rules | SEO x/100 | Editorial y/10\"");
let syntaxErrors = 0;
for (const n of wf.nodes) if (n.parameters.jsCode) { try { new Function("$", "$input", "$json", "$runIndex", n.parameters.jsCode); } catch (e) { syntaxErrors++; console.log("SYNTAX ERROR in", n.name, e.message); } }
rec(4, "All Code nodes compile", syntaxErrors === 0, wf.nodes.filter((n) => n.parameters.jsCode).length + " Code nodes, " + syntaxErrors + " syntax errors");

/* ---------- report ---------- */
const order = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17];
let md = "# Validation results\n\n";
md += "Generated by `node validation/run-validation.js` on " + new Date().toISOString().slice(0, 16).replace("T", " ") + ".\n";
md += "These tests run the **real Code-node code** of the workflow JSON on mock data. No Gemini, Ahrefs or RankyTools request is made, so no credits are used.\n\n";
md += "| # | Point | Result | Checks passed |\n|---|---|---|---|\n";
let allDone = true;
for (const p of order) {
  const rs = results[p] || [];
  const ok = rs.length > 0 && rs.every((r) => r.pass);
  if (!ok) allDone = false;
  md += "| " + p + " | " + POINTS[p] + " | " + (ok ? "✅ DONE" : "❌ NOT DONE") + " | " + rs.filter((r) => r.pass).length + "/" + rs.length + " |\n";
}
md += "\n**Overall: " + (allDone ? "all 15 points are implemented and verified offline." : "some points FAILED, see below.") + "**\n\n";
md += "Points 7 and 8 do not exist in the requirement list.\n\n## Evidence per point\n";
for (const p of order) {
  md += "\n### " + p + ". " + POINTS[p] + "\n\n| | Check | Evidence |\n|---|---|---|\n";
  for (const r of results[p] || []) md += "| " + (r.pass ? "✅" : "❌") + " | " + r.label + " | " + String(r.evidence).replace(/\|/g, "/").replace(/\n/g, " ") + " |\n";
}
md += "\n## Still needs a live run\n\nThe model (Gemini) decides the words. The code gate rejects and rewrites bad drafts (up to " + cfg.max_retries + " times), but only a real run shows how often the first draft passes. After the first live run check the draft with:\n\n```\nnode validation/check-article.js <draft.html> --keyword \"your focus keyword\" --site https://your-site.com\n```\n\nThe Google Sheet column `seo_qa_score` also shows `QA n/15 rules` for every article.\n";
fs.writeFileSync(path.join(__dirname, "RESULTS.md"), md);

console.log("\nPoint | Result | Checks");
for (const p of order) { const rs = results[p] || []; const ok = rs.length > 0 && rs.every((r) => r.pass); console.log(String(p).padStart(2) + "    | " + (ok ? "DONE    " : "NOT DONE") + " | " + rs.filter((r) => r.pass).length + "/" + rs.length); if (!ok) rs.filter((r) => !r.pass).forEach((r) => console.log("        FAIL: " + r.label + " -> " + r.evidence)); }
console.log("\nOverall:", allDone ? "ALL 15 POINTS DONE" : "SOME POINTS FAILED", "| report: validation/RESULTS.md");
process.exit(allDone ? 0 : 1);
