// A joke is for a near miss. A story gets its category's caption only when its
// headline holds one of the words in that category's nearMiss list (config.mjs),
// such as an outage, a glitch, a delay, a hack or a rock that missed. Any other
// story that passes the filters is shown with no caption at all.
//
// This is the second safety net, behind the exclusion filter: if a headline
// about something that hurt people ever slips through the first, it still gets
// no joke unless it also reads like a near miss. Quiet cards are a separate
// thing and are not decided here.

export function hasNearMiss(category, title) {
  const list = category && Array.isArray(category.nearMiss) ? category.nearMiss : [];
  const text = String(title ?? '');
  return list.some((re) => re instanceof RegExp && re.test(text));
}
