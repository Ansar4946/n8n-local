/*__QA__*/
let ctx = $json || {};
try { const pp = $('📋 Parse Plan').first().json; if (pp) { if (!ctx.writer_context && pp.writer_context) ctx.writer_context = pp.writer_context; if (!ctx.keyword && pp.keyword) ctx.keyword = pp.keyword; if (!ctx.site_url && pp.site_url) ctx.site_url = pp.site_url; if (!ctx.topic_id && pp.topic_id) ctx.topic_id = pp.topic_id; if (!ctx.existing_slugs && pp.existing_slugs) ctx.existing_slugs = pp.existing_slugs; } } catch (e) {}
const source = ctx.article_json || ctx.article || {};
let articleHtml = '';
if (typeof source === 'string') articleHtml = source;
else if (typeof source === 'object' && source !== null) articleHtml = String(source.article || source.article_html || '');
if (!articleHtml && typeof ctx.article_html === 'string') articleHtml = ctx.article_html;
if (!articleHtml || articleHtml.length < 200) { return [{ json: { ...ctx, quality_passed: false, qa_reason: 'article_missing', word_count: 0, h1_count: 0, h2_count: 0, h3_count: 0, phase_status: 'ARTICLE_QA_FAILED' } }]; }

const dashFix = s => typeof s === 'string' ? s.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[–—]\s*/g, ', ').replace(/,\s*,/g, ',') : s;
const subjWord = String(ctx.writer_context?.blogTitle || ctx.title || '').split(':')[0].trim().split(/\s+/).pop().replace(/[^A-Za-z]/g, '');
const apFix = s => (typeof s === 'string' && subjWord.length > 2) ? s.replace(new RegExp('\\b' + subjWord + 's\\b', 'g'), subjWord + "'s") : s;
const fixText = s => apFix(dashFix(s));
articleHtml = fixText(articleHtml);
// the exact focus keyword must open the introduction: code repairs it when the model put it in sentence 2 or 3
articleHtml = qaFixH1Keyword(articleHtml, ctx.writer_context?.primaryKeyword || ctx.primary_keyword || ctx.keyword || '');
articleHtml = qaFixIntroKeyword(articleHtml, ctx.writer_context?.primaryKeyword || ctx.primary_keyword || ctx.keyword || '');

const articleObj = (typeof source === 'object' && source !== null) ? { ...source, article: articleHtml } : { article: articleHtml };
for (const k of ['title', 'metaTitle', 'metaDescription', 'excerpt']) { if (typeof articleObj[k] === 'string') articleObj[k] = fixText(articleObj[k]); }

// ---- code fixes for the mechanical SEO rules (the model cannot count characters) ----
const cfgV = $('⚙️ Config').first().json;
const kwV = String(ctx.writer_context?.primaryKeyword || ctx.primary_keyword || ctx.keyword || '').trim();
const h1Raw = (articleHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
const postTitle = String(articleObj.title || ctx.h1_title || h1Raw.replace(/<[^>]+>/g, ' ') || kwV).replace(/\s+/g, ' ').trim();
articleObj.metaTitle = fixMetaTitle(articleObj.metaTitle || ctx.meta_title, kwV, postTitle, { min: Number(cfgV.title_min_chars || 50), max: Number(cfgV.title_max_chars || 60) });
articleObj.metaDescription = fixMetaDescription(articleObj.metaDescription || ctx.meta_description || articleObj.excerpt, kwV, { min: Number(cfgV.meta_min_chars || 120), max: Number(cfgV.meta_max_chars || 160) });
articleObj.slug = makeSlug(kwV, postTitle, ctx.existing_slugs || []);

// ---- measure everything ----
const maxTotal = Number(cfgV.article_max_words || 2000);
const minTotal = Number(cfgV.article_min_words || 1500);
const bodyMin = minTotal - 120; // the FAQ is already inside; quick-info table, table of contents and link sentences (~120-150 words) come after
const bodyMax = maxTotal - 150;
const qa = qaMetrics(articleHtml, {
  primaryKeyword: kwV, title: postTitle,
  metaTitle: articleObj.metaTitle, metaDescription: articleObj.metaDescription, slug: articleObj.slug,
  siteUrl: ctx.site_url,
  minWords: bodyMin,
  maxWords: bodyMax, // the FAQ block, quick-info table and link sentences are added afterwards
  densityMin: Number(cfgV.kw_density_min || 2), densityMax: Number(cfgV.kw_density_max || 2.5), densityWordsAdd: 150,
  maxH2: Number(cfgV.h2_max || 8), minH3: Number(cfgV.h3_min || 2),
  maxParagraphWords: Number(cfgV.max_paragraph_words || 300),
  maxPassivePct: Number(cfgV.max_passive_pct || 10), minTransitionPct: Number(cfgV.min_transition_pct || 35),
  maxImages: Number(cfgV.max_images || 4),
  checkFaq: true
});

const h1Count = (articleHtml.match(/<h1\b/gi) || []).length;
const hasFaq = /<details\s+class="faq-item"/i.test(articleHtml) || /<div\s+class="faq-item"/i.test(articleHtml);
const hardReasons = qa.hardFails.map(c => c.id + ': ' + c.detail);
if (h1Count !== 1) hardReasons.push('h1_count is ' + h1Count + ' (expected 1)');
if (!hasFaq) hardReasons.push('no FAQ section detected');
const qualityPassed = hardReasons.length === 0;

// SEO score 0-100: every measured rule counts, hard rules count double
const scored = qa.checks.filter(c => c.pass !== null);
const wt = c => (c.hard ? 2 : 1);
const seoScore = Math.round(100 * scored.reduce((a, c) => a + (c.pass ? wt(c) : 0), 0) / Math.max(1, scored.reduce((a, c) => a + wt(c), 0)));
const seoReport = qa.checks.map(c => ({ point: c.point, check: c.id, pass: c.pass, detail: c.detail }));
const qaPoints = {};
for (const p of Object.keys(qa.byPoint)) qaPoints[p] = qa.byPoint[p].pass;

return [{ json: { ...ctx, article: articleObj, article_json: { ...(ctx.article_json || {}), ...articleObj, article: articleHtml }, article_html: articleHtml, quality_passed: qualityPassed, qa_reason: qualityPassed ? '' : hardReasons.join('; '), qa_soft_flags: qa.softFails.map(c => c.id + ': ' + c.detail), word_count: qa.words, h1_count: h1Count, h2_count: qa.h2, h3_count: qa.h3, has_faq: hasFaq, word_count_range: { min_accepted: bodyMin, max_accepted: bodyMax }, seo_score: seoScore, seo_report: seoReport, qa_points: qaPoints, keyword_density: qa.keyword.density, avg_sentence_words: qa.sentences ? Math.round((qa.words / qa.sentences) * 10) / 10 : 0, passive_pct: qa.passivePct, transition_pct: qa.transitionPct, phase_status: qualityPassed ? 'ARTICLE_QA_PASSED' : 'ARTICLE_QA_FAILED' } }];
