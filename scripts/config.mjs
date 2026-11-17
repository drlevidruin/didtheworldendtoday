// Everything tunable lives here: queries, keyword gates, exclusion lists,
// the Doom Score rule, the daily edition rules and per-source settings. Nothing in this file
// is clever on purpose. Change a word, run `npm run update`, look at the
// kept and dropped lists it prints with --verbose.

export const USER_AGENT = 'didtheworldendtoday.com (news aggregator)';

export const WINDOW = {
  maxAgeHours: 36, // ignore news published longer ago than this
  rollingHours: 24, // the homepage window
  lookbackDays: 3, // ET days (today plus two) re-read and merged on every run
};

export const LIMITS = {
  perCategoryFloor: 4, // best few of each category survive the cut
  rollingStories: 100, // stories in latest.json and in today's day file
  fallbackStories: 10, // shown (and never scored) when the last 24 hours are empty
};

// The first edition of the Almanac. No day before this date is ever written
// or kept, so launch day has no "yesterday" and no fake change arrow.
export const FIRST_EDITION = '2026-11-16';

// Variety in the listing: no category takes more than `firstMax` of the first
// `first` stories, or more than `secondMax` of the first `second`. The overflow
// keeps its rank order after them, at the end of the list.
export const VARIETY = { first: 12, firstMax: 3, second: 30, secondMax: 6 };

// Publishers whose headlines are mostly stock-chatter, shopping or machine
// translations. Matched on the publisher name, ignoring case and punctuation.
export const BLOCKED_PUBLISHERS = ['note', 'BigGo Finance', 'Moomoo', 'Pluang', 'Traders Union', 'TradingKey', 'Fakti.bg', 'Chiang Rai Times'];

// ---------------------------------------------------------------------------
// Doom Score: a plain rule, published on /about. No tuning constant.
// ---------------------------------------------------------------------------
export const DOOM = {
  perCategory: 6, // points per fired category (12 x 6 = 72 at most)
  publishersToFire: 3, // distinct publishers with kept headlines
  floor: 11, // "there's always something"
  cap: 99, // never 100
  kp: { at: 5, points: 5, bigAt: 7, bigPoints: 12 },
  quake: { at: 6, points: 5, bigAt: 7, bigPoints: 12 },
  asteroid: { withinLd: 1, points: 8, closeLd: 0.5, closePoints: 15 },
  faa: { hubPoints: 6, nationwidePoints: 20 },
  status: { points: 8 },
};

// ---------------------------------------------------------------------------
// Categories, in the exact order of the 4x3 share grid (row by row).
// queries: run on Google News and Bing News (one request each, per run).
// gdelt: one bounded query for the bonus source.
// keywords: a headline must match one entry (an array entry needs all of its
//           regexes). Only headlines count, never descriptions.
// reject: regexes that veto the category even when a keyword matched.
// emoji: what a row shows when a day has no written edition and the site lists
//        plain headlines instead.
// ---------------------------------------------------------------------------
const OUTAGE = 'outages?|glitch(?:es)?|failures?|meltdown|malfunctions?|shut ?down|disruptions?';
// Words that say "it broke": used next to a service or a bank.
const BROKE =
  'outages?|down|offline|glitch(?:es)?|disruptions?|failures?|meltdown|not working|crippled|' +
  'technical (?:issues?|problems?|difficulties|glitch(?:es)?)|tech (?:issues?|problems?)|' +
  '(?:software|computer|system|IT) (?:bugs?|issues?|problems?|failures?|glitch(?:es)?)|bugs?|' +
  'halts?|slows?|delays?';
// "Can't get in" wording for a bank or payment app.
const NO_ACCESS =
  "(?:trouble|difficult(?:y|ies)|problems?|issues?)\\s+(?:accessing|logging|signing|with (?:online|mobile|the app))|" +
  "(?:can(?:['\\u2019]?t)|cannot|unable to|couldn['\\u2019]?t)\\s+(?:access|log ?in|get to|reach|use)";
// Services people notice when they stop working. SERVICES_STRICT leaves out
// the names that are also ordinary words or stock tickers.
const SERVICES_STRICT =
  'AWS|Amazon Web Services|Azure|Google Cloud|Cloudflare|Microsoft|Office 365|Microsoft 365|Outlook|Teams|Gmail|' +
  'YouTube|Facebook|Instagram|WhatsApp|Slack|Zoom|Discord|Reddit|GitHub|Netflix|Spotify|Verizon|AT&T|T-Mobile|' +
  'Comcast|Xfinity|Starlink|PlayStation|Xbox|Steam|Roblox|Fortnite|Snapchat|TikTok|iCloud|' +
  'App Store|Apple Music|Apple Pay|Apple TV|iMessage|FaceTime|Apple Accounts?|Apple services|ChatGPT';
// The big names that are also ordinary words or stock tickers: they count only where an outage word is close.
const SERVICES_LOOSE = `${SERVICES_STRICT}|Apple|Google|Amazon|X|Twitter`;
// "Thousands report problems": people saying it broke.
const PEOPLE_REPORT = '(?:users|customers|people|thousands|millions) (?:report|reports|reporting|reported) (?:issues|problems|outages?)';
// What a service does, or what is said of it, when it breaks.
const SERVICE_BROKE =
  'outages?|is down|are down|went down|goes down|down for|not working|disruptions?|glitch(?:es)?|offline|' +
  `experiencing (?:issues|problems|an outage|outages|disruptions)|(?:having|reporting) (?:issues|problems)|${PEOPLE_REPORT}`;
// "Apple down 3%", "Microsoft down by 2%": a share price, not an outage.
const NOT_A_PRICE = '(?!\\s+(?:\\d|by\\b|from\\b|to\\b|about\\b|nearly\\b|over\\b|more\\b|less\\b|\\$))';
const BANKS =
  'banks?|banking|JPMorgan|Chase|Wells Fargo|Bank of America|BofA|Citi(?:bank|group)?|Capital One|PayPal|' +
  'Venmo|Zelle|Cash App|Visa|Mastercard|Coinbase|Binance|Robinhood|Fidelity|Schwab|Vanguard|payments?|ATMs?|' +
  'credit cards?|debit cards?';
const ANIMALS =
  'goats?|sheep|horses?|cattle|cows?|bulls?|pigs?|ostrich(?:es)?|emus?|llamas?|alpacas?|monkeys?|snakes?|' +
  'bears?|lions?|tigers?|zebras?|camels?|kangaroos?|wolf|wolves|coyotes?|deer|moose|elk|alligators?|' +
  'crocodiles?|pythons?|penguins?|elephants?|giraffes?|bison|buffalo|seals?|sea lions?|sharks?|whales?|' +
  'cougars?|bobcats?|lynx|raccoons?|foxes|fox|otters?|beavers?|pelicans?|turkeys|geese|swans?';

// "derecho" is the storm, and also the Spanish word for a right or a law ("Por el derecho de
// la niñez a crecer en familia"). It counts as weather only when no Spanish article, preposition
// or legal word sits next to it.
const DERECHO_STORM =
  /(?<![\p{L}\p{N}_])(?<!\b(?:el|del|al|un|su|mi|tu|por|con|sin|ese|este|y|o|en|de|la|los|las)\s)derechos?(?![\p{L}\p{N}_])(?!\s+(?:de|del|a|al|humanos?|civil|civiles|penal|laboral|internacional|internacionales|fundamentales?|constitucional)\b)/iu;

