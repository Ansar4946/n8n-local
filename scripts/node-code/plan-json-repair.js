// Gemini sometimes breaks one key, e.g.  -keywords: [  or  keywords: [  or  'h3': [  : repair it, then parse again
if (!plan || !plan.sections) {
  const repairPlan = (s) => {
    s = s.replace(/^([ \t]*)[-*'‘’“”`]*\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*:/gm, '$1"$2":'); // key at the start of a line
    s = s.replace(/([{,]\s*)[-*'‘’“”`]*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*:/g, '$1"$2":');      // key right after { or ,
    s = s.replace(/,(\s*[}\]])/g, '$1');                                                      // trailing commas
    return s;
  };
  for (const cand of [text, text.slice(Math.max(0, text.indexOf('{')), text.lastIndexOf('}') + 1)]) {
    try { plan = JSON.parse(repairPlan(cand)); if (plan && plan.sections) break; } catch (e6) {}
  }
}
