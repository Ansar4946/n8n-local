let ctx = $json || {};
try { const p = $('📥 Parse Article').first().json; if (p) ctx = { ...p, ...ctx }; } catch (e) {}
try { const pp = $('📋 Parse Plan').first().json; if (pp && pp.writer_context) ctx.writer_context = ctx.writer_context || pp.writer_context; } catch (e) {}
const articleJson = ctx.article_json || {};
let html = '';
if (typeof articleJson.article === 'string' && articleJson.article.length > 100) html = articleJson.article;
else if (typeof articleJson.article_html === 'string' && articleJson.article_html.length > 100) html = articleJson.article_html;
else if (typeof ctx.article_html === 'string' && ctx.article_html.length > 100) html = ctx.article_html;
else if (typeof ctx.article === 'string' && ctx.article.length > 100) html = ctx.article;
else if (ctx.article && typeof ctx.article === 'object' && typeof ctx.article.article === 'string') html = ctx.article.article;
if (!html || html.length < 200) return [{ json: { ...ctx, trim_status: 'skipped_no_html', phase_status: 'ARTICLE_TRIM_SKIPPED' } }];

// The article may never pass the hard word limit. The FAQ block, quick-info table and links are added later,
// so the body budget is wordCountRange.max (article_max_words minus that reserve).
const wc = ctx.writer_context || {};
const maxWords = Number(wc.wordCountRange?.max || 1630);
function countWords(h) { return String(h).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length; }
const wordsBefore = countWords(html);
let removed = 0;
if (wordsBefore > maxWords) {
  // Remove whole trailing paragraphs from the longest middle section until the budget is met.
  // The intro (first block) and the last section (Conclusion) are never touched.
  const parts = html.split(/(?=<h2\b)/i);
  let guard = 0;
  while (countWords(parts.join('')) > maxWords && guard++ < 80) {
    let bestIdx = -1, bestWords = 0;
    for (let i = 1; i < parts.length - 1; i++) {
      const paras = parts[i].match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
      const w = countWords(parts[i]);
      if (paras.length >= 3 && w > bestWords) { bestWords = w; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const paras = parts[bestIdx].match(/<p\b[^>]*>[\s\S]*?<\/p>/gi);
    parts[bestIdx] = parts[bestIdx].replace(paras[paras.length - 1], '');
    removed++;
  }
  html = parts.join('');
}
const words = countWords(html);
return [{ json: { ...ctx, article_json: { ...articleJson, article: html }, article: { ...(ctx.article || articleJson), article: html }, article_html: html, trim_status: removed ? 'trimmed' : 'ok', trim_removed_paragraphs: removed, trim_words_before: wordsBefore, trimmed_word_count: words, phase_status: 'ARTICLE_TRIMMED' } }];
