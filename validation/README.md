# Validation folder

Proof that the 15 blog-quality rules are built into the n8n workflow.

| File | What it is |
|---|---|
| `RESULTS.md` | The checklist: every point marked **DONE / NOT DONE** with the evidence. Created by `run-validation.js`. |
| `run-validation.js` | Loads the workflow JSON and runs its real Code-node code on mock data (draft gate, trim, FAQ, validation, links, images, WordPress payload, final report). No Gemini / Ahrefs / RankyTools request, so **0 credits**. |
| `check-article.js` | Checks one real article (after a live run) against the same rules. |
| `qa-metrics.js` | The single source of truth for all rules. The same text is embedded into the workflow nodes by `scripts/apply-quality-rules.js`. |
| `fixtures/sample-article.html` | A correct sample article (used as the "good" case). |
| `fixtures/old-draft-before-rules.*` | A real Gemini draft from before the rules (the "bad" case). |

## Run

```
node validation/run-validation.js
node validation/check-article.js path/to/draft.html --keyword "your focus keyword" --site https://your-site.com --final
```

## The points (numbers from the requirement list; there is no 7 or 8)

| # | Rule | Where it is enforced |
|---|---|---|
| 1 | Correct slug | `Validate Article` builds it from the focus keyword (3-6 words, lowercase, hyphens, unique vs existing posts) |
| 2 | H2 max 8, H3, tables by length | Planner prompt + `Parse Plan` cap + draft gate + `Validate Article` |
| 3 | Bullet points and bold | Writer prompt + draft gate (lists, bold) |
| 4 | Max 2000 words | `Config` (1500-2000), writer budget, `Trim Article`, `Validate Article`, `Final QA Report` |
| 5 | Meta description max 160 | Code fix in `Validate Article` |
| 6 | Meta title 50-60 | Code fix in `Validate Article`, sent to Yoast / Rank Math by `Set SEO Meta` |
| 9 | Focus keyword in the blog | Draft gate (H1, first 100 words, H2, conclusion) + meta + slug + picture alt |
| 10 | Internal links, other categories | `Fetch WP Pages` (with categories) + `Score Internal Link Candidates` + `Enrich Article HTML` |
| 11 | No 3 headings with the same start | Prompt + draft gate |
| 12 | Paragraph max 300 words | Prompt + draft gate |
| 13 | External links by content | `Build External Link Plan` + `Enrich Article HTML` |
| 14 | Max 4 pictures | `Config.max_images`, search step, `Crop Image Prep` fix, `Enrich Article HTML` |
| 15 | FAQ quality | FAQ prompt (real Ahrefs questions, research facts), parser filter, injector, FAQPage schema |
| 16 | Passive voice max 10% | Prompt + draft gate (heuristic, see below) |
| 17 | Transition words above 30% | Prompt + draft gate (heuristic, see below) |

## How the loop works

1. Gemini writes a draft. 2. The critic (Gemini) scores it. 3. **Code** measures the draft (`Parse Critique`). If any
rule fails, the draft is rejected with exact rewrite orders ("3 headings start with How: ...", "passive voice 14%: rewrite
these sentences...") and the writer gets the previous draft back. This repeats up to `max_retries` (3) times.
4. Code fixes the mechanical items (meta title and description length, slug), validates again, injects the FAQ,
adds links and pictures, and `Final QA Report` writes `QA n/15 rules` into the sheet column `seo_qa_score`.

## Limits you should know

* Passive voice and transition words are measured with a word-list heuristic (similar to Yoast). It is close, not identical to Yoast.
  "was born" is not counted as passive.
* The tests use mock data. How often Gemini's first draft passes can only be seen in a real run.
* Setting the SEO title/description inside Yoast / Rank Math depends on the plugin exposing those meta keys over the REST API.
  `Set SEO Meta (best effort)` tries; if the site does not allow it the post is still created, and the values are in the sheet.
