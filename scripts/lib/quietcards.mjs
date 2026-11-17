// Quiet cards: stories about things that could have casualties get no joke.
// They stay in the data, keep counting toward the score and the grid, and
// carry quiet: true plus the reason so the page can show the plain facts
// instead of a caption. Whether the card also links to a charity is worked
// out from the story when the page is built (quietCard below).
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

// ---- where a quiet card points -----------------------------------------------
// A quake that trips only on its size (M6.5 or more, PAGER green or missing, no
// tsunami flag) is a quiet card with no link: nothing says anyone was hurt.
// The link shows when PAGER says yellow, orange or red, when there is a tsunami
// flag, or when the headline carries a disaster word (flood, wildfire,
// hurricane, evacuation and the rest). It goes to the international Red Cross
// and Red Crescent for a USGS quake outside the US, and to the US Red Cross for
// everything else, a quake in a US state or territory included.

const US_ABBREVIATIONS = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP'.split(' '),
);
// USGS names a US place by state abbreviation (", CA") or by name ("Alaska", "Hawaii",
// "Puerto Rico region", "Southern California"). "Georgia" is left out on purpose: USGS
// means the country, and the state comes as ", GA".
const US_NAME_END =
  /\b(?:Alaska|Hawaii|Puerto Rico|Guam|American Samoa|U\.?S\.? Virgin Islands|Virgin Islands|Northern Mariana Islands|Mariana Islands|Aleutian Islands|California|Nevada|Oregon|Washington|Idaho|Montana|Wyoming|Utah|Colorado|Arizona|New Mexico|Texas|Oklahoma|Kansas|Nebraska|North Dakota|South Dakota|Missouri|Arkansas|Louisiana|Tennessee|Kentucky|Mississippi|Alabama|Florida|North Carolina|South Carolina|Virginia|Maryland|Delaware|Pennsylvania|New York|New Jersey|Connecticut|Rhode Island|Massachusetts|Vermont|New Hampshire|Maine|Ohio|Michigan|Indiana|Illinois|Wisconsin|Minnesota|Iowa|United States)(?: region)?$/i;
const US_NAME_START = /^(?:Alaska|Hawaii|Aleutian|Puerto Rico|Guam|Mariana|American Samoa|Virgin Islands)\b/i;
const NOT_US_CALIFORNIA = /\b(?:Baja California|Gulf of California)\b/i;

export function isUsPlace(place) {
  const text = String(place || '').trim();
  if (!text) return false;
  const last = text.split(',').pop().trim();
  if (/^[A-Z]{2}$/.test(last)) return US_ABBREVIATIONS.has(last);
  if (NOT_US_CALIFORNIA.test(text)) return false;
  return US_NAME_END.test(last) || US_NAME_START.test(text);
}

function hasDisasterWord(title) {
  return KEYWORDS.test(String(title || '').replace(FALSE_FIRE, ' '));
}

// null for a story that is not a quiet card, else { reason, link } where link is
// 'redcross', 'ifrc' or null (no link).
export function quietCard(story) {
  const reason = quietReason(story);
  if (!reason) return null;
  const sig = story.signal && story.signal.type === 'quake' ? story.signal : null;
  if (sig) {
    // Our own quake headline is built from USGS fields, so only the instrument counts.
    const pager = String(sig.pager || '').toLowerCase();
    const hurt = ['yellow', 'orange', 'red'].includes(pager) || Boolean(sig.tsunami);
    return { reason, link: hurt ? (isUsPlace(sig.place) ? 'redcross' : 'ifrc') : null };
  }
  return { reason, link: hasDisasterWord(story.title) ? 'redcross' : null };
}
