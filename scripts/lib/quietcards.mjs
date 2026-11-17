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
// A quiet card links to a charity only when something says people were hurt.
//
// Our own quake headline is built from USGS fields, so only the instrument counts: PAGER
// yellow, orange or red, or a tsunami flag. A quake that trips only on its size (M6.5 or
// more, PAGER green or missing, no tsunami flag) is a quiet card with no link. The link
// goes to the international Red Cross and Red Crescent for a quake outside the US, and to
// the US Red Cross for a quake in a US state or territory.
//
// A story from a news site is read from its headline. It links only when the headline
// reports harm to people or homes (damaged, destroyed, homes, evacuated, displaced and the
// rest), and then by where it happened: the US Red Cross for a US place, the international
// Red Cross and Red Crescent for a place abroad, and no link when no place is named. A
// storm warning, a big quake that hurt no one and a forecast get the caption alone.

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
const NOT_US_CALIFORNIA_ALL = new RegExp(NOT_US_CALIFORNIA.source, 'gi');

export function isUsPlace(place) {
  const text = String(place || '').trim();
  if (!text) return false;
  const last = text.split(',').pop().trim();
  if (/^[A-Z]{2}$/.test(last)) return US_ABBREVIATIONS.has(last);
  if (NOT_US_CALIFORNIA.test(text)) return false;
  return US_NAME_END.test(last) || US_NAME_START.test(text);
}

// Harm to people or homes, as a headline says it. "Damaging winds" is a forecast, not harm, so it is not here.
const HARM = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:' +
    [
      'damage[sd]?',
      'destroy(?:s|ed)?',
      'homes',
      'evacuat(?:e[sd]?|ing|ions?)',
      'displac(?:ed|es|ing)',
      'injured',
      'injuries',
      'dead',
      'deaths?',
      'died',
      'dies(?! down)', // "dies down" is a storm easing, not a death
      'kills?',
      'killed',
      'fatalities',
      'casualties',
      'trapped',
      'missing',
    ].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'iu',
);

// Words that say the harm is over or never came. They are taken out of a headline before it is
// read for harm: "evacuation order lifted", "lifts evacuation orders", "no damage reported",
// "no one hurt". Harm that is named next to them still counts: "no injuries, but homes destroyed".
const EVACUATION = 'evacuat(?:e[sd]?|ing|ions?)';
const EVACUATION_NOTICE = '(?:\\s+(?:orders?|warnings?|notices?))?';
const ENDS = '(?:lift(?:s|ed)?|end(?:s|ed)?|cancel(?:s|l?ed)|rescind(?:s|ed)?|eas(?:es|ed))';
const NO_HARM = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:' +
    [
      `${EVACUATION}${EVACUATION_NOTICE}\\s+${ENDS}`,
      `${ENDS}\\s+(?:(?:the|all|remaining)\\s+)*${EVACUATION}${EVACUATION_NOTICE}`,
      "(?:no|zero|without)\\s+(?:[\\p{L}'’-]+\\s+){0,2}(?:damage|injur(?:y|ies|ed)|deaths?|dead|fatalit(?:y|ies)|casualt(?:y|ies)|killed|hurt)",
      "(?:nobody|no one)\\s+(?:[\\p{L}'’-]+\\s+){0,2}(?:injured|hurt|killed|dead|died)",
    ].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'giu',
);

// A US place in a headline: a state, a territory, or a big city or region. A word that names part
// of the US and also part of some other country ("northeast India", the east coast of Australia, the
// Gulf Coast of Mexico) is left out, so a headline that has only that gets no link. A state
// abbreviation counts only after a comma ("Moore, OK"), because "OK", "IN" and "OR" are words.
const US_PLACES = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:' +
    [
      'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana',
      'Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York',
      'North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia',
      'Washington State|Washington, D\\.?C\\.?|West Virginia|Wisconsin|Wyoming|Puerto Rico|Guam',
      'Los Angeles|San Francisco|Bay Area|San Diego|San Jose|Seattle|Portland|Las Vegas|Phoenix|Denver|Dallas|Houston|Austin|San Antonio|New Orleans',
      'Chicago|Detroit|Atlanta|Miami|Tampa|Orlando|Charlotte|Nashville|Memphis|St\\. Louis|Kansas City|Minneapolis|Cleveland|Pittsburgh|Philadelphia',
      'Baltimore|Boston|NYC|New England|Great Plains|Pacific Northwest|Tornado Alley|Appalachia',
    ].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'iu',
);
const US_ABBREVIATION_AFTER_COMMA = new RegExp(`,\\s*(?:${[...US_ABBREVIATIONS].join('|')})\\b`);
// "U.S." and "US" on their own. A weak sign: a headline about aid or politics says "US" for a place abroad.
const US_BARE = new RegExp('(?<![\\p{L}\\p{N}_])(?:U\\.S\\.|United States|USA)(?![\\p{L}\\p{N}_])', 'iu');
const US_BARE_CAPITALS = /\b(?:US|USA)\b/; // capitals only: "us" is a word

// A place outside the US, from a short list of where disasters turn up in the news.
const ABROAD_PLACES = new RegExp(
  '(?<![\\p{L}\\p{N}_])(?:' +
    [
      'Australia|NSW|New South Wales|Queensland|Tasmania|New Zealand|Indonesia|Japan|Philippines|India|Pakistan|Bangladesh|Nepal|Sri Lanka|China|Taiwan',
      'Thailand|Vietnam|Malaysia|Papua New Guinea|Fiji|Vanuatu|Tonga|Mexico|Baja California|Gulf of California|Canada|Ontario|Quebec|British Columbia|Alberta|Brazil|Chile|Peru|Colombia',
      'Ecuador|Haiti|Cuba|Jamaica|Honduras|Guatemala|UK|U\\.K\\.|Britain|England|Scotland|Wales|Ireland|France|Germany|Italy|Spain|Portugal|Greece|Turkey',
      'Europe|Africa|Kenya|Nigeria|Ethiopia|Mozambique|Madagascar|South Africa',
    ].join('|') +
    ')(?![\\p{L}\\p{N}_])',
  'u',
);

// Where a headline's card points: 'redcross', 'ifrc' or null. No harm in the headline, no link.
// A place is read in this order: a named US place, then a named place abroad, then a bare "US" or
// "U.S.". So a US place wins when a headline names both a US place and one abroad, and a named
// place abroad wins over a bare "US" ("Storm destroys homes in Jamaica, US aid on the way").
// Baja California and the Gulf of California are Mexico, not California.
export function headlineLink(title) {
  const t = String(title || '');
  if (!HARM.test(t.replace(NO_HARM, ' '))) return null;
  const us = t.replace(NOT_US_CALIFORNIA_ALL, ' ');
  if (US_PLACES.test(us) || US_ABBREVIATION_AFTER_COMMA.test(us)) return 'redcross';
  if (ABROAD_PLACES.test(t)) return 'ifrc';
  if (US_BARE.test(us) || US_BARE_CAPITALS.test(us)) return 'redcross';
  return null;
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
  return { reason, link: headlineLink(story.title) };
}
