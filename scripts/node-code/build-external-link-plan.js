// External links (point 13): trusted pages that match the article topic, never social media or the own site
const ctx = $json;
const competitors = (ctx.competitors || []).filter(c => c.usable && c.url);
const hostOf = u => String(u || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase();
const siteHost = hostOf(ctx.site_url);
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'how', 'why', 'who', 'when', 'where', 'which', 'your', 'you', 'are', 'was', 'were', 'this', 'that', 'into', 'about', 'more', 'best', 'top', '2024', '2025', '2026', '2027']);
const toks = s => String(s || '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const topicWords = new Set([...toks(ctx.keyword), ...toks(ctx.title), ...(Array.isArray(ctx.secondary_keywords) ? ctx.secondary_keywords : []).slice(0, 8).flatMap(k => toks(typeof k === 'string' ? k : k.keyword))]);
const SOCIAL = ['instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com', 'pinterest.com', 'quora.com', 'linkedin.com', 'medium.com', 'blogspot.com', 'wordpress.com', 'tumblr.com', 'google.com', 'bing.com', 'amazon.com', 'ebay.com'];
const AUTH = ['wikipedia.org', 'britannica.com', 'forbes.com', 'imdb.com', 'biography.com', 'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com', 'theguardian.com', 'washingtonpost.com', 'bloomberg.com', 'cnbc.com', 'techcrunch.com', 'theverge.com', 'wired.com', 'statista.com', 'hbr.org', 'nature.com', 'sciencedirect.com', 'who.int', 'nih.gov', 'cdc.gov', 'mozilla.org', 'ahrefs.com', 'semrush.com', 'moz.com', 'searchenginejournal.com', 'searchengineland.com', 'hubspot.com', 'developers.google.com', 'support.google.com', 'cloudflare.com', 'wordpress.org', 'github.com'];
const inList = (d, list) => list.some(p => d === p || d.endsWith('.' + p));
const isGovEdu = d => /\.(gov|edu)$/.test(d) || /\.(gov|edu)\.[a-z]{2}$/.test(d);

const seen = new Set();
const external = [];
for (const c of competitors) {
  const domain = String(c.domain || '').toLowerCase().replace(/^www\./, '');
  if (!domain || seen.has(domain) || domain === siteHost || inList(domain, SOCIAL)) continue;
  const path = String(c.url).replace(/^https?:\/\/[^\/]+/i, '').split(/[?#]/)[0] || '';
  if (path.length < 2) continue; // skip bare home pages, link to the real page
  const authority = inList(domain, AUTH) || isGovEdu(domain);
  const rating = Number(String(c.pageAS || '').replace(/[^0-9.]/g, '')) || 0;
  if (!authority && rating < 75) continue;
  const title = String(c.seo?.title || c.title || '');
  const overlap = toks(title + ' ' + path).filter(w => topicWords.has(w)).length;
  if (overlap === 0 && !authority) continue;
  seen.add(domain);
  const short = title.split(/\s[|–—-]\s/)[0].replace(/\s+/g, ' ').trim().slice(0, 70) || domain;
  external.push({ domain, url: c.url, title: title || domain, anchor_text: short, authority, rating, relevance: overlap, reason: authority ? 'trusted source' : 'high rating (' + rating + ') and on topic' });
}
external.sort((a, b) => (Number(b.authority) - Number(a.authority)) || (b.relevance - a.relevance) || (b.rating - a.rating));
return [{ json: { ...ctx, external_link_candidates: external.slice(0, 3), phase_status: 'EXTERNAL_LINKS_READY' } }];
