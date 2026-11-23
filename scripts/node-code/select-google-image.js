// 🖼️ Select Google Image: picks the BEST picture per query by score (relevance, size, shape, licence, variety)
// Input: one item per query (from 🔍 Google Images Search). Output: one item per query with a good picture.
const withKeyword = (t, kw) => { t = String(t || '').trim(); kw = String(kw || '').trim(); if (!kw) return t; return t.toLowerCase().includes(kw.toLowerCase()) ? t : (kw + ': ' + t); };
const cleanImgTitle = (t, fallback) => { let s = String(t || '').split(/\s[|–—-]\s/)[0].replace(/[.…]+$/, '').replace(/\s+/g, ' ').trim(); if (s.length < 8 || s.length > 110) s = String(fallback || '').trim(); return s; };

const ctxItems = $('🖼️ Prepare Image Searches').all();
const inputItems = $input.all();
const out = [];

const stockHosts = ['gettyimages.com', 'istockphoto.com', 'shutterstock.com', 'alamy.com', 'dreamstime.com', 'depositphotos.com', '123rf.com', 'stock.adobe.com', 'adobe.com/stock', 'vectorstock.com', 'bigstockphoto.com', 'canstockphoto.com'];
const junkWords = ['logo', 'icon', 'sprite', 'banner', 'button', 'flag-thumb', 'avatar', 'placeholder', 'favicon', 'thumbnail'];
const weakHosts = ['pinterest.', 'facebook.', 'instagram.', 'tiktok.', 'twitter.', 'x.com', 'lookaside', 'fbcdn', 'ytimg', 'reddit', 'wallpaper', 'quora'];
const clutterWords = ['step and repeat', 'step-and-repeat', 'backdrop', 'sponsor', 'press wall', 'wallpaper', 'poster', 'meme', 'collage', 'screenshot'];
const NOISE = ['net', 'worth', 'age', 'height', 'wife', 'husband', 'biography', 'bio', 'wiki', 'news', 'guide', 'how', 'what', 'when', 'where', 'why', 'does', 'the', 'and', 'for', 'with', 'from', 'about', 'is', 'are', 'to', 'of', 'in', 'on', 'a', 'an', 'requirements', 'deadline', 'deadlines', 'documents', 'rules', 'tips', 'best', 'top'];

function safeUrl(u) {
  if (!u || typeof u !== 'string') return u;
  return String(u).replace(/ /g, '%20').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokensOf = (s) => norm(s).split(' ').filter((w) => w.length >= 3 && !NOISE.includes(w) && !/^20\d\d$/.test(w));
const hostOf = (u) => String(u || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase();

const usedUrls = new Set();
const usedTitles = [];
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach((x) => { if (B.has(x)) i++; }); return i / (A.size + B.size - i); };

for (let i = 0; i < inputItems.length; i++) {
  const resp = inputItems[i]?.json || {};
  const meta = ctxItems[i]?.json || {};
  const candidates = Array.isArray(resp.images) ? resp.images : [];
  const subject = tokensOf(meta.keyword || meta.primary_keyword || '');
  const queryTokens = tokensOf(meta.imageQuery || resp.query || '');
  const scored = [];

  for (const im of candidates) {
    const url = String(im.url || '');
    const lu = url.toLowerCase();
    if (!lu.startsWith('http')) continue;
    if (stockHosts.some((h) => lu.includes(h) || String(im.sourceUrl || '').toLowerCase().includes(h))) continue;
    if (junkWords.some((w) => lu.includes(w))) continue;
    if (usedUrls.has(url)) continue;

    const text = norm([im.title, im.alt, im.description, im.sourceUrl, url].join(' '));
    const words = new Set(text.split(' '));
    const hit = (t) => words.has(t) || text.includes(t);
    const subjectHit = subject.length ? subject.filter(hit).length / subject.length : 0.5;
    const queryHit = queryTokens.length ? queryTokens.filter(hit).length / queryTokens.length : 0.5;
    const w = Number(im.width) || 0, h = Number(im.height) || 0;
    const ratio = w && h ? w / h : 0;

    let score = 0;
    const why = [];
    score += subjectHit * 55; why.push('subject ' + Math.round(subjectHit * 100) + '%');
    score += queryHit * 15;
    if (subject.length && subjectHit < 0.5) { score -= 40; why.push('off-topic'); }
    // size: small pictures get blurry when enlarged to 1600 px
    if (w >= 1400 && h >= 700) score += 15; else if (w >= 1000 && h >= 560) score += 8; else if (w && w < 800) { score -= 40; why.push('too small'); }
    // shape: close to 16:9 means nothing is lost
    if (ratio >= 1.6 && ratio <= 2.0) score += 20; else if (ratio >= 1.35 && ratio < 1.6) score += 8; else if (ratio && ratio < 1) { score -= 20; why.push('portrait'); }
    if (im.freeLicense) { score += 25; why.push('free licence'); if (im.publicDomain) score += 5; }
    const hay = norm((im.title || '') + ' ' + url);
    if (clutterWords.some((c) => hay.includes(norm(c)))) { score -= 15; why.push('cluttered'); }
    if (weakHosts.some((x) => lu.includes(x) || hostOf(im.sourceUrl).includes(x))) { score -= 30; why.push('weak host'); }
    // variety: do not pick a near copy of a picture that is already used
    const tk = tokensOf(im.title);
    if (usedTitles.some((u) => jaccard(u, tk) >= 0.7)) { score -= 35; why.push('duplicate'); }
    scored.push({ im, score, why, w, h });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // no usable picture: skip this query instead of publishing a wrong one
  if (!best || best.score < 25) {
    console.warn('[select] no good picture for "' + (meta.imageQuery || resp.query || i) + '" (best score ' + (best ? Math.round(best.score) : 'none') + ')');
    continue;
  }
  const picked = best.im;
  usedUrls.add(String(picked.url));
  usedTitles.push(tokensOf(picked.title));

  const base = String(meta.imageQuery || resp.query || 'blog').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'blog';
  const title = cleanImgTitle(picked.title, meta.imageQuery).slice(0, 120);
  out.push({
    json: {
      imageFound: true, imageIndex: i, imageRole: i === 0 ? 'featured' : 'contextual',
      imageQuery: meta.imageQuery || resp.query || '', articleSection: meta.articleSection || '',
      downloadUrl: safeUrl(picked.downloadUrl || picked.url), sourceUrl: safeUrl(picked.url), originalUrl: safeUrl(picked.originalUrl || picked.url),
      source: picked.source || 'duckduckgo', width: best.w, height: best.h,
      filename: base + '-' + (i + 1) + '.jpg',
      title,
      altText: (i === 0 ? withKeyword(title, meta.keyword) : title).slice(0, 125),
      caption: picked.attribution || '', attribution: picked.attribution || '',
      description: (meta.imageQuery || '') + '. Section: ' + (meta.articleSection || '') + '.',
      imageScore: Math.round(best.score), imageScoreReasons: best.why.join(', '),
      candidateCount: candidates.length, cleanCount: scored.length
    }
  });
}

if (out.length === 0) {
  console.warn('[select] no good pictures across any query');
  return [{ json: { imageFound: false, reason: 'NO_CLEAN_IMAGES' } }];
}
console.log('[select] picked ' + out.length + ' picture(s): ' + out.map((o) => o.json.imageScore).join(', '));
return out;
