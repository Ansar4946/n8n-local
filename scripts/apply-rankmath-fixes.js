/*
 * Rank Math fixes (run once):  node scripts/apply-rankmath-fixes.js [workflow.json path]
 *  1. Internal link: the blog has 0 published posts, so no candidate existed. Last-resort candidate = the site home page (always live).
 *  2. Title number + power word: the SEO title already had both, but Rank Math never received it
 *     (rank_math_title is not writable through /wp/v2/posts). New node calls Rank Math's own endpoint /rankmath/v1/updateMeta.
 *  3. The post title (H1) is now the optimised title too, so Rank Math sees number + power word even if updateMeta is refused.
 * Works on the exported workflow JSON (file) and, with --db-out <file>, writes the patched nodes/connections JSON for the n8n database.
 */
const fs = require('fs');
const path = require('path');
const FILE = process.argv[2] || path.join(__dirname, '..', 'SEO Blog Automation V7.3 - Ahrefs SEO Upgrade.json');
const wf = JSON.parse(fs.readFileSync(FILE, 'utf8'));
patch(wf);
fs.writeFileSync(FILE, JSON.stringify(wf, null, 2));
console.log('patched', FILE);

function patch(wf) {
  const must = n => { const x = wf.nodes.find(y => y.name === n); if (!x) throw new Error('missing node ' + n); return x; };
  if (wf.nodes.some(n => n.name === '🔎 Rank Math Meta (updateMeta)')) throw new Error('already patched');

  // 1. internal link fallback = home page
  const sc = must('🔗 Score Internal Link Candidates');
  const anchor = "return [{ json: { ...ctx, internal_link_candidates: picked,";
  if (!sc.parameters.jsCode.includes(anchor)) throw new Error('score anchor');
  sc.parameters.jsCode = sc.parameters.jsCode.replace(anchor,
    "// last resort: a new blog may have no published posts yet. The home page is always live and counts as an internal link for Rank Math.\n" +
    "if (picked.length === 0 && ctx.site_url) {\n" +
    "  const base = String(ctx.site_url).replace(/\\/+$/, '');\n" +
    "  const host = base.replace(/^https?:\\/\\//, '').replace(/^www\\./, '');\n" +
    "  picked.push({ id: 0, url: base + '/', title: 'more guides on ' + host, slug: '', category: 'home', relevance: 0, eligible: true });\n" +
    "}\n" + anchor);

  // 3. post title = optimised SEO title
  const pw = must('📦 Prep WP Payload');
  const a = "post_payload: { title: article.title || ctx.keyword,";
  if (!pw.parameters.jsCode.includes(a)) throw new Error('payload anchor');
  pw.parameters.jsCode = pw.parameters.jsCode.replace(a, "post_payload: { title: (/\\d/.test(metaTitle) && metaTitle.length >= 30) ? metaTitle : (article.title || ctx.keyword),");

  // 2. Rank Math endpoint node
  const base = must('🔎 Set SEO Meta (best effort)');
  const N = "$('🔧 Normalize WP Result').first().json";
  const node = {
    parameters: {
      method: 'POST',
      url: "={{ " + N + ".site_url + '/wp-json/rankmath/v1/updateMeta' }}",
      authentication: 'genericCredentialType',
      genericAuthType: 'httpBasicAuth',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ objectID: " + N + ".wp_post_id, objectType: 'post', meta: { rank_math_title: " + N + ".seo_meta.seo_title, rank_math_description: " + N + ".seo_meta.meta_description, rank_math_focus_keyword: " + N + ".seo_meta.focus_keyword } }) }}",
      options: { response: { response: { neverError: true, responseFormat: 'json' } }, timeout: 60000 }
    },
    id: 'b7c1d9e2-4f53-4a6e-9a10-3c2e8d5f7a41',
    name: '🔎 Rank Math Meta (updateMeta)',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: base.typeVersion,
    position: [base.position[0] + 320, base.position[1]],
    credentials: base.credentials,
    onError: 'continueRegularOutput'
  };
  wf.nodes.push(node);
  wf.connections[base.name] = { main: [[{ node: node.name, type: 'main', index: 0 }]] };
}
