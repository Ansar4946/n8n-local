/*
 * Check ONE finished article against the 15 quality points (use it after a live run).
 *
 *   node validation/check-article.js draft.html --keyword "remote work productivity" --site https://your-site.com \
 *        [--title "Post title"] [--meta-title "..."] [--meta-desc "..."] [--slug the-slug] [--final]
 *
 * --final   the HTML is the finished WordPress post (links, pictures, FAQ already inside): also checks
 *           internal/external links, pictures and the FAQ block. Without it only the draft rules are checked.
 * The HTML can also be piped in:  type draft.html | node validation/check-article.js --keyword "..."
 */
const fs = require("fs");
const { qaMetrics } = require("./qa-metrics.js");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--final"));
const html = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
const final = args.includes("--final");
const keyword = opt("keyword") || "";
if (!keyword) { console.error("--keyword is required (the focus keyword)"); process.exit(2); }

const m = qaMetrics(html, {
  primaryKeyword: keyword, title: opt("title"), siteUrl: opt("site"),
  metaTitle: opt("meta-title"), metaDescription: opt("meta-desc"), slug: opt("slug"),
  minWords: final ? 1500 : 1100, maxWords: final ? 2000 : 1560, maxH2: (final || /faq-item/.test(html)) ? 8 : 7,
  checkLinks: final, checkFaq: final
});

console.log("\nwords " + m.words + " | H2 " + m.h2 + " | H3 " + m.h3 + " | tables " + m.tables + "/" + m.tablesExpected + " | lists " + m.lists + " | bold " + m.strong + " | images " + m.images);
console.log("paragraph max " + m.maxParagraphWords + " words | passive " + m.passivePct + "% | transitions " + m.transitionPct + "% | keyword uses " + m.keyword.count + " (" + m.keyword.density + "%)");
console.log("internal links " + m.links.internal.length + " | external links " + m.links.external.length + " | FAQ " + m.faq.count + "\n");
for (const c of m.checks) {
  const mark = c.pass === true ? "PASS" : c.pass === false ? "FAIL" : "n/a ";
  console.log(mark + "  point " + String(c.point).padStart(2) + "  " + c.id.padEnd(16) + c.detail);
}
const failed = m.checks.filter((c) => c.pass === false);
console.log("\n" + (failed.length ? failed.length + " rule(s) failed" : "all measured rules passed") + (m.hardFails.length ? " (" + m.hardFails.length + " hard)" : ""));
if (m.passiveExamples.length && m.passivePct > 10) console.log("passive examples: " + m.passiveExamples.map((s) => '"' + s.slice(0, 80) + '"').join(" | "));
process.exit(failed.length ? 1 : 0);
