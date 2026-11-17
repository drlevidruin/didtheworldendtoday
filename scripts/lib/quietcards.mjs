// Quiet cards: stories about things that could have casualties get no joke.
// They stay in the data, keep counting toward the score and the grid, and
// carry quiet: true plus the reason so the page can show the plain facts and
// a Red Cross link instead of a caption.
//
// Applied to every category, not only earth and weather: a blackout caused by
// a wildfire is still a wildfire.

const KEYWORDS = new RegExp(
  '(?<![\\p{L}\\p{N}_])(' +
    [
      'floods?',
      'flooding',
      'flooded',
      'flash floods?',
      'wildfires?',
      'fires?',
      'hurricanes?',
      'typhoons?',
      'cyclones?',
      'tornado(?:es|s)?',
      'landslides?',
      'tsunamis?',
      'evacuat(?:e|es|ed|ing|ion|ions)',
    ].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'iu',
);

// Phrases where "fire" is not a disaster at all.
const FALSE_FIRE = /\b(?:fire sale|fire tv|fire stick|fire hd|fire tablet|fire phone|fires? back|friendly fire|cease-?fire|gunfire|crossfire|backfire|fire drill|hold fire|open(?:s|ed)? fire)\b/gi;

const QUAKE_WORD = /\b(?:earthquakes?|quakes?|temblors?)\b/i;

// The biggest magnitude a headline states ("6.6 magnitude", "magnitude 7", "M6.8"), or 0.
export function headlineMagnitude(title) {
  const t = String(title || '');
  if (!QUAKE_WORD.test(t)) return 0;
  let best = 0;
  const patterns = [
    /\bmagnitude(?: of)?\s?(\d(?:\.\d)?)\b/gi,
    /\bmag\.?\s?(\d(?:\.\d)?)\b/gi,
    /\bM\s?(\d(?:\.\d)?)\b/g,
    /\b(\d(?:\.\d)?)[- ]magnitude\b/gi,
    /\b(\d\.\d)\s?(?:earthquake|quake|temblor)\b/gi,
    /\b(?:earthquake|quake|temblor)\b[^.]{0,30}?\b(\d\.\d)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) best = Math.max(best, Number(m[1]));
  }
  return best;
}

export function quietReason(story) {
  const sig = story.signal;
  if (sig && sig.type === 'quake') {
    if (Number(sig.mag) >= 6.5) return 'quake M6.5 or more';
    if (['yellow', 'orange', 'red'].includes(String(sig.pager || '').toLowerCase())) return `USGS PAGER ${String(sig.pager).toLowerCase()}`;
    if (sig.tsunami) return 'tsunami flag';
  }
  if (headlineMagnitude(story.title) >= 6.5) return 'quake M6.5 or more';
  const text = String(story.title || '').replace(FALSE_FIRE, ' ');
  const m = KEYWORDS.exec(text);
  if (m) return `headline mentions ${m[1].toLowerCase()}`;
  return null;
}
