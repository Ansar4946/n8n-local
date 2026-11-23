/*
 * Shared QA rules for the SEO Blog Automation workflow.
 *
 * This ONE file is the single source of truth. scripts/apply-quality-rules.js embeds its text
 * into the n8n Code nodes (Parse Critique, Validate Article, Prep WP Payload, Final QA Report),
 * and validation/*.js runs the very same functions offline. Plain ES2018, no dependencies.
 *
 * Points checked (numbers match the requirement list):
 *  1 slug | 2 H2 max 8, H3, tables | 3 bullet points and bold | 4 max words | 5 meta description
 *  6 meta title | 9 focus keyword | 10 internal links | 11 no 3 headings with the same start
 *  12 paragraph max words | 13 external links | 14 max images | 15 FAQ quality
 *  16 passive voice | 17 transition words
 */

var QA_DEFAULTS = {
  minWords: 1500, maxWords: 2000,
  maxH2: 8, minH3: 2,
  maxParagraphWords: 300,
  maxPassivePct: 10, minTransitionPct: 35,
  metaTitleMin: 50, metaTitleMax: 60, metaDescMax: 150, metaDescMin: 120,
  maxImages: 4, internalLinksMin: 2, externalLinksMin: 1, maxSlugChars: 60, maxSlugWords: 7,
  faqMin: 6, faqMax: 8, densityMin: 2.0, densityMax: 2.5, densityWordsAdd: 0, conclusionMinSentences: 6, faqAnswerMin: 25, faqAnswerMax: 90
};

var QA_STOP = ['a', 'an', 'the', 'of', 'and', 'or', 'to', 'is', 'are', 'was', 'were', 'at', 'in', 'on', 'for', 'with', 'by', 'from'];

