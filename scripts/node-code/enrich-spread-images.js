if (contextFigs.length > 0) {
  // Spread the extra pictures through the article: after the first paragraph of the 2nd, 4th and 5th content section.
  // Never inside the intro, the Conclusion or the FAQ.
  const cand = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)].filter(m => !/frequently\s+asked|conclusion|final\s+thoughts/i.test(m[0].replace(/<[^>]+>/g, ' ')));
  const used = new Set();
  const inserts = [];
  contextFigs.forEach((fig, k) => {
    let ix = Math.min(Math.max(cand.length - 1, 0), 1 + 2 * k);
    while (used.has(ix) && ix > 0) ix--;
    used.add(ix);
    const m = cand[ix];
    if (!m) return;
    const from = m.index + m[0].length;
    const pEnd = html.indexOf('</p>', from);
    inserts.push({ at: pEnd >= 0 ? pEnd + 4 : from, fig });
  });
  if (!inserts.length) { html += '\n' + contextFigs.join('\n'); }
  else { inserts.sort((a, b) => b.at - a.at).forEach(x => { html = html.slice(0, x.at) + '\n' + x.fig + '\n' + html.slice(x.at); }); }
}
