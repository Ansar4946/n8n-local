if (!faqs.length && Array.isArray(redditFaqs) && redditFaqs.length > 0) {
  faqs = redditFaqs.map(r => ({ question: String(r.question || r.title || '').trim(), answer: String(r.answer || r.snippet || r.description || '').trim() }));
}
// Point 15: only real, answered questions. No placeholder answers, no duplicates, no one-word answers.
const cfgF = (() => { try { return $('⚙️ Config').first().json; } catch (e) { return {}; } })();
const faqMax = Number(cfgF.faq_count || 6);
const fillerRe = /common question about|see the related discussion|as an ai|i cannot|it is important to note/i;
const seenQ = new Set();
faqs = faqs
  .map(f => ({ question: String(f.question || '').replace(/\s+/g, ' ').trim().replace(/[?？]*$/, '?'), answer: String(f.answer || '').replace(/\s+/g, ' ').trim() }))
  .filter(f => f.question.length > 8 && f.answer.split(" ").length >= 25 && !fillerRe.test(f.answer))
  .filter(f => { const k = f.question.toLowerCase().replace(/[^a-z0-9 ]/g, ''); if (seenQ.has(k)) return false; seenQ.add(k); return true; })
  .slice(0, faqMax);