function qaHost(u) { return String(u || '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].replace(/^www\./i, '').toLowerCase(); }
function qaStrip(s) {
  return String(s == null ? '' : s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function qaWords(s) { var t = qaStrip(s); return t ? t.split(' ').filter(Boolean).length : 0; }
function qaNorm(s) {
  return qaStrip(s).toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
/* the focus keyword is present when the exact phrase OR all of its words are there (any order) */
function qaHasKw(text, kw) {
  var t = qaNorm(text), k = qaNorm(kw);
  if (!k) return false;
  if (t.indexOf(k) !== -1) return true;
  var words = t.split(' ');
  var need = k.split(' ').filter(function (w) { return QA_STOP.indexOf(w) === -1; });
  return need.length > 0 && need.every(function (w) { return words.indexOf(w) !== -1 || words.indexOf(w + 's') !== -1; });
}
function qaTitleCase(s) {
  return String(s || '').split(/\s+/).filter(Boolean).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/* ---------- slug (point 1) ---------- */
function makeSlug(keyword, title, existingSlugs) {
  var base = String(keyword || title || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]s\b/g, 's').replace(/['’]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  var parts = base.split(' ').filter(Boolean);
  if (parts.length > 4) parts = parts.filter(function (w) { return QA_STOP.indexOf(w) === -1; });
  if (parts.length > QA_DEFAULTS.maxSlugWords) parts = parts.slice(0, QA_DEFAULTS.maxSlugWords);
  var slug = parts.join('-');
  while (slug.length > QA_DEFAULTS.maxSlugChars && parts.length > 1) { parts.pop(); slug = parts.join('-'); }
  slug = slug.replace(/^-+|-+$/g, '');
  if (!slug) slug = 'blog-post';
  var taken = (existingSlugs || []).map(function (s) { return String(s).toLowerCase(); });
  if (taken.indexOf(slug) !== -1) {
    var tries = [slug + '-guide', slug + '-explained', slug + '-2'];
    for (var i = 0; i < tries.length; i++) { if (taken.indexOf(tries[i]) === -1) { slug = tries[i]; break; } }
    if (taken.indexOf(slug) !== -1) slug = slug + '-' + (taken.length + 2);
  }
  return slug;
}

/* ---------- meta title / description fixers (points 5, 6) ---------- */
function fixMetaTitle(title, keyword, fallbackTitle, opts) {
  var min = (opts && opts.min) || QA_DEFAULTS.metaTitleMin, max = (opts && opts.max) || QA_DEFAULTS.metaTitleMax;
  var kw = qaTitleCase(qaStrip(keyword));
  var s = qaStrip(title || fallbackTitle || kw).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (kw && !qaHasKw(s, kw)) s = kw + ': ' + s;
  function cut(x) {
    if (x.length <= max) return x;
    var c = x.slice(0, max + 1);
    c = c.slice(0, c.lastIndexOf(' ') > 0 ? c.lastIndexOf(' ') : max);
    c = c.replace(/[\s,:;|&-]+$/, '');
    var w = c.split(' ');
    while (w.length > 3 && QA_STOP.indexOf(w[w.length - 1].toLowerCase()) !== -1) w.pop();
    return w.join(' ');
  }
  s = cut(s);
  // add ONE suffix that repeats no word of the title, only when the title is too short
  var pads = [" - Key Facts and Practical Tips", " - Complete Guide with Key Facts", " - Everything You Need to Know", " - Facts, Details and Guide", " - A Complete Guide", " Explained: Key Facts", " - Full Guide", " | Complete Guide", " for 2026", " and More"];
  function overlaps(a, b) {
    var wa = a.toLowerCase().match(/[a-z0-9]+/g) || [];
    return (b.toLowerCase().match(/[a-z0-9]+/g) || []).some(function (w) { return w.length > 3 && wa.indexOf(w) !== -1; });
  }
  if (s.length < min) {
    for (var i = 0; i < pads.length; i++) {
      var cand = s + pads[i];
      if (cand.length >= min && cand.length <= max && !overlaps(s, pads[i])) { s = cand; break; }
    }
  }
  if (s.length < min) {
    var best = s;
    for (var j = 0; j < pads.length; j++) { var c2 = s + pads[j]; if (c2.length <= max && c2.length > best.length) best = c2; }
    s = best;
  }
  s = qaEnsureNumberAndPower(s, kw, max);
  if (s.length < min) {
    var extras = [' Guide with Key Facts', ' Guide and Key Facts', ' Guide and Tips', ' Guide', ' Facts and Tips'];
    for (var x = 0; x < extras.length; x++) {
      var withExtra = s + extras[x];
      if (withExtra.length >= min && withExtra.length <= max) { s = withExtra; break; }
    }
    if (s.length < min) {
      for (var y = 0; y < extras.length; y++) { var w2 = s + extras[y]; if (w2.length <= max && w2.length > s.length) { s = w2; break; } }
    }
  }
  return s;
}

/* Rank Math "Title Readability": the SEO title needs a number and a power word (keyword stays first, length stays within max) */
var QA_POWER_WORDS = ['ultimate', 'complete', 'proven', 'essential', 'revealed', 'secret', 'secrets', 'amazing', 'powerful', 'easy', 'simple', 'surprising', 'incredible', 'effective', 'exclusive', 'guaranteed', 'official', 'best', 'free', 'shocking', 'remarkable', 'definitive', 'insider', 'unbelievable', 'stunning', 'fascinating', 'critical', 'important'];
var QA_POWER_RE = new RegExp('\\b(?:' + QA_POWER_WORDS.join('|') + ')\\b', 'i');
function qaEnsureNumberAndPower(s, kw, max) {
  var year = String(new Date().getFullYear());
  function trimTo(x, limit) {
    if (x.length <= limit) return x;
    // cut at a natural break (comma, colon or dash) when that keeps enough of the title
    var cutAt = Math.max(x.lastIndexOf(',', limit), x.lastIndexOf(':', limit), x.lastIndexOf(' - ', limit));
    if (cutAt >= 25) return x.slice(0, cutAt).replace(/[\s,:;|&-]+$/, '');
    var w = x.split(' ');
    while (w.length > 3 && w.join(' ').length > limit) w.pop();
    return w.join(' ').replace(/[\s,:;|&-]+$/, '');
  }
  if (!/\d/.test(s)) {
    var kwLow = (kw || '').toLowerCase(), at = kwLow ? s.toLowerCase().indexOf(kwLow) : -1;
    var withYear = at === 0 ? s.slice(0, kwLow.length) + ' ' + year + s.slice(kwLow.length) : year + ': ' + s;
    s = withYear.length <= max ? withYear : trimTo(withYear, max);
    if (!/\d/.test(s)) s = trimTo(s, max - year.length - 1) + ' ' + year;
  }
  if (!QA_POWER_RE.test(s)) {
    var adds = [' - Complete Guide', ' - Ultimate Guide', ' Revealed', ' Explained', ' - Proven Facts', ' - Essential Facts'];
    var done = false;
    for (var i = 0; i < adds.length && !done; i++) {
      if (/explained/i.test(adds[i]) && !QA_POWER_RE.test(adds[i])) continue;
      if ((s + adds[i]).length <= max) { s = s + adds[i]; done = true; }
    }
    if (!done) {
      var tail = ' - Complete';
      var tw = trimTo(s, max - tail.length).split(' ');
      while (tw.length > 3 && (QA_STOP.indexOf(tw[tw.length - 1].toLowerCase()) !== -1 || /[,:;]$/.test(tw[tw.length - 1]))) tw.pop();
      s = tw.join(' ').replace(/[s,:;|&-]+$/, '') + tail;
    }
  }
  return s;
}

function fixMetaDescription(desc, keyword, opts) {
  var max = (opts && opts.max) || QA_DEFAULTS.metaDescMax, min = (opts && opts.min) || QA_DEFAULTS.metaDescMin;
  var kw = qaStrip(keyword);
  var s = qaStrip(desc).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (kw && !qaHasKw(s, kw)) s = qaTitleCase(kw) + ': ' + s;
  if (s.length > max) {
    var c = s.slice(0, max);
    var dot = Math.max(c.lastIndexOf('. '), c.lastIndexOf('! '), c.lastIndexOf('? '));
    if (dot >= min) c = c.slice(0, dot + 1);
    else { c = c.slice(0, c.lastIndexOf(' ') > 0 ? c.lastIndexOf(' ') : max - 1).replace(/[\s,:;|&-]+$/, '') + '.'; }
    s = c;
  }
  var tail = ' Read the full guide for key facts and details.';
  if (s.length < min && s.length + tail.length <= max) s += tail;
  return s;
}

/* ---------- language heuristics (points 16, 17) ---------- */
var QA_IRREGULAR = 'known|made|done|built|seen|given|taken|held|written|shown|found|set|put|read|run|sold|paid|told|kept|left|brought|bought|taught|thought|caught|sent|spent|lost|won|led|met|chosen|drawn|driven|grown|hidden|ridden|risen|spoken|stolen|thrown|worn|broken|forgotten|begun|sung|torn|woken|beaten|bitten|eaten|fallen|flown|frozen|hung|shot|shut|split|spread|struck|swept|understood|withdrawn|overtaken|undertaken';
var QA_ED_NOT_PASSIVE = ['need', 'indeed', 'hundred', 'speed', 'seed', 'feed', 'weed', 'breed', 'proceed', 'succeed', 'exceed', 'embed', 'shed', 'sacred', 'naked', 'wicked', 'beloved', 'bed', 'red', 'fed', 'infrared', 'unsaid'];
var QA_PASSIVE_RE = new RegExp('\\b(?:am|is|are|was|were|be|been|being)\\s+(?:(?:\\w+ly|not|also|often|now|then|still|just|already|ever|never|always)\\s+)*((\\w{3,}ed)|(' + QA_IRREGULAR + '))\\b', 'gi');

function qaIsPassive(sentence) {
  QA_PASSIVE_RE.lastIndex = 0;
  var m;
  while ((m = QA_PASSIVE_RE.exec(sentence)) !== null) {
    var w = String(m[1]).toLowerCase();
    if (QA_ED_NOT_PASSIVE.indexOf(w) !== -1) continue;
    if (/\b(?:was|were|is|are)\s+born\b/i.test(m[0])) continue; // "was born" is a biography fact, not a style problem
    return true;
  }
  return false;
}

var QA_TRANSITIONS = [
  'accordingly', 'additionally', 'afterward', 'afterwards', 'also', 'although', 'alternatively', 'besides', 'but', 'consequently',
  'conversely', 'eventually', 'finally', 'first', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'further', 'furthermore',
  'hence', 'however', 'indeed', 'instead', 'lastly', 'later', 'likewise', 'meanwhile', 'moreover', 'namely', 'nevertheless', 'next',
  'nonetheless', 'now', 'otherwise', 'overall', 'rather', 'similarly', 'since', 'so', 'still', 'then', 'thereafter', 'therefore',
  'though', 'thus', 'ultimately', 'unlike', 'until', 'when', 'whenever', 'whereas', 'while', 'yet', 'because', 'after', 'before',
  'once', 'again', 'especially', 'specifically', 'particularly', 'notably', 'importantly', 'mainly', 'mostly', 'usually', 'typically',
  'generally', 'initially', 'recently', 'currently', 'today', 'soon', 'always', 'often', 'sometimes', 'for example', 'for instance',
  'in addition', 'in fact', 'in particular', 'in contrast', 'on the other hand', 'in other words', 'in short', 'in summary',
  'to begin with', 'at the same time', 'as well as', 'such as', 'in the meantime', 'after all', 'as soon as', 'even though',
  'for this reason', 'as a result', 'in the end', 'at first', 'in turn', 'on top of that', 'above all', 'that said', 'on the whole',
  'in general', 'by contrast', 'in comparison', 'as long as', 'so far', 'to sum up', 'for now', 'what is more', 'more importantly'
];
var QA_TRANS_RE = new RegExp('\\b(?:' + QA_TRANSITIONS.map(function (t) { return t.replace(/ /g, '\\s+'); }).join('|') + ')\\b', 'i');

/* The exact focus keyword must be in the FIRST sentence of the introduction. Models keep putting it in sentence 2 or 3,
   so code repairs it: move the first sentence that carries the keyword to the front, or add one short lead sentence. */
function qaFixIntroKeyword(html, keyword) {
  html = String(html || '');
  var kw = qaNorm(keyword || '');
  if (!kw) return html;
  var m = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if (!m) return html;
  var inner = m[1];
  var parts = inner.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
  if (qaNorm(qaStrip(parts[0])).indexOf(kw) !== -1) return html;
  var idx = -1;
  for (var i = 1; i < Math.min(parts.length, 4); i++) { if (qaNorm(qaStrip(parts[i])).indexOf(kw) !== -1) { idx = i; break; } }
  var newInner;
  if (idx > 0) { var moved = parts.splice(idx, 1)[0]; parts.unshift(moved); newInner = parts.join(' '); }
  else newInner = 'Here is a clear, fact-based look at ' + qaTitleCase(qaStrip(keyword)) + '. ' + inner;
  var start = m.index + m[0].indexOf('>') + 1;
  return html.slice(0, start) + newInner + html.slice(start + inner.length);
}

/* The H1 must carry the focus keyword. If the model drifted to another angle (biography instead of net worth), put the keyword in front. */
function qaFixH1Keyword(html, keyword) {
  html = String(html || '');
  var kwRaw = qaStrip(keyword || '');
  if (!kwRaw) return html;
  return html.replace(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/i, function (full, attrs, inner) {
    var text = qaStrip(inner);
    if (qaHasKw(text, kwRaw)) return full;
    var rest = text.split(':').length > 1 ? text.split(':').slice(1).join(':').trim() : text;
    return '<h1' + attrs + '>' + qaTitleCase(kwRaw) + ': ' + rest + '</h1>';
  });
}

/* ---------- main analysis ---------- */
function qaMetrics(html, o) {
  o = o || {};
  var C = {};
  var k;
  for (k in QA_DEFAULTS) C[k] = (o[k] != null ? o[k] : QA_DEFAULTS[k]);
  html = String(html || '');

  var kw = qaNorm(o.primaryKeyword || '');
  var faqBlocks = html.match(/<details\b[^>]*class="faq-item"[\s\S]*?<\/details>|<div\b[^>]*class="faq-item"[\s\S]*?<\/div>/gi) || [];
  var htmlNoFaq = faqBlocks.reduce(function (acc, b) { return acc.split(b).join(' '); }, html); // FAQ questions are H3 but not part of the content headings
  var h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  var h1Text = h1Match ? qaStrip(h1Match[1]) : qaStrip(o.title || '');
  var body = html.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i, ' ');
  var plain = qaStrip(body);
  var words = plain ? plain.split(' ').filter(Boolean).length : 0;

  var h2s = (html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi) || []).map(qaStrip);
  var h3s = (htmlNoFaq.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/gi) || []).map(qaStrip);
  var allHeadings = h2s.concat(h3s);

  // headings that start with the same word (point 11)
  var startGroups = {};
  allHeadings.forEach(function (h) {
    var first = (h.toLowerCase().match(/[a-z0-9]+/) || [''])[0];
    if (!first) return;
    (startGroups[first] = startGroups[first] || []).push(h);
  });
  var sameStart = Object.keys(startGroups).filter(function (w) { return startGroups[w].length >= 3; })
    .map(function (w) { return { word: w, count: startGroups[w].length, headings: startGroups[w] }; });

  // paragraphs (point 12)
  var paras = (body.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).map(qaWords);
  var maxPara = paras.length ? Math.max.apply(null, paras) : 0;
  var longParas = paras.filter(function (n) { return n > C.maxParagraphWords; }).length;

  // sentences for passive / transition (points 16, 17): paragraphs and list items only
  var blocks = (body.match(/<(?:p|li)\b[^>]*>[\s\S]*?<\/(?:p|li)>/gi) || []).map(qaStrip);
  var sentences = [];
  blocks.forEach(function (b) {
    b.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).forEach(function (s) {
      if (s.split(' ').filter(Boolean).length >= 3) sentences.push(s);
    });
  });
  var passive = sentences.filter(qaIsPassive);
  var withTransition = sentences.filter(function (s) { return QA_TRANS_RE.test(s); });
  var passivePct = sentences.length ? Math.round((passive.length / sentences.length) * 1000) / 10 : 0;
  var transitionPct = sentences.length ? Math.round((withTransition.length / sentences.length) * 1000) / 10 : 0;

  // tables, lists, bold (points 2, 3)
  var allTables = html.match(/<table\b[^>]*>/gi) || [];
  var quickInfoTables = html.match(/<table\b[^>]*quick-info/gi) || [];
  var tables = allTables.length - quickInfoTables.length;
  var lists = (html.match(/<(?:ul|ol)\b/gi) || []).length;
  var listItems = (html.match(/<li\b/gi) || []).length;
  var strong = (html.match(/<(?:strong|b)\b/gi) || []).length;
  var tablesExpected = Math.max(1, Math.min(3, Math.floor(words / 700)));

  // focus keyword (point 9)
  var nPlain = qaNorm(body);
  var kwCount = kw ? (nPlain.split(kw).length - 1) : 0;
  var kwLen = kw ? kw.split(' ').length : 0;
  // Rank Math style: exact keyword uses / total words (densityWordsAdd = words that are still going to be added, e.g. the FAQ)
  var densityWords = words + (Number(C.densityWordsAdd) || 0);
  var density = (kw && densityWords) ? Math.round((kwCount / densityWords) * 10000) / 100 : 0;
  var first100 = qaNorm(plain.split(' ').slice(0, 100).join(' '));
  var kwInH1 = !!kw && qaHasKw(h1Text, kw);
  var kwInFirst100 = !!kw && first100.indexOf(kw) !== -1;
  // introduction: the FIRST paragraph, and its first sentence, must carry the exact keyword (SEO plugins check this)
  var firstP = (body.match(/<p\b[^>]*>[\s\S]*?<\/p>/i) || [''])[0];
  var firstPText = qaStrip(firstP);
  var firstSentence = (firstPText.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)[0]) || '';
  var kwInIntro = !!kw && qaNorm(firstSentence).indexOf(kw) !== -1 && qaNorm(firstPText).indexOf(kw) !== -1;
  var kwInH2 = !!kw && h2s.some(function (h) { return qaHasKw(h, kw); });
  var concIdx = -1;
  h2s.forEach(function (h, i) { if (/^(conclusion|final thoughts)/i.test(h)) concIdx = i; });
  var concHtml = '';
  var concMatch = body.match(/<h2\b[^>]*>\s*(?:conclusion|final thoughts)[\s\S]*?(?=<h2\b|<details|$)/i);
  if (concMatch) concHtml = concMatch[0];
  var kwInConclusion = !!kw && qaHasKw(concHtml, kw);
  var concText = qaStrip(concHtml.replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/i, ' '));
  var concSentences = concText ? concText.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter(function (x) { return x.split(' ').length >= 3; }).length : 0;
  var firstFaqPos = html.search(/<details\b[^>]*class="faq-item"|<h2\b[^>]*>\s*(?:frequently asked|faq)/i);
  var concPos = html.search(/<h2\b[^>]*>\s*(?:conclusion|final thoughts)/i);
  var concBeforeFaq = concPos !== -1 && (firstFaqPos === -1 || concPos < firstFaqPos);
  var kwInMetaTitle = !!kw && qaHasKw(o.metaTitle || '', kw);
  var kwInMetaDesc = !!kw && qaHasKw(o.metaDescription || '', kw);
  var kwSlugWords = kw ? kw.split(' ').filter(function (w) { return QA_STOP.indexOf(w) === -1; }) : [];
  var slugParts = String(o.slug || '').toLowerCase().split('-');
  var kwInSlug = !!kw && kwSlugWords.length > 0 && kwSlugWords.every(function (w) {
    return slugParts.indexOf(w) !== -1 || slugParts.indexOf(w + 's') !== -1;
  });

  // links (points 10, 13) and images (point 14)
  var host = qaHost(o.siteUrl);
  var hrefs = [];
  (html.match(/<a\b[^>]*href="([^"]+)"/gi) || []).forEach(function (a) {
    var m = a.match(/href="([^"]+)"/i);
    if (m && /^https?:\/\//i.test(m[1]) && hrefs.indexOf(m[1]) === -1) hrefs.push(m[1]);
  });
  var internalLinks = hrefs.filter(function (u) { return !!host && qaHost(u) === host; });
  var externalLinks = hrefs.filter(function (u) { return internalLinks.indexOf(u) === -1; });
  var images = (html.match(/<img\b/gi) || []).length;

  // FAQ quality (point 15)
  var faq = faqBlocks.map(function (b) {
    var q = qaStrip((b.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i) || b.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || '');
    var a = qaStrip(b.replace(/<summary\b[\s\S]*?<\/summary>/i, '').replace(/<h3\b[\s\S]*?<\/h3>/i, ''));
    return { question: q, answer: a, answerWords: a ? a.split(' ').length : 0 };
  });
  var faqStarts = {};
  faq.forEach(function (f) { var w = (f.question.toLowerCase().match(/[a-z]+/) || [''])[0]; faqStarts[w] = (faqStarts[w] || 0) + 1; });
  var faqRepeatStart = Object.keys(faqStarts).filter(function (w) { return faqStarts[w] > 2; });
  var faqBadLength = faq.filter(function (f) { return f.answerWords < C.faqAnswerMin || f.answerWords > C.faqAnswerMax; }).length;
  var faqFiller = faq.filter(function (f) { return /common question about|see the related discussion|as an ai|i cannot|it is important to note/i.test(f.answer); }).length;
  var faqNoQuestionMark = faq.filter(function (f) { return !/\?\s*$/.test(f.question); }).length;
  var faqDup = faq.length - (new Set(faq.map(function (f) { return qaNorm(f.question); }))).size;

  // slug (point 1)
  var slug = String(o.slug || '');
  var slugOk = slug === '' ? null : (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= C.maxSlugChars && slug.split('-').length <= C.maxSlugWords);

  var metaTitleLen = (o.metaTitle != null) ? String(o.metaTitle).length : null;
  var metaDescLen = (o.metaDescription != null) ? String(o.metaDescription).length : null;

  var internalAvail = (o.internalAvailable != null) ? o.internalAvailable : C.internalLinksMin;
  var externalAvail = (o.externalAvailable != null) ? o.externalAvailable : C.externalLinksMin;
  var needInternal = Math.min(C.internalLinksMin, internalAvail);
  var needExternal = Math.min(C.externalLinksMin, externalAvail);

  var checks = [];
  function add(point, id, pass, detail, hard, fix) { checks.push({ point: point, id: id, pass: pass, detail: detail, hard: !!hard, fix: fix || '' }); }

  add(1, 'slug', slugOk === null ? null : (slugOk && kwInSlug), slug === '' ? 'no slug given' : ('"' + slug + '" (' + slug.length + ' chars, keyword in slug: ' + kwInSlug + ')'), false, 'Use a short lowercase hyphenated slug that contains the focus keyword.');
  add(2, 'h2-max', h2s.length <= C.maxH2, h2s.length + ' H2 (max ' + C.maxH2 + ')', true, 'Use at most ' + C.maxH2 + ' H2 headings in total (the FAQ heading counts). Merge sections; you currently have ' + h2s.length + '.');
  add(2, 'h3-present', h3s.length >= C.minH3, h3s.length + ' H3 (min ' + C.minH3 + ')', false, 'Add H3 sub-headings (at least ' + C.minH3 + ') inside the longer H2 sections.');
  add(2, 'tables', tables >= tablesExpected, tables + ' table(s), expected ' + tablesExpected + ' for ' + words + ' words', false, 'Add ' + Math.max(1, tablesExpected - tables) + ' more HTML table(s) (with <thead> and <tbody>) for comparisons, key numbers or timelines.');
  add(3, 'lists', lists >= 3 && listItems >= 8, lists + ' list(s), ' + listItems + ' bullet/numbered items', false, 'Use more bullet or numbered lists (at least 3 lists, 8 items) for facts, steps and key points.');
  add(3, 'bold', strong >= 5, strong + ' bold terms (min 5)', false, 'Put <strong> around at least 5 important terms or numbers.');
  add(4, 'words-max', words <= C.maxWords, words + ' words (max ' + C.maxWords + ')', true, 'The article has ' + words + ' words; it MUST NOT exceed ' + C.maxWords + '. Shorten the weakest sections.');
  add(4, 'words-min', words >= C.minWords, words + ' words (min ' + C.minWords + ')', true, 'The article has only ' + words + ' words; add real substance until it reaches at least ' + C.minWords + ' (never above ' + C.maxWords + ').');
  add(5, 'meta-desc', metaDescLen === null ? null : (metaDescLen <= C.metaDescMax && metaDescLen >= C.metaDescMin), metaDescLen === null ? 'no meta description' : (metaDescLen + ' chars (' + C.metaDescMin + '-' + C.metaDescMax + ')'), false, 'Meta description must be ' + C.metaDescMin + '-' + C.metaDescMax + ' characters and include the focus keyword.');
  var mtText = String(o.metaTitle || '');
  add(6, 'title-power-number', metaTitleLen === null ? null : (/\d/.test(mtText) && QA_POWER_RE.test(mtText)), 'number: ' + /\d/.test(mtText) + ', power word: ' + QA_POWER_RE.test(mtText), false, 'The SEO title needs a number (for example the year) and a power word (Complete, Ultimate, Proven, Essential).');
  add(6, 'meta-title', metaTitleLen === null ? null : (metaTitleLen >= C.metaTitleMin && metaTitleLen <= C.metaTitleMax), metaTitleLen === null ? 'no meta title' : (metaTitleLen + ' chars (' + C.metaTitleMin + '-' + C.metaTitleMax + ')'), false, 'Meta title must be ' + C.metaTitleMin + '-' + C.metaTitleMax + ' characters with the focus keyword near the start.');
  add(9, 'kw-h1', kwInH1, 'keyword in title/H1: ' + kwInH1, true, 'The H1 must contain the focus keyword "' + (o.primaryKeyword || '') + '" (or at least all of its words, for example "Hurricane Isaias" for "isaias hurricane").');
  add(9, 'kw-first100', kwInFirst100, 'keyword in first 100 words: ' + kwInFirst100, true, 'Use the exact focus keyword "' + (o.primaryKeyword || '') + '" inside the first 100 words of the introduction.');
  add(9, 'kw-intro', kwInIntro, 'exact keyword in the first sentence of the introduction: ' + kwInIntro, true, 'The FIRST sentence of the first paragraph must contain the exact focus keyword "' + (o.primaryKeyword || '') + '" (word for word), for example by opening with a sentence about it.');
  add(9, 'kw-h2', kwInH2, 'keyword in an H2: ' + kwInH2, true, 'At least one H2 heading must contain the focus keyword "' + (o.primaryKeyword || '') + '" (or all of its words).');
  add(9, 'kw-conclusion', concIdx === -1 ? null : kwInConclusion, concIdx === -1 ? 'no conclusion section found' : ('keyword in conclusion: ' + kwInConclusion), false, 'Mention the focus keyword (or all of its words) once in the Conclusion.');
  add(9, 'kw-density', density >= C.densityMin && density <= C.densityMax, kwCount + ' uses, density ' + density + '% (' + C.densityMin + '-' + C.densityMax + ')', false, 'Keyword density is ' + density + '%, the target is ' + C.densityMin + '-' + C.densityMax + '%. Use the exact focus keyword ' + Math.ceil(densityWords * C.densityMin / 100) + '-' + Math.floor(densityWords * C.densityMax / 100) + ' times in the whole text (spread over intro, headings, body and conclusion), never forced.');
  add(9, 'conclusion-lines', (concPos === -1) ? false : (concSentences >= C.conclusionMinSentences && concBeforeFaq), concPos === -1 ? 'no H2 called Conclusion' : ('conclusion has ' + concSentences + ' sentences (min ' + C.conclusionMinSentences + '), before FAQ: ' + concBeforeFaq), false, 'End the article with an H2 that starts with the word "Conclusion" and write at least ' + C.conclusionMinSentences + ' full sentences (about 100-130 words, one or two paragraphs) in it; it comes before the FAQ.');
  add(9, 'kw-meta', (o.metaTitle == null && o.metaDescription == null) ? null : (kwInMetaTitle && kwInMetaDesc), 'keyword in meta title: ' + kwInMetaTitle + ', in meta description: ' + kwInMetaDesc, false, 'Put the focus keyword in the meta title and meta description.');
  add(10, 'internal-links', o.checkLinks ? internalLinks.length >= needInternal : null, o.checkLinks ? (internalLinks.length + ' internal link(s), need ' + needInternal + ' (available ' + internalAvail + ')') : 'checked after link injection', false, '');
  add(11, 'heading-starts', sameStart.length === 0, sameStart.length ? sameStart.map(function (g) { return g.count + ' headings start with "' + g.word + '": ' + g.headings.join(' | '); }).join(' ; ') : 'no 3 headings share the same first word', true, sameStart.map(function (g) { return 'Rewrite the headings starting with "' + g.word + '" (' + g.headings.join(' | ') + ') so no three headings share the same first word.'; }).join(' '));
  add(12, 'paragraph-max', longParas === 0, 'longest paragraph ' + maxPara + ' words (max ' + C.maxParagraphWords + ')', true, 'Split every paragraph longer than ' + C.maxParagraphWords + ' words; keep paragraphs at 2-4 sentences.');
  add(13, 'external-links', o.checkLinks ? externalLinks.length >= needExternal : null, o.checkLinks ? (externalLinks.length + ' external link(s), need ' + needExternal + ' (available ' + externalAvail + ')') : 'checked after link injection', false, '');
  add(14, 'images-max', images <= C.maxImages, images + ' image(s) (max ' + C.maxImages + ')', false, '');
  var faqPass = faq.length === 0 ? null : (faq.length >= C.faqMin && faq.length <= C.faqMax && faqBadLength === 0 && faqFiller === 0 && faqNoQuestionMark === 0 && faqDup === 0 && faqRepeatStart.length === 0);
  add(15, 'faq-quality', o.checkFaq ? faqPass : null, o.checkFaq ? (faq.length + ' FAQs, ' + faqBadLength + ' with answer length outside ' + C.faqAnswerMin + '-' + C.faqAnswerMax + ' words, ' + faqFiller + ' filler, ' + faqDup + ' duplicate, repeated starts: ' + (faqRepeatStart.join(',') || 'none')) : 'checked after FAQ injection', false, '');
  add(16, 'passive', passivePct <= C.maxPassivePct, passivePct + '% passive (' + passive.length + '/' + sentences.length + ' sentences, max ' + C.maxPassivePct + '%)', false, 'Too much passive voice (' + passivePct + '%). Rewrite these sentences in active voice: ' + passive.slice(0, 5).map(function (s) { return '"' + s.slice(0, 90) + '"'; }).join(' ; '));
  add(17, 'transitions', transitionPct >= C.minTransitionPct, transitionPct + '% of sentences have a transition word (' + withTransition.length + '/' + sentences.length + ', min ' + C.minTransitionPct + '%)', false, 'Only ' + transitionPct + '% of sentences use transition words; at least ' + C.minTransitionPct + '% must (however, for example, because, also, so, then, in addition, as a result, meanwhile, finally).');

  var hardFails = checks.filter(function (c) { return c.pass === false && c.hard; });
  var softFails = checks.filter(function (c) { return c.pass === false && !c.hard; });
  var byPoint = {};
  checks.forEach(function (c) {
    var p = byPoint[c.point] = byPoint[c.point] || { pass: true, checked: 0 };
    if (c.pass === false) p.pass = false;
    if (c.pass !== null) p.checked++;
  });

  return {
    words: words, h1: h1Text, h2: h2s.length, h3: h3s.length, headings: { h2: h2s, h3: h3s },
    tables: tables, tablesExpected: tablesExpected, lists: lists, listItems: listItems, strong: strong,
    paragraphs: paras.length, maxParagraphWords: maxPara,
    sentences: sentences.length, passivePct: passivePct, transitionPct: transitionPct,
    passiveExamples: passive.slice(0, 5), sameStart: sameStart,
    keyword: { count: kwCount, density: density, inH1: kwInH1, inFirst100: kwInFirst100, inH2: kwInH2, inConclusion: kwInConclusion, inMetaTitle: kwInMetaTitle, inMetaDescription: kwInMetaDesc, inSlug: kwInSlug },
    links: { internal: internalLinks, external: externalLinks }, images: images,
    faq: { count: faq.length, items: faq, badLength: faqBadLength, filler: faqFiller },
    metaTitleLength: metaTitleLen, metaDescriptionLength: metaDescLen, slug: slug,
    checks: checks, hardFails: hardFails, softFails: softFails, byPoint: byPoint,
    pass: hardFails.length === 0
  };
}

//__EXPORTS__
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { qaMetrics: qaMetrics, makeSlug: makeSlug, fixMetaTitle: fixMetaTitle, fixMetaDescription: fixMetaDescription, fixIntroKeyword: qaFixIntroKeyword, fixH1Keyword: qaFixH1Keyword, QA_DEFAULTS: QA_DEFAULTS };
}
