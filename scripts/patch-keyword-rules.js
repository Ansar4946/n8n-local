/*
 * One-off source edit of validation/qa-metrics.js and the check defaults (already applied; kept for the record).
 *  - the focus keyword counts in H1, H2, conclusion and meta when the exact phrase OR all its words are there
 *    ("Hurricane Isaias" satisfies the keyword "isaias hurricane"); the first 100 words still need the exact phrase
 *  - meta fixers only prefix the keyword when its words are really missing
 */
const fs = require("fs");
const path = require("path");
const P = path.resolve(__dirname, "..", "validation", "qa-metrics.js");
let s = fs.readFileSync(P, "utf8");
const rep = (from, to) => { const c = s.split(from).length - 1; if (c !== 1) throw new Error("marker count " + c + ": " + from.slice(0, 70)); s = s.split(from).join(to); };

rep("function qaTitleCase(s) {",
  "/* the focus keyword is present when the exact phrase OR all of its words are there (any order) */\n" +
  "function qaHasKw(text, kw) {\n" +
  "  var t = qaNorm(text), k = qaNorm(kw);\n" +
  "  if (!k) return false;\n" +
  "  if (t.indexOf(k) !== -1) return true;\n" +
  "  var words = t.split(' ');\n" +
  "  var need = k.split(' ').filter(function (w) { return QA_STOP.indexOf(w) === -1; });\n" +
  "  return need.length > 0 && need.every(function (w) { return words.indexOf(w) !== -1 || words.indexOf(w + 's') !== -1; });\n" +
  "}\nfunction qaTitleCase(s) {");

rep("var kwInH1 = !!kw && qaNorm(h1Text).indexOf(kw) !== -1;", "var kwInH1 = !!kw && qaHasKw(h1Text, kw);");
rep("var kwInH2 = !!kw && h2s.some(function (h) { return qaNorm(h).indexOf(kw) !== -1; });", "var kwInH2 = !!kw && h2s.some(function (h) { return qaHasKw(h, kw); });");
rep("var kwInConclusion = !!kw && qaNorm(concHtml).indexOf(kw) !== -1;", "var kwInConclusion = !!kw && qaHasKw(concHtml, kw);");
rep("var kwInMetaTitle = !!kw && qaNorm(o.metaTitle || '').indexOf(kw) !== -1;", "var kwInMetaTitle = !!kw && qaHasKw(o.metaTitle || '', kw);");
rep("var kwInMetaDesc = !!kw && qaNorm(o.metaDescription || '').indexOf(kw) !== -1;", "var kwInMetaDesc = !!kw && qaHasKw(o.metaDescription || '', kw);");
rep("if (kw && qaNorm(s).indexOf(qaNorm(kw)) === -1) s = kw + ': ' + s;", "if (kw && !qaHasKw(s, kw)) s = kw + ': ' + s;");
rep("if (kw && qaNorm(s).indexOf(qaNorm(kw)) === -1) s = qaTitleCase(kw) + ': ' + s;", "if (kw && !qaHasKw(s, kw)) s = qaTitleCase(kw) + ': ' + s;");

rep("'keyword in title/H1: ' + kwInH1, true, 'The exact focus keyword \"' + (o.primaryKeyword || '') + '\" must appear in the H1.');",
    "'keyword in title/H1: ' + kwInH1, true, 'The H1 must contain the focus keyword \"' + (o.primaryKeyword || '') + '\" (or at least all of its words, for example \"Hurricane Isaias\" for \"isaias hurricane\").');");
rep("'keyword in an H2: ' + kwInH2, true, 'Use the exact focus keyword \"' + (o.primaryKeyword || '') + '\" in at least one H2 heading.');",
    "'keyword in an H2: ' + kwInH2, true, 'At least one H2 heading must contain the focus keyword \"' + (o.primaryKeyword || '') + '\" (or all of its words).');");
rep("'Mention the exact focus keyword once in the Conclusion.'", "'Mention the focus keyword (or all of its words) once in the Conclusion.'");
fs.writeFileSync(P, s);
console.log("qa-metrics.js updated");