export const CATEGORIES = [
  {
    id: 'flights',
    emoji: '✈️',
    label: 'Grounded',
    queries: [
      '"ground stop" OR "flights grounded" OR "grounded flights" OR "grounds flights"',
      '"air traffic control" OR FAA OR NOTAM outage OR glitch OR failure',
      'airline "system outage" OR "IT outage" OR "airspace closed" OR "GPS jamming"',
    ],
    gdelt: '("ground stop" OR "flights grounded" OR "air traffic control outage")',
    keywords: [
      /\bground stops?\b/i,
      /\bground delay programs?\b/i,
      /\bflights?\b[^.]{0,30}\b(?:grounded|halted|suspended)\b/i,
      /\bgrounded flights?\b/i,
      /\bgrounds?\b[^.]{0,20}\b(?:flights?|planes|fleet|departures|aircraft)\b/i,
      /\b(?:planes|aircraft|fleet|departures)\b[^.]{0,20}\b(?:grounded|halted)\b/i,
      /\bnationwide grounding\b|\bgrounding of (?:all )?(?:flights|planes|aircraft)\b/i,
      new RegExp(`\\bair traffic control(?:lers?)?\\b[^.]{0,60}\\b(?:${OUTAGE}|radar|equipment|system)\\b`, 'i'),
      new RegExp(`\\b(?:${OUTAGE})\\b[^.]{0,60}\\bair traffic control\\b`, 'i'),
      /\bair traffic\b[^.]{0,40}\b(?:glitch(?:es)?|outages?|failures?|meltdowns?|breakdowns?)\b/i,
      /\bno-?takeoff\b|\btakeoff (?:order|ban)\b/i,
      new RegExp(`\\b(?:FAA|NOTAMs?)\\b[^.]{0,60}\\b(?:${OUTAGE}|computer|ground stop)\\b`, 'i'),
      /\bairspace\b[^.]{0,30}\b(?:closed|closure|shut)\b|\b(?:closes?|closed|shuts?) (?:its |the )?airspace\b/i,
      /\b(?:airlines?|airports?|flights?)\b[^.]{0,50}\b(?:system|IT|computer|technical|tech)\b[^.]{0,20}\b(?:outages?|glitch(?:es)?|failures?|meltdown|problems?|issues?)\b/i,
      /\b(?:airlines?|United|Delta|American Airlines|Southwest|JetBlue|Alaska Airlines|Spirit|Frontier|Ryanair|easyJet|Lufthansa|British Airways|Qantas|Air Canada)\b[^.]{0,60}\b(?:outages?|technical (?:issues?|problems?)|tech issues?|technology issues?|computer (?:issues?|problems?|glitch(?:es)?)|delay(?:s|ed)? (?:departing |all |hundreds of )?(?:flights|departures))\b/i,
      /\boutages?\b[^.]{0,40}\b(?:airlines?|airports?|flights?)\b/i,
      /\b(?:hundreds|thousands) of flights\b[^.]{0,40}\b(?:cancel(?:l)?ed|delayed|grounded)\b/i,
      /\bGPS\b[^.]{0,30}\b(?:jamming|spoofing|interference|outage)\b/i,
    ],
    claim: [
      /\bground stops?\b/i,
      /\b(?:FAA|air traffic control)\b[^.]{0,40}\b(?:outage|glitch|failure|computer|system|radar)\b/i,
      /\b(?:United|Delta|American Airlines|Southwest|JetBlue|Alaska Airlines|Spirit|Frontier|Ryanair|easyJet|Lufthansa|British Airways|Qantas|Air Canada|airlines?)\b[^.]{0,60}\b(?:outages?|technical (?:issues?|problems?)|tech issues?|technology issues?|computer (?:issues?|problems?)|delay(?:s|ed)? (?:departing )?flights)\b/i,
    ],
    reject: [],
  },
  {
    id: 'hacks',
    emoji: '🏦',
    label: 'Hacked',
    queries: [
      '"data breach" OR ransomware OR cyberattack',
      'hackers OR "zero-day" OR "bank hacked" OR "exchange hacked" OR "crypto hack"',
      '"bank outage" OR "banking outage" OR "payments outage" OR "ATM outage" OR "card outage" OR "Visa outage" OR "Mastercard outage"',
    ],
    gdelt: '("data breach" OR ransomware OR cyberattack OR "bank outage")',
    keywords: [
      /\b(?:data|security|customer data|personal data|cyber) breach(?:es)?\b/i,
      /\bbreached\b/i,
      /\bransomware\b/i,
      /\bcyber ?attacks?\b/i,
      /\b(?:security|cyber|cybersecurity) incidents?\b/i,
      /\bDDoS\b|\bmalware\b|\binfostealer\b|\bbotnet\b/i,
      /\bhack(?:ed|ers?|ing|s)?\b/i,
      /\bzero-?days?\b/i,
      /\b(?:data|records|passwords|credentials|information)\b[^.]{0,30}\b(?:leaked|leaks?|exposed|stolen|compromised)\b/i,
      /\bmillions of (?:records|users|customers|accounts|people)\b/i,
      new RegExp(`\\b(?:${BANKS})\\b[^.]{0,80}\\b(?:${BROKE})\\b`, 'i'),
      new RegExp(`\\b(?:${BROKE})\\b[^.]{0,60}\\b(?:${BANKS})\\b`, 'i'),
      /\bbanking (?:delays|services|app|apps|problems?|issues?|trouble)\b/i,
      new RegExp(`\\b(?:${BANKS})\\b[^.]{0,80}\\b(?:${NO_ACCESS})\\b`, 'i'),
    ],
    claim: [
      // bank and payment trouble belongs here, whichever query found it
      new RegExp(`\\b(?:banks?|banking|JPMorgan|Chase|Wells Fargo|Bank of America|BofA|Citi(?:bank|group)?|Capital One|PayPal|Venmo|Zelle|Cash App|ATMs?)\\b[^.]{0,80}\\b(?:${BROKE})\\b`, 'i'),
      new RegExp(`\\b(?:${BROKE})\\b[^.]{0,60}\\b(?:banks?|banking|JPMorgan|Chase|Wells Fargo|Bank of America|BofA|Capital One|PayPal|Zelle|ATMs?)\\b`, 'i'),
      new RegExp(`\\b(?:banks?|banking|JPMorgan|Chase|Wells Fargo|Bank of America|BofA|Citi(?:bank|group)?|Capital One|PayPal|Venmo|Zelle|Cash App)\\b[^.]{0,80}\\b(?:${NO_ACCESS})\\b`, 'i'),
    ],
    reject: [
      /\b(?:life|growth|money|travel|kitchen|cleaning|beauty|home|organi[sz]ing|diy|budget|cooking|laundry|storage|holiday|christmas|thanksgiving) hacks?\b/i,
      /\b(?:bank|banking|payments?|cards?|Visa|Mastercard)\b[^.]{0,40}\b(?:holiday|rates?|fees?|accounts? (?:review|offer)|bonus|promo|deal)\b/i,
      // Trouble getting a loan or credit is not an outage.
      /\b(?:loans?|mortgages?|credit (?:markets?|lines?)|funding|liquidity|capital)\b/i,
      // A price going down is not an outage ("Why is crypto down?").
      /\b(?:crypto|bitcoin|BTC|ether|ethereum|stocks?|shares|prices?|markets?)\s+(?:is\s+|are\s+|falls?\s+)?down\b/i,
      // Threat reports and policy warnings are not incidents.
      /\bQ[1-4]\s+20\d\d\b|\b(?:underprepared|unprepared)\b/i,
    ],
  },
  {
    id: 'internet',
    emoji: '🌐',
    label: 'Internet down',
    queries: [
      '"global outage" OR "worldwide outage" OR "widespread outage" OR "major outage"',
      'AWS OR Azure OR Cloudflare OR "Google Cloud" OR Microsoft OR Outlook outage down',
      '"is down" OR "went down" OR Downdetector OR "not working" outage',
      '"undersea cable" OR "DNS outage" OR "911 outage" OR "false emergency alert" OR "emergency alert error"',
    ],
    gdelt: '("global outage" OR "widespread outage" OR "Cloudflare outage" OR "AWS outage")',
    keywords: [
      /\b(?:global|worldwide|widespread|massive|major|nationwide|big|huge)\b[^.]{0,40}\b(?:outages?|disruptions?|failures?)\b/i,
      new RegExp(`\\b(?:${SERVICES_LOOSE})\\b[^.]{0,60}\\b(?:${SERVICE_BROKE})\\b`, 'i'),
      /\b(?:is|are|was|were|went|goes|going) down (?:for|again|across|worldwide|globally|nationwide)\b/i,
      // "AWS down in US-EAST-1", "Outlook Down Again?" (but not "Apple down 3%")
      new RegExp(`\\b(?:${SERVICES_STRICT})\\s+(?:(?:is|are|was|went|goes|now|again|still)\\s+)*down\\b${NOT_A_PRICE}`, 'i'),
      // "Is Apple down? Thousands report problems accessing services" (but not "Is Apple down 3%")
      new RegExp(`\\bis\\s+(?:${SERVICES_LOOSE})\\s+down\\b${NOT_A_PRICE}`, 'i'),
      // "Users report problems with several Apple services": the people come first, the service after
      new RegExp(`\\b${PEOPLE_REPORT}\\b[^.]{0,60}\\b(?:${SERVICES_STRICT})\\b`, 'i'),
      // "took down Microsoft 365", "knocked out Outlook"
      new RegExp(`\\b(?:took|take|taken|taking|brought|brings?|knock(?:ed|s)?)\\s+(?:down|out)\\s+(?:the\\s+)?(?:${SERVICES_STRICT})\\b`, 'i'),
      /\bdown(?: ?detector)\b|\bdown for (?:thousands|millions|many|users|customers)\b/i,
      // Downdetector's own posts: "User reports indicate problems at Apple since 12:20 PM EST."
      /\buser reports indicate\b/i,
      /\binternet (?:outages?|blackouts?|shutdowns?|disruptions?|down)\b/i,
      /\b(?:undersea|subsea|submarine) cables?\b/i,
      /\bDNS (?:outage|failure|issues?|problems?)\b/i,
      /\b911\b[^.]{0,40}\b(?:outages?|down|failure|disrupt\w*|not working)\b/i,
      /\b(?:outages?|failure)\b[^.]{0,40}\b911\b/i,
      /\bfalse (?:emergency |missile |tsunami |nuclear |amber )?alerts?\b/i,
      /\b(?:emergency alert|wireless emergency alert|alert system)\b[^.]{0,40}\b(?:error|mistake|glitch|in error|accidental(?:ly)?|false)\b/i,
    ],
    claim: [],
    reject: [/\bpower outages?\b/i, /\belectricity\b/i, /\bblackouts?\b/i],
  },
  {
    id: 'space',
    emoji: '☄️',
    label: 'Space rocks',
    queries: ['asteroid "close approach" OR "near-Earth" OR "passes Earth" OR flyby OR "near miss"'],
    gdelt: '(asteroid OR "near-Earth object") ("close approach" OR flyby OR "passes Earth")',
    keywords: [
      /\basteroids?\b[^.]{0,80}\b(?:Earth|moon|lunar|close|closer|passes|pass|passing|flyby|fly-by|approach\w*|near|miss(?:es)?|impact\w*|collid\w*|hazard\w*|threat\w*|hurtl\w*|zips?|whizz\w*|swings?|buzz\w*|narrow\w*)\b/i,
      /\b(?:close approach|flyby|fly-by|passes Earth|lunar distances?)\b[^.]{0,80}\basteroids?\b/i,
      /\bnear[- ]Earth (?:objects?|asteroids?)\b/i,
      /\bpotentially hazardous\b/i,
      /\bmini-?moons?\b/i,
      /\b(?:fireball|bolide|meteorite)s?\b/i,
      /\bspace rocks?\b/i,
      /\bplanetary defen[cs]e\b/i,
    ],
    claim: [],
    reject: [/\bmeteor showers?\b/i, /\bbuy\b/i],
  },
  {
    id: 'sun',
    emoji: '🌞',
    label: 'Angry sun',
    queries: ['"solar flare" OR "geomagnetic storm" OR "coronal mass ejection" OR "solar storm"'],
    gdelt: '("solar flare" OR "geomagnetic storm" OR "coronal mass ejection")',
    keywords: [
      /\bsolar (?:flares?|storms?|eruptions?|outbursts?)\b/i,
      /\b(?:geomagnetic|magnetic) (?:storms?|activity)\b/i,
      /\bcoronal mass ejections?\b|\bCMEs?\b/i,
      /\bX-?class\b/i,
      /\b(?:northern lights|auroras?|borealis)\b[^.]{0,60}\b(?:alert|warning|watch|storm|geomagnetic|solar|CME|flare|G[1-5]|Kp)\b/i,
      /\b(?:alert|warning|watch|storm|geomagnetic|solar|CME|flare|G[1-5]|Kp)\b[^.]{0,60}\b(?:northern lights|auroras?|borealis)\b/i,
      /\bspace weather\b|\bradio blackouts?\b/i,
    ],
    claim: [],
    reject: [],
  },
  {
    id: 'earth',
    emoji: '🌋',
    label: 'Restless planet',
    queries: [
      'earthquake magnitude OR "strong earthquake" OR "powerful earthquake" OR "volcano erupts" OR "tsunami warning"',
      '"volcanic eruption" OR "volcano" erupts OR "magnitude 6" OR "magnitude 7"',
    ],
    gdelt: '(earthquake OR "volcano erupts" OR "tsunami warning") (magnitude OR strong OR powerful)',
    keywords: [
      // an earthquake with a magnitude of 6 or more, said any of the usual ways
      [/\b(?:earthquakes?|quakes?|temblors?|tremors?)\b/i, /(?:\b(?:magnitude|mag\.?)\s?(?:of\s)?[6-9](?:\.\d)?\b|\bM\s?[6-9](?:\.\d)?\b|\b[6-9](?:\.\d)?[- ]magnitude\b|\b[6-9]\.\d\b)/i],
      [/\b(?:strong|powerful|major|massive|large|big|violent|huge)\b[^.]{0,20}\b(?:earthquake|quake|temblor)\b/i],
      [
        /\b(?:volcano|volcanic|lava|ash (?:cloud|plume)|Etna|Kilauea|Stromboli|Fuego|Merapi|Sakurajima|Semeru|Mauna Loa|Popocatepetl|Taal|Krakatoa|Vesuvius|Fagradalsfjall|Ruapehu|Kanlaon)\b/i,
        /\berupt(?:s|ed|ing|ion)\b/i,
      ],
      /\btsunami (?:warnings?|alerts?|watch|advisor(?:y|ies)|threat|waves?)\b|\bno tsunami\b/i,
    ],
    claim: [],
    reject: [/\bstock|\bmarkets?\b/i],
  },
  {
    id: 'markets',
    emoji: '📉',
    label: 'Markets',
    queries: [
      '"flash crash" OR "circuit breaker" OR "trading halted" OR "market plunge"',
      '"crypto crash" OR "bitcoin plunges" OR "stocks plunge" OR "Dow plunges" OR "market selloff"',
    ],
    gdelt: '("flash crash" OR "circuit breaker" OR "trading halted" OR "market plunge")',
    keywords: [
      /\bflash crash\b/i,
      /\bcircuit breakers?\b/i,
      /\b(?:trading (?:halt(?:ed|s)?|suspended|paused)|halts? trading)\b/i,
      /\b(?:stocks|stock markets?|markets?|Dow|Nasdaq|S&P(?: 500)?|Wall Street|crypto|bitcoin|ether|ethereum)\b[^.]{0,60}\b(?:plunge[sd]?|plummet(?:s|ed)?|tank(?:s|ed)?|tumble[sd]?|crash(?:es)?|sell-?off|rout|meltdown|free ?fall|nosedive)\b/i,
      /\b(?:plunge[sd]?|plummet(?:s|ed)?|tumble[sd]?|nosedive)\b[^.]{0,40}\b(?:stocks|stock markets?|markets?|Dow|Nasdaq|S&P|Wall Street|bitcoin|crypto)\b/i,
      /\b(?:tech|stock|market|crypto|bond|global|equity) sell-?offs?\b/i,
      /\b(?:loses|lose|wipes? out|erases?|evaporates?)\b[^.]{0,30}\$\s?\d[\d.,]*\s?(?:billion|trillion)\b/i,
    ],
    claim: [],
    reject: [
      /\b(?:to buy|I'd buy|should you buy|buy (?:now|the dip)|stocks? to (?:buy|watch)|best stocks|top stocks|price prediction|forecast|analysts?|earnings|portfolio)\b/i,
      /\b(?:brac(?:ed|es|ing) for|could (?:crash|plunge|tank)|may (?:crash|plunge)|set to (?:crash|plunge)|warns? of|risk of|poised to)\b/i,
      // One company's news is not the market: earnings releases, drug trials,
      // and market-research reports ("Circuit Breaker Test Sets Market To 2035").
      /\breports?\s+(?:(?:first|second|third|fourth|1st|2nd|3rd|4th)[- ]quarter|full[- ]year|fiscal|nine[- ]month|six[- ]month|quarterly|annual)\b/i,
      /\b(?:drug|clinical|trial|phase [123]|FDA|biotech|therapeutics|pharma\w*)\b/i,
      /\bmarket (?:size|share|research|report|outlook|analysis|trends?|to \d{4})\b|\b(?:to|by) 20[3-9]\d\b|\bCAGR\b/i,
    ],
  },
  {
    id: 'ai',
    emoji: '🤖',
    label: 'Robots',
    queries: [
      '"AI outage" OR chatbot glitch OR "ChatGPT down" OR "robot malfunction" OR "AI gone wrong"',
      'deepfake chaos OR "AI chatbot" meltdown OR "self-driving" glitch OR robotaxi stuck',
    ],
    gdelt: '("AI outage" OR "chatbot glitch" OR "ChatGPT down" OR "robot malfunction")',
    keywords: [
      /\bAI\b[^.]{0,60}\b(?:outages?|glitch(?:es)?|meltdown|malfunctions?|goes? (?:rogue|wrong|haywire)|gone wrong|hallucinat\w*|chaos|fiasco|blunder|bug)\b/i,
      /\b(?:ChatGPT|Claude|Gemini|Copilot|Grok|OpenAI|Anthropic|chatbots?|Alexa|Siri)\b[^.]{0,60}\b(?:down|outages?|glitch(?:es)?|disruptions?|failures?|meltdown|malfunctions?|crash(?:es|ed)?|goes? (?:rogue|wrong|haywire)|bug|not working|offline)\b/i,
      /\brogue (?:AI|chatbot|robot|agent)\b|\bAI (?:agents?|assistants?|bots?)\b[^.]{0,40}\b(?:delet(?:es?|ed|ing)|wipes?|wiped|erases?|erased|ran amok|went rogue|goes rogue)\b/i,
      /\brobots?\b[^.]{0,40}\b(?:malfunction(?:s|ed)?|goes? (?:rogue|haywire|wrong)|glitch(?:es)?|runs? amok)\b/i,
      /\bdeepfakes?\b[^.]{0,60}\b(?:chaos|panic|fooled|viral)\b/i,
      /\b(?:self-driving|robotaxis?|Waymo|autonomous vehicles?)\b[^.]{0,50}\b(?:glitch(?:es)?|stuck|stalls?|stalled|malfunction(?:s|ed)?|outage|blocks?|gridlock)\b/i,
    ],
    claim: [
      /\b(?:ChatGPT|Claude|Gemini|Copilot|Grok|OpenAI|Anthropic)\b[^.]{0,60}\b(?:down|outages?|glitch(?:es)?|disruptions?|failures?|crash(?:es|ed)?|not working|offline)\b/i,
    ],
    reject: [],
  },
  {
    id: 'grid',
    emoji: '⚡',
    label: 'Lights out',
    queries: [
      '"power outage" OR blackout OR "grid failure" OR "rolling blackouts"',
      '"without power" OR "lost power" OR "power cut" thousands OR millions OR customers outage',
    ],
    gdelt: '("power outage" OR blackout OR "grid failure" OR "rolling blackouts")',
    keywords: [
      /\bpower outages?\b/i,
      /\b(?:grid|power|electric(?:al|ity)?|city|nationwide|rolling|widespread|massive|citywide|statewide|regional)\b[^.]{0,30}\bblackouts?\b/i,
      /\bblackouts?\b[^.]{0,30}\b(?:hits?|strikes?|plunges?|leaves?|across|affects?|grid|power)\b/i,
      /\bgrid (?:failure|collapse|emergency|alert|strain)\b/i,
      /\brolling blackouts?\b/i,
      /\b(?:thousands|millions|hundreds of thousands|customers|homes|households|residents)\b[^.]{0,40}\b(?:without (?:power|electricity)|lose power|lost power|in the dark)\b/i,
      /\bwithout (?:power|electricity)\b/i,
      /\bpower (?:cuts?|failures?)\b/i,
    ],
    claim: [],
    reject: [/\b(?:media|TV|news|internet|social media|sports?) blackout\b/i, /\b90-day blackout\b/i],
  },
  {
    id: 'germs',
    emoji: '🦠',
    label: 'Germs',
    queries: [
      'outbreak OR "bird flu" OR "new variant" OR "new virus" OR H5N1',
      'recall contamination OR listeria OR salmonella OR "E. coli"',
    ],
    gdelt: '(outbreak OR "bird flu" OR "new variant" OR "contamination recall")',
    keywords: [
      /\boutbreaks?\b/i,
      /\bbird flu\b|\bH5N1\b|\bavian (?:flu|influenza)\b/i,
      /\bnew (?:virus|variant|strain|pathogen)\b/i,
      /\bnew (?:[\w-]+ ){1,2}(?:virus(?:es)?|variants?|pathogens?)\b/i,
      /\b(?:measles|mpox|cholera|dengue|norovirus|whooping cough|pertussis|polio|legionnaires|legionella|marburg|ebola|nipah|chikungunya|zika|swine flu|superbugs?)\b/i,
      /\brecall(?:s|ed)?\b[^.]{0,80}\b(?:contaminat\w*|listeria|salmonella|E\.? ?coli|botulism|metal|glass|plastic)\b/i,
      /\b(?:listeria|salmonella|E\.? ?coli|botulism)\b[^.]{0,60}\b(?:outbreak|recall(?:s|ed)?|contamination|case|cases|found|linked)\b/i,
      /\bcontaminat\w+\b[^.]{0,40}\brecall/i,
    ],
    claim: [],
    reject: [/\bhospitali[sz]\w*\b/i, /\bmistakes?\b|\btips\b|\bprotect\b/i],
  },
  {
    id: 'weather',
    emoji: '🌀',
    label: 'Weather',
    queries: [
      '"record heat" OR "record cold" OR "record high" OR "record low" OR "freak snow" OR hail',
      '"freak storm" OR derecho OR "ice storm" OR "heat dome" OR "dust storm" OR "freak snow"',
    ],
    gdelt: '("record heat" OR "record cold" OR "freak snow" OR hailstorm OR derecho)',
    keywords: [
      /\brecord[- ](?:breaking |setting )?(?:heat|cold|warmth|temperatures?|snow(?:fall)?|rain(?:fall)?|wind|winds)\b/i,
      /\brecord[- ](?:highs?|lows?)\b[^.]{0,40}\b(?:temperatures?|degrees|heat|cold|weather)\b|\b(?:temperatures?|degrees)\b[^.]{0,40}\brecord[- ](?:highs?|lows?)\b/i,
      /\b(?:freak|unseasonabl[ey]|unprecedented|historic|rare|extreme)\b[^.]{0,30}\b(?:heat|cold|snow|snowstorm|hail|storms?|winds?|temperatures?|warm|frost|freeze|blizzard|downpour)\b/i,
      /\bhail(?:storms?|stones?)\b/i,
      /\b(?:giant|large|huge|big|massive|destructive|damaging|severe|golf[- ]?ball|baseball|softball|tennis[- ]?ball|marble|pea|egg|grapefruit|quarter|lemon|orange|apple|ping[- ]?pong)(?:[- ]sized?)?[ -]hail\b/i,
      /\b\d+(?:\.\d+)?[- ]?(?:cm|mm|in|inch|inches|centimet(?:er|re)s?)[- ]?(?:wide |across )?hail\b/i,
      /\bhail\b[^.]{0,20}\b(?:damage[sd]?|storms?|warnings?|threat|risk)\b/i,
      DERECHO_STORM,
      /\b(?:waterspout|dust storm|haboob|ice storm|thundersnow|heat dome|heat ?wave|polar vortex|atmospheric river|cold snap|blizzard|hurricane|typhoon|cyclone|tornado(?:es)?)\b/i,
    ],
    claim: [],
    reject: [/\bawareness week\b/i, /\bwhat (?:watches|advisories|warnings)\b/i, /\bunderstanding\b/i, /\bstocks?\b|\bshares\b|\bsales\b/i],
  },
  {
    id: 'animals',
    emoji: '🐝',
    label: 'Animal uprising',
    queries: [
      'orcas OR swarm OR "escaped" zoo OR "wildlife" invading OR "bear" "broke into"',
      '"swarm of" OR "escaped from" OR "loose in" OR "wandered into" animals OR bees OR locusts OR jellyfish OR bear',
    ],
    gdelt: '(swarm OR "escaped zoo" OR orcas OR "bear" "broke into")',
    keywords: [
      /\borcas?\b[^.]{0,40}\b(?:ram(?:s|med|ming)?|sink|sank|boats?|yachts?|sailboats?)\b/i,
      /\b(?:swarm|swarms|swarming|infestation)\b[^.]{0,40}\b(?:bees|locusts|jellyfish|ants|flies|mosquitoes|crickets|cicadas|rats|spiders|crabs|frogs|snakes|birds|wasps|grasshoppers|caterpillars)\b/i,
      /\b(?:bees|locusts|jellyfish|ants|flies|mosquitoes|crickets|cicadas|rats|spiders|crabs|frogs|snakes|birds|wasps|grasshoppers|caterpillars)\b[^.]{0,20}\bswarm/i,
      new RegExp(`\\b(?:escaped|escapes|loose|on the loose|runs? loose|broke loose|got loose)\\b[^.]{0,40}\\b(?:zoo|animals?|${ANIMALS})\\b`, 'i'),
      new RegExp(`\\b(?:${ANIMALS})\\b[^.]{0,30}\\b(?:escaped|escapes|on the loose|runs? loose|broke loose|got loose)\\b`, 'i'),
      // A bear going into a place people live (not the Chicago Bears going into a bye week).
      /\bbears?\b[^.]{0,40}\b(?:break(?:s|ing)?|broke|walk(?:s|ed|ing)?|stroll(?:s|ed|ing)?|sneak(?:s|ed|ing)?|wander(?:s|ed|ing)?|enter(?:s|ed|ing)?|barges?|barged|climb(?:s|ed|ing)?)\s+into\s+(?:[\w'\u2019-]+\s+){0,3}(?:house|home|kitchen|garage|pool|school|classroom|grocery|store|shop|restaurant|yard|car|cabin|bakery|church|hotel|campsite|tent|building|backyard|porch)s?\b/i,
      /\bbears?\b[^.]{0,40}\b(?:in (?:a |the )?(?:house|kitchen|garage|pool|school|grocery|store|home|car)|raid(?:s|ed))\b/i,
      /\bwildlife\b[^.]{0,40}\b(?:invad\w*|overrun\w*|takes? over|taking over|spill\w* into|wander\w*)\b/i,
    ],
    claim: [],
    reject: [
      /\b(?:mauled|bitten|bites?|attacks?|attacked|attacking|stung|hospitali[sz]ed)\b/i,
      // Team nicknames (Bears, Lions, Tigers, Sharks, Bulls) in a game report.
      /\b(?:NFL|NBA|NHL|MLB|NCAA|MLS|playoffs?|quarterback|touchdowns?|overtime|vs\.?|defeats?|beats?|wins?|loses?|scores?|rookie|coach)\b/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// The hard exclusion filter. Applies to every source, including X.
// The first terms in each family are the spec list; "extended" terms are ours
// ("too strict beats ghoulish"). skipForSignals: our own generated signal
// headlines may carry place names from USGS (a quake near a country is not
// politics), so place and politics families are skipped for signals only.
// ---------------------------------------------------------------------------
// A crash with people in it is excluded; a market, crypto, app, site or server
// crash is the kind of thing this site is about. The words touching the crash
// word say which kind it is: "computer system crashes", "ChatGPT crashes" and
// "flash crash" are digital, "plane crash" and "bus crash" are not. The nearer
// word wins, even when the rest of the headline names an airline ("Delta
// flights grounded after computer system crashes"). With no such word beside it,
// a headline that names a vehicle or an airline is dropped, and so is one that
// names no market or computer word at all ("after Air India crash"), because an
// unknown crash is far more likely to be a human one than a software one.
const CRASH_WORDS = /\b(?:crash(?:es|ed|ing)?|wreck(?:age)?|derail(?:s|ed|ment|ments)?)\b/gi;
const VEHICLE =
  'planes?|airplanes?|aircraft|airliners?|jets?|flights?|helicopters?|choppers?|copters?|trains?|rail|railway|trams?|subway|buses|bus|cars?|trucks?|vans?|vehicles?|motorcycles?|motorbikes?|cyclists?|boats?|ferry|ships?|vessels?|yachts?|pilots?|passengers?|drivers?|runway|highway|freeway|interstate|cockpit|airlines?|airways|aviation|Boeing|Airbus|Cessna|Embraer';
const DIGITAL =
  'markets?|stocks?|shares|equities|bitcoin|btc|ethereum|crypto\\w*|coins?|tokens?|dow|nasdaq|s&p|selloff|sell-off|prices?|index|bonds?|yields?|trading|traders?|exchange|apps?|sites?|websites?|servers?|software|browser|systems?|network|computers?|pcs?|phones?|iphones?|android|ios|windows|games?|gaming|platforms?|cloud|login|database|ai|chatbot|bots?|algorithm|code|' +
  'chatgpt|openai|claude|gemini|copilot|grok|anthropic|alexa|siri|youtube|facebook|instagram|whatsapp|tiktok|snapchat|netflix|spotify|xbox|playstation|outlook|gmail|zoom|slack|discord|reddit|github|aws|azure|cloudflare|icloud';
const VEHICLE_WORD = new RegExp(`\\b(?:${VEHICLE})\\b`, 'i');
const DIGITAL_WORD = new RegExp(`\\b(?:${DIGITAL})\\b`, 'i');
// "flash" only counts beside the crash word: "flash crash" is a market, "flash flood" is not.
const DIGITAL_BESIDE = new RegExp(`\\b(?:${DIGITAL}|flash)\\b`, 'i');
const WORD_RUNS = /[\p{L}\p{N}&]+/gu;

// 'vehicle', 'digital' or null: what the words touching one crash word say it is,
// nearest first (the word before it, the word after it, then the one before that).
function crashKind(title, match) {
  const before = title.slice(0, match.index).match(WORD_RUNS) || [];
  const after = title.slice(match.index + match[0].length).match(WORD_RUNS) || [];
  for (const word of [before[before.length - 1], after[0], before[before.length - 2]]) {
    if (!word) continue;
    if (VEHICLE_WORD.test(word)) return 'vehicle';
    if (DIGITAL_BESIDE.test(word)) return 'digital';
  }
  return null;
}

export function crashWithPeople(title) {
  const t = String(title ?? '');
  const kinds = [...t.matchAll(CRASH_WORDS)].map((m) => crashKind(t, m));
  if (!kinds.length) return false;
  if (kinds.includes('vehicle')) return true;
  if (kinds.includes('digital')) return false;
  if (VEHICLE_WORD.test(t)) return true;
  return !DIGITAL_WORD.test(t);
}

// Drugs that turn up in recalls. Named so that a recall of one is a health story even when the headline says nothing else.
const NAMED_DRUGS = [
  'propranolol', 'metformin', 'lisinopril', 'atorvastatin', 'amlodipine', 'losartan', 'valsartan', 'metoprolol',
  'gabapentin', 'sertraline', 'levothyroxine', 'ibuprofen', 'acetaminophen', 'Tylenol', 'Advil', 'aspirin',
  'insulin', 'Ozempic', 'Wegovy', 'Zepbound', 'Mounjaro', 'amoxicillin', 'fentanyl', 'oxycodone', 'opioid', 'opioids',
];

// News sites that only repost press releases, and satire sites whose jokes read like headlines. A story whose
// source is one of these is left out. Matched on the source's name, ignoring case and punctuation, as whole words.
export const EXCLUDE_SOURCES = [
  'EIN Presswire', 'EIN News', 'PR Newswire', 'Business Wire', 'GlobeNewswire', 'Accesswire', 'openPR', 'PRWeb', 'Newsfile',
  // satire
  'The Onion', 'The Babylon Bee', 'Babylon Bee', 'ClickHole', 'The Beaverton', 'Reductress', 'The Hard Times', 'Duffel Blog',
  'The Daily Mash', 'NewsThump', 'Waterford Whispers News',
];

// Headlines we have seen and do not want, by hand. Lowercase pieces of a title; a title that
// holds one is left out. Add a line here when a headline slips through the families below.
export const HIDE_TITLES = ['muir announces', 'drastic step'];

export const EXCLUDE_FAMILIES = [
  {
    name: 'death',
    terms: [
      'killed', 'kills', 'kill', 'dead', 'death', 'deaths', 'dies', 'died', 'dying', 'fatal', 'fatalities',
      'toll', 'victim', 'victims', 'suicide', 'overdose', 'funeral', 'obituary', 'bodies',
      // extended
      'deadly', 'fatality', 'fatally', 'casualties', 'casualty', 'murdered', 'killing', 'killings', 'killer', 'perished',
      'drowned', 'drowning', 'mourn', 'mourns', 'mourning', 'vigil',
      'claimed lives', 'claims lives', 'lost their lives', 'lost lives', 'lives lost', 'loss of life', 'slain',
      'slaughter', 'survivors', 'rubble', 'rescuers',
      // animal culls
      'cull', 'culls', 'culled', 'culling',
    ],
  },
  {
    name: 'injury',
    terms: [
      { term: 'injur', prefix: true }, // injured, injuries, injury, injures, injuring
      'wounded', 'missing',
      // extended
      'trapped', 'critical condition',
      // "leaves 10 hurt" (not "hurtles", which is an asteroid). "hurts" and "hurting" are also what a price or a
      // service does ("hurts earnings", "hurting small businesses"), so they count only with people or a number after them.
      'hurt',
      { pattern: 'hurt(?:s|ing)\\s+(?:(?:at least|more than|over|nearly|about)\\s+)?(?:\\d[\\d,]*|dozens|scores|hundreds|several|many|people|passengers|workers|residents|travell?ers|fans|drivers|riders|officers|firefighters|soldiers)', label: 'hurts people' },
      // hospitalized, hospitalised, hospitalizations; not hospitality
      { pattern: 'hospitali[sz]\\w*', label: 'hospitalized' },
    ],
  },
  {
    name: 'violence',
    terms: [
      'shooting', 'shooter', 'gunman', 'stabbing', 'murder', 'massacre', 'hostage', 'genocide', 'rape', 'abuse',
      { term: 'terror', prefix: true }, { term: 'bomb', prefix: true }, { term: 'kidnap', prefix: true },
      'sexual',
      // extended
      'shootings', 'gunmen', 'gunshot', 'gunshots', 'stabbed', 'murders', 'hostages', 'rapes', 'raped', 'rapist',
      { term: 'abus', prefix: true }, 'sexually', 'assault', 'assaulted', 'trafficking', 'molest', 'molested',
      'pedophile', 'hate crime',
      // gunfire and people being shot ("shot" alone is a camera, a vaccine and a rocket launch)
      'gunfire', 'gunfight', 'shootout', { pattern: 'open(?:s|ed|ing)?\\s+fire', label: 'opens fire' }, 'shots fired', 'mauled',
      {
        pattern:
          '(?:man|woman|men|women|person|people|suspect|driver|officer|officers|passenger|passengers|guard|worker|workers|teen|boy|girl|pilot)\\b[^.]{0,40}\\bshot\\b|\\bshot (?:dead|and (?:killed|wounded)|by police)',
        label: 'shot',
      },
    ],
  },
  {
    // Nude photos, porn and the like: this is a site for all ages, so none of it is shown, joke or no joke.
    name: 'explicit',
    terms: [
      'nude', 'nudes', 'nudity', 'topless', 'porn', 'pornography', 'pornographic', 'sextortion', 'sexting', 'sex', 'OnlyFans',
      // "naked eye" is astronomy and stays
      { pattern: 'naked(?!\\s+eyes?)', label: 'naked' },
      { pattern: 'explicit\\s+(?:photos?|images?|videos?|content|material)', label: 'explicit content' },
    ],
  },
  {
    name: 'war',
    terms: [
      'war', 'missile', 'airstrike', 'strike on', 'invasion', 'troops', 'nuclear threat',
      // extended
      'wars', 'warfare', 'wartime', 'missiles', 'airstrikes', 'drone strike', 'drone strikes', 'military strike',
      'shelling', 'ceasefire', 'soldiers', 'battlefield', 'nuclear war',
    ],
  },
  {
    // Kids and schools: the site belongs to a school principal.
    name: 'children',
    terms: [
      'child', 'children', 'kid', 'kids',
      'schoolchild', 'schoolchildren', 'schoolkid', 'schoolkids', 'schoolboy', 'schoolboys', 'schoolgirl', 'schoolgirls',
      'school', 'schools', 'preschool', 'kindergarten', 'daycare', 'student', 'students',
      { term: 'toddler', prefix: true }, { term: 'teen', prefix: true }, // teen, teens, teenager, teenage
      'infant', 'infants', 'baby', 'babies', 'newborn', 'newborns', 'juvenile', 'juveniles', 'underage',
      'boy', 'boys', 'girl', 'girls',
      // a school district's initials: "KISD", "Katy ISD"
      { pattern: '\\b[A-Z]{0,5}ISD\\b', caseSensitive: true, label: 'school district' },
    ],
  },
  {
    // A crash with people in it. Market, crypto, app, site and server crashes stay.
    name: 'crash',
    label: 'crash with people',
    predicate: crashWithPeople,
  },
  {
    name: 'hate',
    terms: [
      { term: 'antisemit', prefix: true }, { term: 'anti-semit', prefix: true }, 'Jewish', 'Jew', 'Jews', 'Judaism',
      'synagogue', 'synagogues', 'rabbi', 'mosque', 'mosques', 'imam', 'Muslim', 'Muslims', 'Islam', 'Islamic', 'Islamist',
      { term: 'Islamophob', prefix: true }, 'Hindu', 'Sikh', 'Buddhist', 'Catholic', 'Christian', 'Christians', 'Christianity',
      'church', 'churches', 'cathedral', 'pastor', 'priest', 'Pope', 'Vatican', { term: 'religio', prefix: true },
      'Nazi', 'Nazis', 'Holocaust', 'racism', 'racist', 'racists', 'racial', { term: 'white supremac', prefix: true },
      'KKK', 'Ku Klux', 'hate speech', 'hate group', { term: 'bigot', prefix: true }, 'slur', 'slurs',
    ],
  },
  {
    // Human illness. A germ with no sick people in it (a lab, an animal, space, a superbug) stays.
    name: 'illness',
    terms: [
      'patient', 'patients', 'hospital', 'hospitals', 'clinic', 'clinics', 'therapy', 'therapist', 'therapists',
      'sick', 'sickens', 'sickened', 'sickness', 'illness', 'illnesses', 'epidemic', 'pandemic',
      { pattern: '(?<!tornado\\s)outbreaks?', label: 'outbreak' },
      'measles', 'mumps', 'rubella', 'polio', 'whooping cough', 'pertussis', 'tuberculosis', 'cholera', 'dengue',
      'malaria', 'norovirus', 'hepatitis', 'HIV', 'mpox', 'monkeypox', 'Ebola', 'Marburg', 'Nipah', 'Zika', 'chikungunya',
      'Legionnaires', 'Legionella', 'listeria', 'salmonella', { pattern: 'E\\.?\\s?coli', label: 'E. coli' }, 'botulism',
      'foodborne', 'food poisoning', 'covid', 'coronavirus',
      { term: 'vaccin', prefix: true }, 'immunization', 'immunisation', 'antivax', 'anti-vax',
      // Medicine: a pill, a prescription or a recalled drug is a health story, whatever else the headline says.
      'pill', 'pills', 'medication', 'medications', 'medicine', 'medicines', 'prescription', 'prescriptions',
      'laceration', 'lacerations', 'blood pressure',
      { pattern: 'drugs?\\b[^.]{0,40}\\brecall\\w*|\\brecall\\w*[^.]{0,40}\\bdrugs?', label: 'drug recall' },
      ...NAMED_DRUGS,
    ],
  },
  {
    name: 'places',
    skipForSignals: true,
    terms: [
      'Israel', 'Gaza', 'Hamas', 'Hezbollah', 'Iran', { term: 'Palestin', prefix: true }, 'Ukraine', 'Russia',
      'Putin', 'Zelensky', 'Netanyahu',
      // extended
      'Israeli', 'Israelis', 'Iranian', 'Iranians', 'Russian', 'Russians', 'Ukrainian', 'Ukrainians', 'Kremlin',
      'Kyiv', 'Tehran', 'Houthi', 'Houthis', 'Taliban', 'ISIS', 'West Bank', 'Syria', 'Yemen', 'Lebanon',
    ],
  },
  {
    name: 'politics',
    skipForSignals: true,
    terms: [
      'Trump', 'Biden', 'Harris', 'Vance', { term: 'election', prefix: true }, { term: 'Congress', prefix: true },
      'Senate', { term: 'Republican', prefix: true }, { term: 'Democrat', prefix: true }, 'GOP', 'abortion',
      { term: 'immigra', prefix: true }, { term: 'ICE', caseSensitive: true },
      // extended
      'Duffy', 'Buttigieg', 'midterm', 'midterms', 'White House', 'lawmakers', 'lawmaker', 'senator', 'senators',
      'Obama', 'impeach', 'impeachment',
      // lawsuits and the attorneys general who bring them (a governor or a mayor can be a real near miss)
      'attorney general', 'attorneys general', 'sues', 'sued', 'lawsuit', 'lawsuits',
      // trade, the Fed and the people who make the news about themselves
      { term: 'tariff', prefix: true }, 'Powell', 'Federal Reserve', 'Fed chair', 'Supreme Court', 'sanctions',
      'Elon Musk', { term: 'Musk', caseSensitive: true },
      // government officials commenting on an outage are still politics
      { term: 'DHS', caseSensitive: true }, 'Homeland Security', 'Pentagon', 'Capitol Hill',
      // heads of government and the places they speak, here and abroad; "Fox News" in a headline, never the source field
      'Fox News', 'prime minister', 'minister', 'ministers', 'chancellor', 'parliament', 'parliamentary',
    ],
  },
  {
    name: 'format',
    terms: [
      'how to', 'what to know', 'explainer', 'opinion', 'podcast', 'live updates', 'watch:', 'video:',
      // extended: guides, rumors and predictions are not incidents
      'what to do', 'what should you', 'what you need', 'everything you need', 'things to know', 'faq',
      'q&a', 'hoax', 'conspiracy', 'conspiracies', 'debunk', 'debunked', 'fact check', 'fact-check', 'rumor',
      'rumors', 'rumour', 'rumours', 'myth', 'myths', 'prophet', 'psychic', 'prophecy', 'predicts',
      'prediction', 'predictions', 'horoscope', 'is there going to be', 'will there be', 'emergency supply',
      'supply list', 'prepare for', 'preparedness', 'survival guide', 'sponsored', 'press release',
      { pattern: "here['\\u2019]?s what" },
      // a photo-archive tag ("April 15. Archives." or "Photo archive: ..."): the word has to end the headline or a clause.
      // The National Archives, Archive of Our Own and the Wayback Machine's archives are sites with real outages and
      // breaches, and the Internet Archive is one too
      { pattern: '(?<!Internet\\s)archives?(?=\\s*(?:[.:|]|$))', label: 'archives' },
      // A columnist's section label ("SOLAR FLARE | Life's just a rom-com") is not
      // an incident. Newsroom tags such as BREAKING | stay.
      {
        pattern: '^(?!(?:BREAKING|UPDATE|LIVE|WATCH|DEVELOPING|ALERT|JUST IN)\\b)[A-Z]{3,}(?: [A-Z]{3,})+ \\|',
        caseSensitive: true,
        label: 'column label',
      },
    ],
  },
  {
    // Shopping and clickbait that borrow our keywords ("Black Friday hack").
    name: 'junk',
    terms: [
      'must know', 'black friday', 'cyber monday', 'promo code', 'coupon', 'coupons', 'life hack', 'life hacks',
      'hack you', 'hacks for', 'hacks to', 'travel hack', 'travel hacks', 'money hack', 'money hacks', 'best deals',
      '% off', 'the best',
    ],
  },
  {
    // A headline that is a question is rarely an incident report. "Is X down?"
    // style headlines are the exception.
    name: 'question',
    label: 'question headline',
    predicate: (title) => title.includes('?') && !/\b(?:down|outages?|offline|not working)\b[^?]*\?/i.test(title),
  },
  { name: 'press release', label: 'press release site', sources: EXCLUDE_SOURCES },
  { name: 'hidden', label: 'hidden headline', titles: HIDE_TITLES },
];

// ---------------------------------------------------------------------------
// Signals (instruments) and the vital signs
// ---------------------------------------------------------------------------
export const SIGNALS = {
  quake: { minMag: 6.0 },
  // 1 lunar distance in astronomical units, and the asteroid size model
  lunarDistancePerAu: 389.17,
  albedo: 0.14,
  asteroidWindow: { pastHours: 24, nextHours: 48, storyWithinLd: 1 },
  sizeBuckets: [
    { maxM: 4, label: 'a car' },
    { maxM: 14, label: 'a bus' },
    { maxM: 40, label: 'a house' },
    { maxM: 100, label: 'a jumbo jet' },
    { maxM: 400, label: 'a stadium' },
    { maxM: 1000, label: 'a skyscraper' },
    { maxM: Infinity, label: 'a mountain' },
  ],
};

// FAA "Core 30" airports: a ground stop at one of these counts as a major hub.
export const FAA = {
  hubs: [
    'ATL', 'BOS', 'BWI', 'CLT', 'DCA', 'DEN', 'DFW', 'DTW', 'EWR', 'FLL', 'HNL', 'IAD', 'IAH', 'JFK', 'LAS',
    'LAX', 'LGA', 'MCO', 'MDW', 'MEM', 'MIA', 'MSP', 'ORD', 'PHL', 'PHX', 'SAN', 'SEA', 'SFO', 'SLC', 'TPA',
  ],
  // Ground stops at this many airports at once (or a reason that says so) is a nationwide stop.
  nationwideAirports: 10,
  nationwideReason: /\b(?:nationwide|national|all (?:u\.?s\.? )?(?:airports|flights|departures))\b/i,
};

// The "internet" instrument. status.zoom.us redirects to www.zoomstatus.com.
export const STATUS_PAGES = [
  { id: 'github', name: 'GitHub', host: 'www.githubstatus.com' },
  { id: 'cloudflare', name: 'Cloudflare', host: 'www.cloudflarestatus.com' },
  { id: 'openai', name: 'OpenAI', host: 'status.openai.com' },
  { id: 'claude', name: 'Claude', host: 'status.claude.com' },
  { id: 'discord', name: 'Discord', host: 'discordstatus.com' },
  { id: 'reddit', name: 'Reddit', host: 'www.redditstatus.com' },
  { id: 'zoom', name: 'Zoom', host: 'www.zoomstatus.com' },
  { id: 'coinbase', name: 'Coinbase', host: 'status.coinbase.com' },
];

// How long a failed signal source may keep showing its last good reading.
export const STALE_HOURS = { usgs: 24, swpc: 12, jpl: 48, faa: 3, status: 3 };

// Static tile, no source.
export const DOOMSDAY_CLOCK = {
  secondsToMidnight: 85,
  setOn: '2026-01-27',
  url: 'https://thebulletin.org/doomsday-clock/',
};

// ---------------------------------------------------------------------------
// X (optional, budget-capped). Off unless X_BEARER_TOKEN is set.
// ---------------------------------------------------------------------------
export const X = {
  accounts: [
    'BNONews', 'spectatorindex', 'Breaking911', 'unusual_whales', 'FlightRadar24', 'AP', 'Reuters',
    'BBCBreaking', 'cnnbrk', 'DownDetector',
  ],
  // Every post from these counts, with or without a keyword. Each one must also be in accounts, in the same
  // spelling, so its posts can be told from its author id.
  everyPost: ['DownDetector'],
  keywords: [
    'outage', '"ground stop"', 'grounded', 'hacked', 'breach', 'blackout', '"power outage"', 'cyberattack',
    'ransomware', '"is down"', 'earthquake', '"solar flare"', 'asteroid', '"flash crash"', '"trading halted"',
    'tsunami', 'volcano',
  ],
  minIntervalMinutes: 60,
  dailyBudgetUsd: 0.6, // override with X_DAILY_BUDGET_USD. The editor's 1.40 and this 0.60 make the owner's $2 a day.
  costPerPostRead: 0.005,
  costPerUserRead: 0.01,
  maxResults: 10,
  userRefreshDays: 7,
  usageKeepDays: 14,
  headlineChars: 200,
};

// ---------------------------------------------------------------------------
// Quiet mode: auto-trip when a mass-casualty event dominates the news.
// ---------------------------------------------------------------------------
export const QUIET = {
  topStoriesUrl: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  topN: 30,
  tripAt: 3, // this many of the top headlines must match
  holdHours: 6, // once tripped, stay quiet at least this long
  terms: [
    /\bmass shootings?\b/i,
    /\bterror(?:ist)? attacks?\b/i,
    /\bmassacres?\b/i,
    /\b(?:dozens|scores|hundreds)\b[^.]{0,20}\b(?:killed|dead)\b/i,
    /\bdeath tolls?\b/i,
    // A toll in numbers, said any of the usual ways: "12 dead", "5 people killed", "5 more dead", "kills 8".
    /\b\d[\d,]*\s+(?:[\w'’-]+\s+){0,2}(?:killed|dead)\b/i,
    // "kills 8", "kills at least 12", "kills dozens" (but not "kills 8 percent of traffic")
    /\bkills?\s+(?:at least\s+|more than\s+|over\s+|nearly\s+|about\s+)?(?:\d[\d,]*(?!\d)(?!\s*(?:%|percent\b|per ?cent\b))|dozens\b|scores\b|hundreds\b)/i,
  ],
  // Used only when Google News top stories refuses us, so the kill switch
  // still has a pair of eyes. An addition to the spec; it costs one request
  // to each feed per refused run.
  fallbackFeeds: [
    { via: 'bbc-top-stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { via: 'npr-top-stories', url: 'https://feeds.npr.org/1001/rss.xml' },
  ],
  quietCaption: 'No jokes on this one.',
  // Where a quiet card sends people who want to help. A quake outside the US
  // goes to the international federation, everything else to the US Red Cross.
  quietLink: 'https://www.redcross.org/donate',
  quietLinkIntl: 'https://www.ifrc.org/',
};

// GDELT is a bounded bonus: few calls, wide spacing, stop at the first refusal.
export const GDELT = { callsPerRun: 4, spacingMs: 6000 };

// HN: stories from the last 24 hours with real traction.
export const HN = {
  queries: [
    { q: 'outage', cat: 'internet' },
    { q: 'breach', cat: 'hacks' },
    { q: 'hacked', cat: 'hacks' },
    { q: 'down', cat: 'internet' },
  ],
  minPoints: 40,
};

// ---------------------------------------------------------------------------
// The daily edition: a one-sentence headline and 3 to 10 items for every day, each with
// a label, an emoji and a line, and up to 30 more stories picked by id for "More from today",
// written by hand or by the editor (scripts/editor.mjs).
// One set of rules checks both. An edition that breaks them is not used, and the day
// shows plain headlines.
// ---------------------------------------------------------------------------
export const EDITION = {
  headlineEnd: 'Still here.',
  headlineMax: 110, // characters: one sentence and "Still here."
  headlineMinWords: 5, // words before "Still here."
  firstSentenceMinWords: 4, // the share card shows the first sentence alone
  labelMax: 32, // characters, and 1 to 4 words
  labelMaxWords: 4,
  lineMax: 110, // characters
  emojiMax: 8, // UTF-16 units
  minItems: 3,
  maxItems: 10,
  moreMax: 30, // story ids the editor picks for "More from today"
  fallbackRows: 5, // plain headlines shown for a day with no edition
  fallbackPerCategory: 2,
  homeDays: 7, // day blocks on the homepage: today and up to 6 earlier days
};

// The editor. It calls the Claude API at most EDITOR_DAILY_CAP times a day. A regular call waits until the
// stories it would read have changed and a gap has passed since its last call: EDITOR_MIN_GAP_MINUTES by day,
// EDITOR_NIGHT_GAP_MINUTES from midnight until EDITOR_NIGHT_END_HOUR, and longer when the day's money must be
// spread to last until midnight. Big news (the EDITOR_BREAKING_* settings below) jumps the line: it needs only
// EDITOR_BREAKING_GAP_MINUTES, and it may spend the reserve. The editor stops for the day once it has spent
// EDITOR_DAILY_BUDGET_USD. The owner's cap is $2 a day for the whole site: 1.40 here and 0.60 for X (X.dailyBudgetUsd above).
export const EDITOR_MODEL = 'claude-opus-5-5';
export const EDITOR_DAILY_CAP = 20;
export const EDITOR_MIN_GAP_MINUTES = 60; // between regular calls, from EDITOR_NIGHT_END_HOUR until midnight ET
export const EDITOR_NIGHT_GAP_MINUTES = 180; // between regular calls, from midnight until EDITOR_NIGHT_END_HOUR ET
export const EDITOR_NIGHT_END_HOUR = 6; // the night gap ends at this hour ET (6 is 6:00 AM)
export const EDITOR_DAILY_BUDGET_USD = 1.4;
export const EDITOR_BREAKING_RESERVE_USD = 0.25; // kept back from regular calls, for breaking news only
export const EDITOR_COST_GUESS = 0.09; // dollars one call costs, until today's average is higher
// What a call costs, in dollars per million tokens, for Opus 5.5 (Anthropic's pricing page, 2026-11-17).
export const EDITOR_PRICES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
export const EDITOR_MAX_STORIES = 80;
// The editor reads the new stories first: every story that came out in the last EDITOR_FRESH_HOURS hours,
// newest first, at most EDITOR_FRESH_MAX of them, and then the rest in the page's order up to the 80.
export const EDITOR_FRESH_HOURS = 6;
export const EDITOR_FRESH_MAX = 30;
// Big news. A story is big when its trending is at least EDITOR_BREAKING_TRENDING, or it is a signal scoring at least
// EDITOR_BREAKING_SIGNAL_SCORE, or it is in at least EDITOR_BREAKING_OUTLETS outlets and first reached our feeds in
// the last EDITOR_BREAKING_NEW_HOURS hours. A big story the edition does not have and the editor has not been
// sent while big today is breaking, and it gets a breaking call.
export const EDITOR_BREAKING_TRENDING = 20000; // Google searches
export const EDITOR_BREAKING_SIGNAL_SCORE = 5; // a nationwide ground stop, a quake of 7 or more, a G3 storm, an X5 flare
export const EDITOR_BREAKING_OUTLETS = 8; // outlets that carry the story
export const EDITOR_BREAKING_NEW_HOURS = 3; // how recently a many-outlet story must have first reached our feeds
export const EDITOR_BREAKING_GAP_MINUTES = 15; // a breaking call waits only this long after the last call
export const EDITOR_BREAKING_MAX = 6; // breaking calls a day
export const EDITOR_BIG_SENT_MAX = 200; // big story ids kept for today, so one story is not breaking twice

export function config() {
  return {
    window: WINDOW,
    limits: LIMITS,
    firstEdition: FIRST_EDITION,
    variety: VARIETY,
    blockedPublishers: BLOCKED_PUBLISHERS,
    doom: DOOM,
    categories: CATEGORIES,
    exclude: EXCLUDE_FAMILIES,
    signals: SIGNALS,
    faa: FAA,
    statusPages: STATUS_PAGES,
    staleHours: STALE_HOURS,
    clock: DOOMSDAY_CLOCK,
    x: X,
    quiet: QUIET,
    gdelt: GDELT,
    hn: HN,
    edition: EDITION,
    editor: {
      model: EDITOR_MODEL,
      dailyCap: EDITOR_DAILY_CAP,
      minGapMinutes: EDITOR_MIN_GAP_MINUTES,
      nightGapMinutes: EDITOR_NIGHT_GAP_MINUTES,
      nightEndHour: EDITOR_NIGHT_END_HOUR,
      dailyBudgetUsd: EDITOR_DAILY_BUDGET_USD,
      breakingReserveUsd: EDITOR_BREAKING_RESERVE_USD,
      costGuess: EDITOR_COST_GUESS,
      prices: EDITOR_PRICES,
      maxStories: EDITOR_MAX_STORIES,
      freshHours: EDITOR_FRESH_HOURS,
      freshMax: EDITOR_FRESH_MAX,
      breakingTrending: EDITOR_BREAKING_TRENDING,
      breakingSignalScore: EDITOR_BREAKING_SIGNAL_SCORE,
      breakingOutlets: EDITOR_BREAKING_OUTLETS,
      breakingNewHours: EDITOR_BREAKING_NEW_HOURS,
      breakingGapMinutes: EDITOR_BREAKING_GAP_MINUTES,
      breakingMax: EDITOR_BREAKING_MAX,
      bigSentMax: EDITOR_BIG_SENT_MAX,
    },
  };
}
