const ctx = $json;
const enrichedWrapper = (ctx.article && typeof ctx.article === 'object') ? ctx.article : {};
const originalArticle = (ctx.article_json && typeof ctx.article_json === 'object') ? ctx.article_json : {};
const article = { ...originalArticle, article: String(enrichedWrapper.article || ctx.article_html || originalArticle.article || '') };
if (!article.article || article.article.length < 200) { return [{ json: { ...ctx, post_payload: null, prep_error: 'No HTML content found', phase_status: 'WP_PAYLOAD_FAILED' } }]; }
const site = String(ctx.site_url || '').replace(/\/+$/, '');

// slug (point 1): built by ✅ Validate Article from the focus keyword and checked against the posts that already exist.
// Fallback only if that field is missing: the focus keyword, lowercase, hyphenated, at most 6 words.
const fallbackSlug = String(ctx.keyword || article.title || 'blog-post').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-');
const slug = String(article.slug || '').trim() || fallbackSlug;
const canonical = site && slug ? `${site}/${slug}/` : site;
const metaTitle = String(article.metaTitle || article.title || ctx.keyword || '');
const metaDescription = String(article.metaDescription || '');
const cfg = $('⚙️ Config').first().json;
const publish = (ctx.auto_publish_requested === true) && String(cfg.auto_publish_mode || '') === 'auto_publish';
return [{ json: { ...ctx, post_payload: { title: article.title || ctx.keyword, content: article.article, excerpt: metaDescription || article.excerpt || '', slug, status: publish ? 'publish' : 'draft', featured_media: ctx.featuredMediaId || 0 }, canonical_url: canonical, seo_meta: { seo_title: metaTitle, meta_description: metaDescription, canonical_url: canonical, focus_keyword: ctx.keyword }, phase_status: 'WP_PAYLOAD_READY' } }];
