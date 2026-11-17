// The order stories are listed in, so one big event cannot fill the first
// screen. Rank still decides who comes first; this only holds back a story
// when its category already has its share of the top of the list.
//
// Rule (config VARIETY): no category takes more than 3 of the first 12
// receipts or more than 6 of the first 30. A held-back story is not thrown
// away: it keeps its rank order and lands as soon as its category has room,
// or at the end of the list ("show more"). The category chips are built from
// the full list, so they still show every story of their category.
//
// When the list has too few categories to meet the rule (every story left
// belongs to a full category), the story whose category has the fewest places
// so far goes next, so the top of the page stays as mixed as it can be.
//
// The lead story (the closest call) sits ahead of the receipts, so the
// windows here count it too: positions 0 to 12 hold at most 3 of a category,
// which means receipts 1 to 12 do as well, however the page counts them.
import { VARIETY } from '../config.mjs';

export function receiptsOrder(stories, variety = VARIETY) {
  const rest = Array.isArray(stories) ? [...stories] : [];
  const windows = [
    { end: variety.first + 1, max: variety.firstMax },
    { end: variety.second + 1, max: variety.secondMax },
  ];
  const placed = new Map();
  const out = [];
  const allowed = (cat, position) => windows.every((w) => position >= w.end || (placed.get(cat) || 0) < w.max);
  while (rest.length) {
    const position = out.length;
    let at = rest.findIndex((s) => allowed(s.cat, position));
    if (at < 0) {
      // Every category left is full. Take the emptiest one, best rank first.
      at = 0;
      for (let i = 1; i < rest.length; i += 1) {
        if ((placed.get(rest[i].cat) || 0) < (placed.get(rest[at].cat) || 0)) at = i;
      }
    }
    const [story] = rest.splice(at, 1);
    placed.set(story.cat, (placed.get(story.cat) || 0) + 1);
    out.push(story);
  }
  return out;
}
