// Table of contents (Rank Math "Content Readability": use a Table of Contents). Anchors go on every H2, the list goes right before the first H2.
// The wrapper carries the Rank Math TOC block class and id, so the SEO plugin recognises it; it is plain HTML, no block comments to break.
{
  const tocSeen = new Set();
  const tocItems = [];
  html = html.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (full, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
    if (!text) return full;
    const idm = /\sid="([^"]+)"/i.exec(attrs);
    let id = idm ? idm[1] : 'h-' + text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    if (!id || id === 'h-') id = 'h-section';
    let base = id, n = 2;
    while (tocSeen.has(id)) id = base + '-' + (n++);
    tocSeen.add(id);
    tocItems.push({ id, text });
    return idm ? full : '<h2' + attrs + ' id="' + id + '">' + inner + '</h2>';
  });
  if (tocItems.length >= 3 && !/rank-math-toc|class="[^"]*toc[^"]*"/i.test(html)) {
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tocHtml = '<div class="wp-block-rank-math-toc-block" id="rank-math-toc" style="max-width:800px;margin:1.5em auto;padding:1em 1.25em;background:#f7f7f7;border:1px solid #e0e0e0;border-radius:8px;">'
      + '<p class="toc-title" style="font-weight:700;font-size:1.1em;margin:0 0 .5em;">Table of Contents</p><nav><ul style="margin:0;padding-left:1.2em;">'
      + tocItems.map((x) => '<li><a href="#' + x.id + '">' + esc(x.text) + '</a></li>').join('')
      + '</ul></nav></div>';
    const firstH2 = html.search(/<h2\b/i);
    if (firstH2 > 0) html = html.slice(0, firstH2) + tocHtml + '\n' + html.slice(firstH2);
  }
}

