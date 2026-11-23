/*
 * Switches the SERP step of the workflow to the Ahrefs SERP endpoint, with the SEMrush endpoint as the fallback:
 *
 *   Keyword Approved? -> Ahrefs SERP (/ahrefs-serp-data) -> Ahrefs SERP found? -- yes --> Validate SERP
 *                                                                              -- no  --> SEMrush SERP (/serp-data) -> Validate SERP
 *
 * Run it AFTER scripts/apply-quality-rules.js:   node scripts/apply-ahrefs-serp.js
 * It is safe to run twice (it does nothing when the Ahrefs SERP node already exists).
 */
const fs = require("fs");
const path = require("path");
const F = path.resolve(__dirname, "..", "SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json");
const w = JSON.parse(fs.readFileSync(F, "utf8"));
const N = (n) => { const x = w.nodes.find((y) => y.name === n); if (!x) throw new Error("missing node: " + n); return x; };

if (w.nodes.some((n) => n.name === "📊 Ahrefs SERP")) { console.log("already applied"); process.exit(0); }

const semrush = N("📊 SEMrush SERP");
const approved = N("❓ Keyword Approved?");

// 1. Ahrefs SERP node (clone of the HTTP node, new URL)
const ahrefs = JSON.parse(JSON.stringify(semrush));
ahrefs.id = "f3b2c5d4-8e33-4b9a-9c43-7a5e9d3c1b24";
ahrefs.name = "📊 Ahrefs SERP";
ahrefs.position = [semrush.position[0], semrush.position[1]];
ahrefs.parameters.url = "http://playwright:3000/ahrefs-serp-data";
ahrefs.parameters.jsonBody = "={{ JSON.stringify({ keyword: $json.primary_keyword, maxResults: 10, refresh: true }) }}";
ahrefs.parameters.options = { response: { response: { neverError: true } }, timeout: 180000 };
w.nodes.push(ahrefs);

// 2. IF: did Ahrefs return at least 3 organic results?
const found = JSON.parse(JSON.stringify(approved));
found.id = "a4c3d6e5-9f44-4c0b-8d54-8b6f0e4d2c35";
found.name = "❓ Ahrefs SERP found?";
found.position = [semrush.position[0] + 224, semrush.position[1]];
found.parameters.conditions.conditions = [{
  id: "serp1",
  leftValue: "={{ Number($json.serp?.resultsFound || 0) >= 3 }}",
  rightValue: "true",
  operator: { type: "boolean", operation: "true", singleValue: true }
}];
w.nodes.push(found);

// 3. SEMrush SERP is now the fallback: it reads the keyword from the approved branch, not from the Ahrefs answer
semrush.position = [semrush.position[0] + 448, semrush.position[1] + 216];
semrush.parameters.jsonBody = "={{ JSON.stringify({ keyword: $('❓ Keyword Approved?').first().json.primary_keyword }) }}";

// 4. wiring
w.connections["❓ Keyword Approved?"].main[0] = [{ node: ahrefs.name, type: "main", index: 0 }];
w.connections[ahrefs.name] = { main: [[{ node: found.name, type: "main", index: 0 }]] };
w.connections[found.name] = { main: [[{ node: "✅ Validate SERP", type: "main", index: 0 }], [{ node: semrush.name, type: "main", index: 0 }]] };
// "📊 SEMrush SERP" -> "✅ Validate SERP" stays as it was

w.active = false;
fs.writeFileSync(F, JSON.stringify(w, null, 2));
console.log("applied: Ahrefs SERP first, SEMrush SERP as fallback. nodes:", w.nodes.length);
