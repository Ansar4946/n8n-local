/*__QA__*/
// Last check before WordPress: measures the REAL post (after links, pictures, quick-info and FAQ were added).
// It never blocks the draft (a person reviews drafts anyway); it writes a per-point report into the sheet.
const ctx = $json;
if (!ctx.post_payload) return [{ json: ctx }];
const cfg = $('⚙️ Config').first().json;
const internalCfg = Number(cfg.internal_links_target || 3);
const qa = qaMetrics(ctx.post_payload.content, {
  primaryKeyword: ctx.keyword,
  title: ctx.post_payload.title,
  metaTitle: ctx.seo_meta?.seo_title,
  metaDescription: ctx.seo_meta?.meta_description,
  slug: ctx.post_payload.slug,
  siteUrl: ctx.site_url,
  minWords: Number(cfg.article_min_words || 1500),
  maxWords: Number(cfg.article_max_words || 2000),
  maxH2: Number(cfg.h2_max || 8), minH3: Number(cfg.h3_min || 2),
  maxParagraphWords: Number(cfg.max_paragraph_words || 300),
  maxPassivePct: Number(cfg.max_passive_pct || 10), minTransitionPct: Number(cfg.min_transition_pct || 35),
  maxImages: Number(cfg.max_images || 4),
  checkLinks: true, checkFaq: true,
  internalAvailable: Math.min(internalCfg, (ctx.internal_link_candidates || []).length),
  externalAvailable: Math.min(Number(cfg.external_links_target || 2), (ctx.external_link_candidates || []).length)
});
const points = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const passed = points.filter(p => qa.byPoint[p] && qa.byPoint[p].pass && qa.byPoint[p].checked > 0);
const failed = qa.checks.filter(c => c.pass === false).map(c => 'P' + c.point + ' ' + c.id + ' (' + c.detail + ')');
const summary = passed.length + '/' + points.length + ' rules' + (failed.length ? ' | fails: ' + failed.join('; ').slice(0, 300) : ' | all rules passed');
return [{ json: { ...ctx, final_qa: { words: qa.words, h2: qa.h2, h3: qa.h3, tables: qa.tables, images: qa.images, internal_links: qa.links.internal.length, external_links: qa.links.external.length, passive_pct: qa.passivePct, transition_pct: qa.transitionPct, max_paragraph_words: qa.maxParagraphWords, faq_count: qa.faq.count, meta_title_length: qa.metaTitleLength, meta_description_length: qa.metaDescriptionLength, slug: qa.slug, points_passed: passed, failed }, final_qa_summary: summary, phase_status: 'FINAL_QA_DONE' } }];
