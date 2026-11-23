// Internal links (point 10): pick related posts, spread over DIFFERENT categories when possible
const ctx = $('🧩 Build FAQ Plan').first().json;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'what', 'how', 'why', 'who', 'when', 'where', 'which', 'your', 'you', 'are', 'was', 'were', 'this', 'that', 'into', 'about', 'more', 'best', 'top', '2024', '2025', '2026', '2027']);
const toks = s => String(s || '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
const kwWords = [...new Set(toks(ctx.keyword))];
const secWords = (Array.isArray(ctx.secondary_keywords) ? ctx.secondary_keywords : []).slice(0, 12).flatMap(k => toks(typeof k === 'string' ? k : k.keyword));
const lsiWords = (Array.isArray(ctx.lsi_keywords) ? ctx.lsi_keywords : []).flatMap(k => toks(typeof k === 'string' ? k : k.keyword));
const topicWords = new Set([...kwWords, ...toks(ctx.title), ...secWords, ...lsiWords]);
const GENERIC = new Set(['work', 'tips', 'guide', 'ideas', 'review', 'online', 'free', 'business', 'list', 'world', 'life']);
const pages = $input.all().map(i => i.json).filter(p => p && p.id && p.link);

const allScored = pages.map(p => {
  const title = String(p.title?.rendered || p.title || '');
  const pageWords = new Set(toks(title + ' ' + (p.slug || '')));
  const overlapPrimary = kwWords.filter(w => pageWords.has(w)).length;
  const sharedTopic = [...pageWords].filter(w => topicWords.has(w));
  const overlapTopic = sharedTopic.length;
  // one shared word is enough when it is a real topic word (not a generic one like 'work' or 'tips')
  const strongSingle = overlapTopic === 1 && sharedTopic[0].length >= 5 && !GENERIC.has(sharedTopic[0]);
  const primaryRatio = overlapPrimary / Math.max(kwWords.length, 1);
  const terms = Array.isArray(p._embedded?.['wp:term']) ? (p._embedded['wp:term'][0] || []) : [];
  const category = (terms[0] && (terms[0].name || terms[0].slug)) || (Array.isArray(p.categories) && p.categories[0] != null ? 'cat-' + p.categories[0] : 'uncategorized');
  return {
    id: p.id, url: p.link, title: title.replace(/<[^>]+>/g, '').replace(/&#8217;/g, "'").replace(/&amp;/g, '&'), slug: p.slug || '', category,
    relevance: Math.max(primaryRatio, Math.min(1, overlapTopic / 4), strongSingle ? 0.25 : 0), eligible: primaryRatio >= 0.5 || overlapTopic >= 2 || strongSingle
  };
}).sort((a, b) => b.relevance - a.relevance);
const scored = allScored.filter(p => p.eligible);

// pass 1: the best post of each different category; pass 2: fill with the next best
const picked = [];
const usedCats = new Set();
for (const p of scored) { if (picked.length >= 5) break; if (!usedCats.has(p.category)) { picked.push(p); usedCats.add(p.category); } }
for (const p of scored) { if (picked.length >= 5) break; if (!picked.includes(p)) picked.push(p); }

// fallback: a new blog has few related posts. SEO plugins still want internal links, so fill up to 2 with the most relevant remaining posts (different categories first)
const MIN_LINKS = 2;
if (picked.length < MIN_LINKS) {
  const rest = allScored.filter(p => !picked.includes(p));
  for (const p of rest) { if (picked.length >= MIN_LINKS) break; if (!usedCats.has(p.category)) { picked.push(p); usedCats.add(p.category); } }
  for (const p of rest) { if (picked.length >= MIN_LINKS) break; if (!picked.includes(p)) picked.push(p); }
}

return [{ json: { ...ctx, internal_link_candidates: picked, internal_link_categories: [...usedCats], existing_slugs: pages.map(p => p.slug).filter(Boolean), wp_posts_found: pages.length, phase_status: 'INTERNAL_LINKS_READY' } }];
