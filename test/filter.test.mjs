import test from 'node:test';
import assert from 'node:assert/strict';
import { config, crashWithPeople, EXCLUDE_SOURCES, HIDE_TITLES } from '../scripts/config.mjs';
import { compileExcluder, compileGate } from '../scripts/lib/filter.mjs';
import { createGatekeeper } from '../scripts/lib/pipeline.mjs';
import { looksNotEnglish, qualityCheck } from '../scripts/lib/quality.mjs';

const cfg = config();
const ex = compileExcluder(cfg.exclude);
const gate = compileGate(cfg.categories);
const verdict = (title, opts) => ex.test(title, opts);

// Every term of the spec list (section 5), each in a headline that would
// otherwise be kept, with the family that must catch it.
const SPEC_TERMS = {
  death: ['killed', 'kills', 'kill', 'dead', 'death', 'deaths', 'dies', 'died', 'dying', 'fatal', 'fatalities', 'toll', 'victim', 'victims', 'suicide', 'overdose', 'funeral', 'obituary', 'bodies'],
  injury: ['injured', 'injuries', 'wounded', 'missing'],
  violence: ['shooting', 'shooter', 'gunman', 'stabbing', 'murder', 'massacre', 'terror', 'terrorist', 'bomb', 'bombing', 'hostage', 'genocide', 'rape', 'abuse', 'kidnap', 'sexual'],
  war: ['war', 'missile', 'airstrike', 'strike on', 'invasion', 'troops', 'nuclear threat'],
  children: ['child', 'children', 'kid', 'kids'],
  crash: ['plane crash', 'crashed'],
  places: ['Israel', 'Gaza', 'Hamas', 'Hezbollah', 'Iran', 'Palestine', 'Palestinian', 'Ukraine', 'Russia', 'Putin', 'Zelensky', 'Netanyahu'],
  politics: ['Trump', 'Biden', 'Harris', 'Vance', 'election', 'Congress', 'Senate', 'Republican', 'Democrat', 'GOP', 'abortion', 'immigrant', 'ICE'],
  format: ['how to', 'what to know', 'explainer', 'opinion', 'podcast', 'live updates', 'watch:', 'video:'],
};

for (const [family, terms] of Object.entries(SPEC_TERMS)) {
  test(`exclusion family "${family}" catches every spec term`, () => {
    for (const term of terms) {
      const title = `Big outage report ${term} continues at the airport`;
      const v = verdict(title);
      assert.ok(v, `"${term}" should be excluded`);
      assert.equal(v.family, family, `"${term}" should be caught by ${family}, got ${v?.family}`);
    }
  });
}

test('any headline about a school, students, patients or a hospital is excluded', () => {
  assert.equal(verdict('Network outage hits school district after lockdown')?.family, 'children');
  assert.equal(verdict('School network faces threat from hackers')?.family, 'children');
  assert.equal(verdict('School district network outage leaves laptops offline')?.family, 'children');
  assert.equal(verdict('Student portal down for hours')?.family, 'children');
  assert.equal(verdict('Patient portal outage')?.family, 'illness');
  assert.equal(verdict('Hospital network restores systems after outage')?.family, 'illness');
});

test('ICE is case sensitive, so an ice storm survives', () => {
  assert.equal(verdict('Ice storm knocks out power to 40,000 customers'), null);
  assert.equal(verdict('ICE agents seen near the airport')?.family, 'politics');
});

test('word boundaries: harmless words that contain a banned word survive', () => {
  for (const title of [
    'Warsaw airport reports an outage',
    'Warner Bros streaming site is down',
    'Deadline passes for the exchange hack bounty',
    'Kidney app suffers outage',
    'Skid row power outage',
    'Cloudflare outage knocks thousands of sites offline',
  ]) {
    assert.equal(verdict(title), null, title);
  }
});

test('prefix terms catch their family: terror, bomb, kidnap, Palestin, immigra', () => {
  assert.equal(verdict('Terrorism alert causes airport delay')?.family, 'violence');
  assert.equal(verdict('Bombing near station closes line')?.family, 'violence');
  assert.equal(verdict('Kidnapping suspect caught after outage')?.family, 'violence');
  assert.equal(verdict('Palestinian news site goes down')?.family, 'places');
  assert.equal(verdict('Immigration site down for hours')?.family, 'politics');
});

test('format family drops guides, explainers and rumors', () => {
  for (const title of [
    'What to know about the banking outage',
    'Opinion: why the grid keeps failing',
    'Live updates: Cloudflare outage continues',
    'Why conspiracy theorists believe a global blackout could happen',
    'Is 90-day blackout beginning Nov. 17? Why unfounded rumor is spreading',
  ]) {
    assert.ok(verdict(title), title);
  }
});

test('extended casualty terms: lives lost, rubble, survivors, trapped, hospitalized are dropped', () => {
  const cases = [
    ['Quake claimed lives across the coast', 'death'],
    ['Storm claims lives as it crosses the state', 'death'],
    ['Rescuers search the rubble after the quake', 'death'],
    ['Search for survivors continues after the quake', 'death'],
    ['Passengers trapped on the runway during the ground stop', 'injury'],
    ['Measles outbreak: dozens hospitalized in the county', 'injury'],
    ['Recall expands as hospitalizations rise', 'injury'],
  ];
  for (const [title, family] of cases) assert.equal(verdict(title)?.family, family, title);
});

// ---- the hard exclusions, with the exact headlines the review found ---------------------

const MUST_BE_EXCLUDED = {
  'violence and injury': ['Man fatally shot at airport', 'Gunfire at LAX terminal', 'Robot malfunction injures worker', 'Dozens hospitalized after chemical leak', '12 killed in blast', 'Report: 30 dead after storm'],
  'kids and schools': ['Hackers hit schoolchildren records', "Hackers leak students' records", 'Toddlers game app exposes data', 'Teens targeted by app flaw', 'Baby formula recalled over botulism', 'School district network outage leaves laptops offline', 'Student portal down for hours', 'Patient portal outage', 'Hospital network restores systems after outage'],
  'crashes with people': ['Airline stock falls after Air India crash', 'Plane crash disrupts flights', 'Helicopter crash in Hudson', 'Train crash near Paris', 'Bus crash on highway', 'Car crash closes bridge'],
  'hate and religion': ['Antisemitic rants spread on app', 'Jewish school targeted by hackers', 'Synagogue websites hit by outage', 'Mosque site hacked', 'Church livestream goes down', 'Nazis flood forum', 'Racism on platform'],
  'politics and people in the news': ['Tariff hike rattles markets', 'Vaccine debate flares', 'Powell fired as Fed chair', 'Elon Musk says X is down', "DHS chief insists the 'homeland is secure' as tech outages hit airlines and banks", 'Homeland Security briefed on the bank outage'],
  'human illness': ['Listeria sickens 27 across states', 'Ebola outbreak in Congo', 'Therapy notes of 30,000 patients leaked', 'Measles cases rise', 'Vaccines recalled', 'E. coli found in lettuce', 'Salmonella recall', 'Botulism scare', 'Dozens hospitalized after leak', 'US has lost measles elimination status'],
};

for (const [group, titles] of Object.entries(MUST_BE_EXCLUDED)) {
  test(`taste filter, ${group}: every exact headline from the review is excluded`, () => {
    for (const title of titles) assert.ok(verdict(title), `"${title}" should be excluded`);
  });
}

test('taste filter: the families the exact headlines land in', () => {
  const expected = [
    ['Man fatally shot at airport', 'death'],
    ['Gunfire at LAX terminal', 'violence'],
    ['Robot malfunction injures worker', 'injury'],
    ['Hackers hit schoolchildren records', 'children'],
    ['Baby formula recalled over botulism', 'children'],
    ['Airline stock falls after Air India crash', 'crash'],
    ['Antisemitic rants spread on app', 'hate'],
    ['Synagogue websites hit by outage', 'hate'],
    ['Tariff hike rattles markets', 'politics'],
    ['Powell fired as Fed chair', 'politics'],
    ['Elon Musk says X is down', 'politics'],
    ['Listeria sickens 27 across states', 'illness'],
    ['Therapy notes of 30,000 patients leaked', 'illness'],
  ];
  for (const [title, family] of expected) assert.equal(verdict(title)?.family, family, title);
});

test('taste filter: tech and market crashes, cyberattacks and animal or lab germs are still kept', () => {
  for (const title of [
    'Cyberattack takes city payment systems offline',
    'DDoS attack knocks gaming site offline',
    'Market crash wipes billions from tech stocks',
    'Crypto crash: Bitcoin plunges below 60,000',
    'App crash leaves banking customers locked out',
    'Server crashes knock thousands of sites offline',
    'Site crashes as demand spikes',
    'Stocks plunge in sudden flash crash',
    'Bitcoin crashes below 60,000 in wild swing',
    'Cloudflare outage knocks thousands of sites offline',
    'Tornado outbreak sweeps the plains',
    'Superbug found in lab-grown samples',
    'Bird flu found at dairy farm',
    'New virus found in bats',
    'Microbes survive on the space station',
    'Hospitality software outage hits hotels',
    'Ice storm knocks out power to 40,000 customers',
    'Warsaw airport reports an outage',
  ]) assert.equal(verdict(title), null, title);
});

test('format family: a columnist label with a pipe is dropped, newsroom tags are not', () => {
  assert.equal(verdict("SOLAR FLARE | Life's Just a 2000s Rom-Com")?.family, 'format');
  assert.equal(verdict('BREAKING NEWS | Chase outage hits banking app')?.family ?? null, null);
  assert.equal(verdict('BREAKING | Nationwide ground stop at US airports')?.family ?? null, null);
  assert.equal(verdict('Chase | Outage hits banking app')?.family ?? null, null);
  assert.equal(verdict('Outage hits Chase | Banking app down')?.family ?? null, null);
});

test('"crash kills" is excluded (the death family gets there first)', () => {
  assert.ok(verdict('Big outage report: crash kills pilot'));
});

test('question headlines are dropped unless they ask whether something is down', () => {
  assert.equal(verdict('Is ChatGPT down? Users report problems'), null);
  assert.equal(verdict('What caused the outage? Engineers explain'), null);
  assert.equal(verdict('Why did semiconductor stocks plunge? Advantest down 11%')?.family, 'question');
  assert.equal(verdict('Is power going out Nov. 17?')?.family, 'question');
});

test('exclusion applies to signals too, except place names and politics in instrument titles', () => {
  assert.equal(verdict('M 6.1 - 20 km W of Tehran, Iran', { signal: true }), null);
  assert.equal(verdict('M 6.1 - 20 km W of Tehran, Iran')?.family, 'places');
  assert.ok(verdict('M 6.1 quake leaves dozens dead', { signal: true }));
});

// ---- category gate ---------------------------------------------------------
const POSITIVE = {
  flights: ['Nationwide ground stop halts flights across the US', 'United Airlines system outage delays departing flights', 'FAA outage traced to aging copper switch'],
  hacks: ['Major banking outage linked to Chase impacts customers', 'Hackers steal customer data in breach at retailer', 'Ransomware attack knocks out payment systems'],
  internet: ['Cloudflare outage takes down thousands of websites', 'Microsoft bug behind global Outlook outage', '911 outage hits several counties'],
  space: ['Asteroid passes Earth at 0.3 lunar distances', 'Fireball seen across the Midwest', 'Near-Earth object flyby surprises astronomers'],
  sun: ['G3 geomagnetic storm underway after solar flare', 'Northern lights alert issued as solar storm hits', 'X-class flare knocks out radio on the sunlit side'],
  earth: ['Powerful 6.6-magnitude earthquake strikes off the coast', 'Volcano erupts and ash cloud closes airspace', 'Tsunami warning issued after offshore quake'],
  markets: ['Flash crash briefly wipes out billions in stocks', 'Trading halted as circuit breakers trigger', 'Bitcoin plunges in a crypto crash'],
  ai: ['ChatGPT down for thousands of users', 'Waymo robotaxis stuck in gridlock after glitch', 'Rogue AI agent deletes company database'],
  grid: ['Rolling blackouts hit regional grid', 'Thousands without power after substation failure', 'Citywide blackout leaves downtown dark'],
  germs: ['Bird flu outbreak found at dairy farm', 'Listeria recall expands across grocery stores', 'Measles outbreak grows in two counties'],
  weather: ['Record heat sets all-time highs for November', 'Freak hailstorm batters the valley', 'Derecho knocks down trees across the region'],
  animals: ['Bear breaks into suburban kitchen', 'Orcas ram sailboat off the coast', 'Three goats on the loose downtown'],
};
const NEGATIVE = {
  flights: ['Cavs score vs Bulls recap'],
  hacks: ['Ten life hacks for a tidy kitchen', 'Best credit card bonus offers this holiday'],
  internet: ['Power outage hits thousands in the storm', 'Sports blackout frustrates fans'],
  space: ['Meteor shower peaks tonight', 'Hera spacecraft maker announces a new contract'],
  sun: ['Northern Lights forecast for this week', 'Sunny weekend ahead'],
  earth: ['Study estimates magnitude of data center pollution', 'Magnitude 5.4 earthquake rattles town'],
  markets: ['Tech stocks to buy now', 'Why Berkshire analysts expect higher earnings'],
  ai: ['AI drives finance department headcounts down', 'New robotaxi launches in a fourth city'],
  grid: ['90-day blackout rumor spreads online'],
  germs: ['Five mistakes that raise your botulism risk'],
  weather: ['Project Hail Mary sci-fi hit is hard to adapt', 'Senco Gold shares hit record high on festive sales'],
  animals: ['Woman stung by hundreds of bees hospitalised'],
};

for (const c of cfg.categories) {
  test(`gate "${c.id}": keeps its own headlines`, () => {
    for (const t of POSITIVE[c.id]) assert.equal(gate.matches(c.id, t), true, t);
  });
  test(`gate "${c.id}": turns away off-topic headlines`, () => {
    for (const t of NEGATIVE[c.id]) assert.equal(gate.matches(c.id, t), false, t);
  });
}

test('every category has a keyword gate and a query, and no caption', () => {
  assert.equal(cfg.categories.length, 12);
  assert.deepEqual(
    cfg.categories.map((c) => c.id),
    ['flights', 'hacks', 'internet', 'space', 'sun', 'earth', 'markets', 'ai', 'grid', 'germs', 'weather', 'animals'],
  );
  for (const c of cfg.categories) {
    assert.ok(!('captions' in c) && !('nearMiss' in c), `${c.id}: the editor writes the lines now`);
    assert.ok(c.keywords.length >= 3, c.id);
    assert.ok(c.queries.length >= 1, c.id);
  }
});

test('a category can claim a headline: bank outages are Hacked, ChatGPT outages are Robots', () => {
  assert.equal(gate.pick('Chase outage leaves online banking down for customers', 'internet'), 'hacks');
  assert.equal(gate.pick('ChatGPT down for thousands of users', 'internet'), 'ai');
  assert.equal(gate.pick('Nationwide ground stop halts flights', 'internet'), 'flights');
  assert.equal(gate.pick('Cloudflare outage takes down thousands of websites', 'internet'), 'internet');
  assert.equal(gate.pick('Cavs score vs Bulls recap', 'internet'), null);
});

test('weather: hail the weather is kept; hail the greeting, the verb and Mary are not', () => {
  for (const t of [
    'Baseball-sized hail tears roof off Phoenix clinic, leaving patients scrambling',
    'Giant hail pummels the Texas panhandle',
    'Hailstorm damages hundreds of cars in Calgary',
    'Storm drops 10cm hail across western NSW',
    'Near-record high temperatures this week',
  ]) {
    assert.equal(gate.pick(t, 'weather'), 'weather', t);
  }
  for (const t of [
    'Producers hail Robert Pattinson’s selection as new 007',
    'Hail Mary pass wins the game',
    'Review: All Hail the Priest of Hell',
    'Northern businesses hail new draft deal',
    'Mobile County schools earn record-high state report card score',
    'Amazon has the Shark FlexFusion on sale for a record-low price',
    'Diesel prices fall below $6 per gallon after weeks at record high',
  ]) {
    assert.equal(gate.pick(t, 'weather'), null, t);
  }
});

test('markets: a market move is kept, one company\'s stock is not', () => {
  for (const t of ['US Stocks Plunge as tech selloff deepens', 'Stock market tumbles on rate fears', 'Bitcoin crashes below 60,000 in wild swing', 'Nasdaq plunges as trading is halted']) {
    assert.equal(gate.pick(t, 'markets'), 'markets', t);
  }
  for (const t of ['Tesla stock plunges after earnings miss', 'New World stock plummets to record low on rights issue plan', 'Should you buy the stock after it tumbled?']) {
    assert.equal(gate.pick(t, 'markets'), null, t);
  }
});

test('hacks: a bank customers cannot get into is kept, a business that cannot get a loan is not', () => {
  for (const t of [
    'Customers at major banks report difficulty accessing accounts online',
    'Banking users report trouble accessing online services for Chase, Bank of America, Wells Fargo, others',
    'Chase and Wells Fargo customers can’t get to their money',
    'Chase online banking problems hit nearly 10,000 users',
  ]) {
    assert.equal(gate.pick(t, 'internet'), 'hacks', t);
  }
  for (const t of [
    'Small businesses report trouble accessing bank loans',
    'Banks report difficulty accessing credit markets',
    'Regional bank stock down 4%',
  ]) {
    assert.equal(gate.pick(t, 'hacks'), null, t);
  }
});

test('internet: "AWS down" and "took down Microsoft 365" are kept, "Apple down 3%" is not', () => {
  for (const t of [
    'AWS down in US-EAST-1, sign-ins and sign-ups fail for over three hours',
    'Microsoft Outlook Down Again? Email Problems Spill Into Monday as Users Report Messages Not Sending',
    'Three small failures combined to take down Microsoft 365',
    'Microsoft Reveals How a Hidden Windows Bug Took Down Microsoft 365 Services Worldwide',
  ]) {
    assert.equal(gate.pick(t, 'internet'), 'internet', t);
  }
  for (const t of ['Apple down 3% as iPhone sales slow', 'Microsoft down by 2% in early trading', 'Regulators took Microsoft to court']) {
    assert.equal(gate.pick(t, 'internet'), null, t);
  }
});

test('recall: an AI agent that deletes things, a bear in a kitchen and a new COVID variant are kept', () => {
  assert.equal(gate.pick('AI agent deletes company production database', 'ai'), 'ai');
  assert.equal(gate.pick('Bear walks into suburban kitchen, eats groceries', 'animals'), 'animals');
  assert.equal(gate.pick('New COVID variant spreads across Asia', 'germs'), 'germs');
  assert.equal(gate.pick('New tariffs strain household budgets', 'germs'), null);
  assert.equal(gate.pick('Chicago Bears walk into the bye week', 'animals'), null);
});

test('flights: an air traffic glitch is kept, a policy piece about air traffic is not', () => {
  assert.equal(gate.pick('Air traffic glitch believed to have originated with router in El Dorado', 'flights'), 'flights');
  assert.equal(gate.pick('Air traffic system failure grounds flights across the Northeast', 'flights'), 'flights');
  assert.equal(gate.pick('Lawmakers debate air traffic funding', 'flights'), null);
});

test('markets: earnings releases, drug trials and market-research reports are not market moves', () => {
  for (const t of [
    'Toppoint Holdings Reports Third Quarter and Nine-Month 2026 Results; NYSE American Trading Halted',
    'Aribio-linked stocks plunge as Alzheimer’s drug hits subset goal but misses overall effect',
    'Aribio-Related Stocks Plunge... Market Remains Unimpressed Despite AR1001 Phase 3 Results',
    'Circuit Breaker Test Sets Market To 2035: Grid Modernization and Renewables Drive Demand',
  ]) {
    assert.equal(gate.pick(t, 'markets'), null, t);
  }
  assert.equal(gate.pick('Wall Street plunges as Nvidia reports results', 'markets'), 'markets');
});

test('hacks: a price going down and a threat report are not incidents', () => {
  for (const t of [
    'Why Is Crypto Down? CZ Explains and Says Binance Did Not Sell',
    'Industrial Ransomware Analysis for Q3 2026',
    'House of Lords Warns UK Is Underprepared for Cyber Attacks and Major Crises',
  ]) {
    assert.equal(gate.pick(t, 'hacks'), null, t);
  }
  assert.equal(gate.pick('Coinbase is down for thousands of users', 'hacks'), 'hacks');
  assert.equal(gate.pick('Chase outage leaves online banking down for customers', 'hacks'), 'hacks');
});

test('animals: loose animals are kept, team nicknames in a game report are not', () => {
  for (const t of ['Escaped monkeys on the loose near the highway', '‘Faster than you think’: 3 goats on the loose in East Greenwich', 'Swarm of bees shuts down the street', 'Orcas ram another sailboat off Portugal']) {
    assert.equal(gate.pick(t, 'animals'), 'animals', t);
  }
  for (const t of ['Bears escaped with a win over the Lions', 'Tigers vs Sharks: escaped loose ball sparks overtime', 'Woman hospitalised after being stung by hundreds of bees']) {
    assert.equal(gate.pick(t, 'animals'), null, t);
  }
});

// ---- phase 4: what the second review found, with its exact headlines ---------------------

test('item 1: "opens fire", "hurt" and "nude" are excluded', () => {
  assert.equal(verdict('Ground stop at JFK after man opens fire in terminal')?.family, 'violence');
  assert.equal(verdict('Turbulence leaves 10 hurt as flights grounded')?.family, 'injury');
  assert.equal(verdict('Hackers leak nude photos stolen in breach')?.family, 'explicit');
  // every way of saying it
  for (const t of ['Gunman opens fire at the airport', 'Man opened fire near the gate', 'Person opening fire on a crowd', 'Suspect will open fire during the outage']) {
    assert.equal(verdict(t)?.family, 'violence', t);
  }
  for (const t of ['Turbulence hurts 10 passengers on a grounded flight', 'Dozens hurt as outage strands riders', 'Storm hurting dozens as flights are grounded', 'Blast hurts at least 12 near the airport', 'Turbulence hurt several passengers']) {
    assert.equal(verdict(t)?.family, 'injury', t);
  }
  // as a verb for what a price or a service does, hurts and hurting are not about people
  for (const t of ['Weak jobs report hurts stocks as Wall Street tumbles', 'Cloudflare outage hurting small businesses and thousands of sites', 'Strong dollar hurts earnings as Nasdaq plunges']) {
    assert.equal(verdict(t), null, t);
  }
  for (const t of ['Nudes leaked in app breach', 'Hackers expose nudity filter data', 'Naked photos exposed in cloud breach', 'Porn site breach exposes members', 'Sextortion ring hacked a messaging app', 'Hackers leak explicit photos from a cloud account']) {
    assert.equal(verdict(t)?.family, 'explicit', t);
  }
});

test('item 1: the new words do not catch a hurtling asteroid, the naked eye, an open firewall or a pillow', () => {
  for (const t of [
    'Asteroid hurtles past Earth at 0.3 lunar distances',
    'Solar flare lights up auroras visible to the naked eye',
    'Open firewall rules caused the Cloudflare outage',
    'Pillow maker confirms data breach',
  ]) {
    assert.equal(verdict(t), null, t);
  }
});

test('item 2: pills, medication, medicine, drug recalls, lacerations and named drugs are excluded', () => {
  assert.equal(verdict('Blood pressure pills recalled over potential contamination with metal, laceration risk')?.family, 'illness');
  assert.equal(verdict('Popular blood pressure medicine propranolol recalled in the US over possible metal contamination')?.family, 'illness');
  for (const t of [
    'Pills recalled after metal found in bottles',
    'Medication recalled over mislabeled bottles',
    'Cough medicine recalled over glass pieces',
    'Drug recall expands to three more lots',
    'Recall of a generic drug over contamination',
    'Laceration risk prompts product recall',
    'Metformin recalled in the US over possible metal contamination',
    'Ozempic counterfeits turn up in pharmacies',
    'Prescription app breach exposes records',
  ]) {
    assert.ok(verdict(t), `"${t}" should be excluded`);
  }
  // a recall of cheese, and a breach at a pillow maker, are not medicine
  for (const t of ['Cheese recalled over metal pieces', 'Pillow maker confirms data breach']) assert.equal(verdict(t), null, t);
});

test('item 5: Fox News in a headline, a prime minister, a minister, a chancellor and a parliament are politics', () => {
  assert.equal(verdict('Schmitt Joins Fox News to Push for Bill')?.family, 'politics');
  assert.equal(verdict('Following Nationwide Ground Stop, Schmitt Joins Fox News to Push for Bill to Modernize Aviation Systems')?.family, 'politics');
  for (const t of [
    'Prime minister blames the airline outage',
    'Transport minister grilled over the ground stop',
    'German chancellor visits an airport hit by an outage',
    'Parliament debates the blackout response',
  ]) {
    assert.equal(verdict(t)?.family, 'politics', t);
  }
});

test('item 5: Fox News as the source of a story is not a reason to drop it, only the headline is read', () => {
  const gk = createGatekeeper(cfg);
  const now = Date.parse('2026-11-17T15:00:00Z');
  const item = { kind: 'news', cat: 'internet', title: 'Cloudflare outage knocks thousands of sites offline', url: 'https://example.com/a', source: 'Fox News', publishedAt: now - 3600e3 };
  assert.ok(gk.admit(item, now).keep, 'a clean headline from Fox News is kept');
  assert.ok(gk.admit({ ...item, title: 'Schmitt Joins Fox News to Push for Bill on the Cloudflare outage' }, now).drop, 'the same words in the headline are not');
});

test('item 6: a digital or financial word next to the crash word wins, even beside an airline', () => {
  const gk = createGatekeeper(cfg);
  for (const [title, cat] of [
    ['Delta flights grounded after computer system crashes', 'flights'],
    ['ChatGPT crashes for millions', 'ai'],
    ['ASTER flash crash', 'markets'],
  ]) {
    assert.equal(crashWithPeople(title), false, title);
    assert.equal(verdict(title), null, `${title} passes the taste filter`);
    assert.equal(gate.pick(title), cat, `${title} files under ${cat}`);
    assert.equal(gk.admit({ kind: 'news', title, url: 'https://example.com/x', source: 'S', publishedAt: Date.parse('2026-11-17T14:00:00Z') }, Date.parse('2026-11-17T15:00:00Z')).keep?.cat, cat, `${title} is stored`);
  }
});

test('item 6: a crash with people in it still goes, and the word next to the crash decides it', () => {
  for (const t of ['after Air India crash', 'plane crash', 'bus crash', 'Plane crash sends Nasdaq tumbling', 'Crash of a Boeing 737 sends airline stocks tumbling', 'Wreckage of the crashed plane found']) {
    assert.equal(crashWithPeople(t), true, t);
    assert.equal(verdict(t)?.family, 'crash', t);
  }
  // and the crashes the site is about stay
  for (const t of ['Market crash wipes billions from tech stocks', 'Server crashes knock thousands of sites offline', 'Instagram crashes for users across the US', 'Crypto crash: Bitcoin plunges below 60,000']) {
    assert.equal(crashWithPeople(t), false, t);
  }
});

// ---- real headlines still flow through the filters ---------------------------------------
//
// The jokes are the editor's now, so a category no longer has a near-miss word list. What stays
// is the second safety net: a story that passes every filter is filed in its category. These
// tables are real headlines that pass the taste filter and the gate.

const WITH_NEAR_MISS_WORDS = {
  flights: ['Nationwide ground stop halts flights across the US', 'United Airlines system outage delays departing flights', 'Delta flights grounded after computer system crashes', 'United Airlines says it resolved a technology issue that affected departing flights'],
  hacks: ['Hackers steal customer data in breach at retailer', 'Ransomware attack knocks out payment systems', 'Retailer confirms security incident after passwords leak'],
  internet: ['Cloudflare outage takes down thousands of websites', 'Slack is down for users across the US', '911 outage hits several counties'],
  space: ['Asteroid passes Earth at 0.3 lunar distances', 'Fireball seen across the Midwest', 'Near-Earth object flyby surprises astronomers'],
  sun: ['G3 geomagnetic storm underway after solar flare', 'Northern lights alert issued as solar storm hits', 'Magnetic storm watch issued for the weekend'],
  earth: ['Volcano erupts and ash cloud closes airspace', 'Tsunami warning issued after offshore quake', 'Powerful 6.6-magnitude earthquake strikes off the coast'],
  markets: ['Flash crash briefly wipes out billions in stocks', 'Trading halted as circuit breakers trigger', 'Bitcoin plunges in a crypto crash', 'Tech giants lose $300 billion in market value in a day'],
  ai: ['ChatGPT down for thousands of users', 'Waymo robotaxis stuck in gridlock after glitch', 'Rogue AI agent deletes company database', 'AI blunder at a car dealer sells a truck for a dollar'],
  grid: ['Rolling blackouts hit regional grid', 'Thousands without power after substation failure', 'Citywide blackout leaves downtown dark'],
  germs: ['Bird flu detected in Oklahoma dairy herd', 'Scientists find new virus in bats'],
  weather: ['Record heat sets all-time highs for November', 'Freak hailstorm batters the valley', 'Giant hail pummels the Texas panhandle'],
  animals: ['Bear breaks into suburban kitchen', 'Orcas ram sailboat off the coast', 'Three goats on the loose downtown', 'Bear found in a garage after the family left the door open'],
};

// Real headlines that land in a category and are not near misses: a bank outage is not a hack,
// a recall is not a germ, a hurricane watch is not a freak of weather.
const OTHER_STORIES = {
  flights: ['Airspace closed over the northern coast for a rocket launch', 'Air traffic control radar problem slows arrivals at the hub'],
  hacks: ['Major banking outage linked to Chase, impacted Wells Fargo and BofA', 'Chase Bank recovering after widespread outage'],
  internet: ['Downdetector shows a spike in reports for Spotify'],
  earth: ['Tsunami warning lifted along the Pacific coast'],
  ai: ['Deepfake chaos spreads as a fake video goes viral'],
  germs: ['Cheese recalled over metal pieces'],
  weather: ['Derecho knocks down trees across the region', 'Hurricane watch posted along the coast'],
};

for (const c of cfg.categories) {
  test(`item 4: "${c.id}" headlines pass the taste filter and are filed in the category`, () => {
    for (const t of [...WITH_NEAR_MISS_WORDS[c.id], ...(OTHER_STORIES[c.id] || [])]) {
      assert.equal(verdict(t), null, `${t} passes the taste filter`);
      assert.equal(gate.pick(t, c.id), c.id, `${t} files under ${c.id}`);
    }
  });
}

// ---- phase 5, item 14: the weather matcher and the English check --------------------------

const SPANISH_CHARITY_RUN = 'Por el derecho de la niñez a crecer en familia, las Aldeas Infantiles SOS convocan a una carrera pedestre';
const OUTLOOK_DROP = 'Microsoft blames the major global drop in Outlook, Teams, and Copilot on a latent software failure since July';

test('item 14: the Spanish word for a right is not a storm', () => {
  assert.equal(gate.matches('weather', SPANISH_CHARITY_RUN), false, 'the charity run is not weather');
  assert.equal(gate.pick(SPANISH_CHARITY_RUN, 'weather'), null, 'and files nowhere');
  for (const t of ['El derecho a la salud en debate', 'Los derechos humanos en el congreso', 'Un derecho de todos los niños', 'Por el derecho de las familias']) assert.equal(gate.matches('weather', t), false, t);
});

test('item 14: a derecho storm still counts as weather', () => {
  for (const t of ['Derecho knocks down trees across the region', 'A derecho tore through Iowa overnight', 'Derecho leaves 200,000 without power', 'Rare derecho storm hits the Plains', 'Meteorologists warn a derecho is possible Friday', 'The derecho, a line of fast storms, moved east']) {
    assert.equal(gate.matches('weather', t), true, t);
  }
});

test('item 14: headlines that are not in English are dropped at the door, English ones are not', () => {
  assert.equal(qualityCheck(SPANISH_CHARITY_RUN, ['Aldeas Infantiles'], null)?.reason, 'quality:language');
  for (const t of ['Las autoridades confirman que el vuelo fue cancelado por la tormenta', 'Le gouvernement annonce une panne des systèmes de réservation', 'Der Flughafen ist wegen einer Störung der Systeme gesperrt', 'O governo diz que o sistema ficou fora do ar por uma hora', 'Il governo conferma che la rete è stata colpita da un attacco']) {
    assert.equal(looksNotEnglish(t), true, t);
  }
  assert.equal(qualityCheck(OUTLOOK_DROP, ['Demócrata'], null), null, 'the English headline from a Spanish-named outlet is kept');
  assert.equal(looksNotEnglish(OUTLOOK_DROP), false);
  // names and loan words that look foreign are not enough
  for (const t of ['Los Angeles airport hit by a ground stop', 'La Nina is back and the winter outlook is changing', 'El Salvador tells the world its grid is back up', 'Del Monte recalls cans after a mix-up at the plant', 'Air traffic control outage in Paris, a day after the strike was called off']) {
    assert.equal(looksNotEnglish(t), false, t);
  }
});

test('review: die, van, door and met are English words too, so they are not counted as foreign', () => {
  assert.equal(looksNotEnglish('die van door met'), false, 'four small words that are also English add up to nothing');
  // each one alone, said twice, adds up to nothing too, so none of them can come back unnoticed
  for (const w of ['die', 'van', 'door', 'met']) assert.equal(looksNotEnglish(`${w} ${w}`), false, w);
  // English headlines with a name or a word in them: kept
  for (const t of ['Door County van catches fire', 'Die Hard van chase recreated', 'Van Halen and Die Antwoord announce a joint tour', 'Vincent van Gogh show draws record crowds', 'Mayor met van drivers at the Door County fair']) {
    assert.equal(looksNotEnglish(t), false, t);
    assert.equal(qualityCheck(t, ['Example'], null), null, `${t} passes the door`);
  }
  // headlines in other languages still go, because they are full of words that are only foreign
  for (const t of [SPANISH_CHARITY_RUN, 'De regering heeft het plan niet door de Kamer gekregen', 'Het kabinet is het niet eens met de plannen voor de stad', 'Die Bundesregierung hat den Plan nicht mit der Opposition besprochen']) {
    assert.equal(looksNotEnglish(t), true, t);
    assert.equal(qualityCheck(t, ['Example'], null)?.reason, 'quality:language', t);
  }
});

test('review: a small word right before a capitalised word is part of a name, not a foreign word', () => {
  // kept: the Spanish in them is a name
  for (const t of ['Día de los Muertos parade draws record crowds', 'Los Angeles de la Salle high school wins title']) {
    assert.equal(looksNotEnglish(t), false, t);
    assert.equal(qualityCheck(t, ['Example'], null), null, `${t} passes the door`);
  }
  // dropped: the same small words with no name after them are a sentence in Spanish
  for (const t of ['El desfile de los muertos reúne a miles de personas en la ciudad', SPANISH_CHARITY_RUN]) {
    assert.equal(looksNotEnglish(t), true, t);
  }
  // the name has to follow right away: a comma between is a new phrase, and the word counts
  assert.equal(looksNotEnglish('el, Madrid y la, Barcelona'), true);
  assert.equal(looksNotEnglish('Madrid el Barcelona'), false, 'with a name straight after, it does not');
});

test('item 14: the language check is steady and safe on odd input', () => {
  for (const odd of [undefined, null, '', 42, {}, [], '...', '   ']) assert.equal(looksNotEnglish(odd), false, String(odd));
  assert.deepEqual([1, 2, 3].map(() => looksNotEnglish(SPANISH_CHARITY_RUN)), [true, true, true]);
});

// ---- phase 6: what never goes on a page ------------------------------------------------------------------------------------

// Headlines that were live and not wanted, with the family that says why.
const NOT_WANTED = [
  ["Data breach: 45,000 current and former KISD employees 'may have been exposed'", 'children'],
  ['California Attorney General Rob Bonta Sues OpenAI Over Hugging Face Cyberattack', 'politics'],
  ['Southern Indian state to cull thousands of birds after Bird flu detected', 'death'],
  ['ChatGPT or Claude down? The best backup AI to use', 'junk'],
  ['Spring daffodils covered in snow after an ice storm hit the Niagara region April 15. Archives.', 'format'],
  ['FAA ground stop led a woman to take this drastic step to get home', 'hidden'],
];

// Headlines that sit close to those and are news.
const STILL_NEWS = [
  'Hackers inject credit card, crypto-stealing malware into 178 major websites',
  'FAA outage traced to aging copper-wire switch as expert warns air traffic system needs overhaul',
  'Couple who missed wedding due to nationwide ground stop married at airport',
  'Bird flu detected in Oklahoma dairy herd',
  'Internet Archive breach exposes 31 million accounts',
  'Wayback Machine back online after hackers knocked out Internet Archive',
  // a sitting official in a real near miss is news, so a governor or a mayor is not a reason to drop a headline
  'Governor declares state of emergency as wildfire forces evacuations',
  // sites with archive in the name have real outages and breaches
  'National Archives website hit by cyberattack',
  'Archive of Our Own down after DDoS attack',
  'The Wayback Machine archives went offline after attack',
];

test('phase 6 taste: each headline the owner flagged is dropped, by the family that says why', () => {
  for (const [title, family] of NOT_WANTED) assert.equal(verdict(title, { source: 'Example News' })?.family, family, title);
  for (const title of STILL_NEWS) assert.equal(verdict(title, { source: 'Example News' }), null, title);
});

test('phase 6 taste: lawsuits and attorneys general are politics, whatever the case, and a governor or a mayor in a near miss is not', () => {
  for (const title of [
    'Attorney General sues cloud company over outage',
    'Attorneys general warn exchange after crash',
    'Company sued after major outage',
    'Bank sues vendor over a day of downtime',
    'Class action lawsuit filed over bank outage',
    'Lawsuits pile up after the airline outage',
  ]) assert.equal(verdict(title)?.family, 'politics', title);
  // a governor or a mayor speaking in a real near miss is not a reason to drop it
  for (const title of [
    'Governor declares state of emergency as wildfire forces evacuations',
    'Governor orders power restored after blackout',
    'Governors ask for grid help',
    'Mayor says water back on after outage',
    'Mayors meet on the grid',
  ]) assert.equal(verdict(title), null, title);
  // words that only look like the lawsuit words
  for (const title of ['Suede sofa outage at the airport lounge', 'Pursued by hackers, the bank stayed online', 'Sale of the outage insurance ended']) assert.equal(verdict(title), null, title);
});

test('phase 6 taste: a school district is named by its capital initials, and only in capitals', () => {
  for (const title of ['Katy ISD network outage', 'MISD systems down for a second day', 'KISD employees may have been exposed', 'Hackers hit LISD servers', 'ISD outage drags on', 'Big outage hits HOUSTON ISD today']) assert.equal(verdict(title)?.family, 'children', title);
  // not a district: lowercase, more than five capitals, or a word that holds the letters
  for (const title of ['The isd card reader failed at the airport', 'The ABCDEFISD gateway failed', 'Kiss day: the iSD card failed', 'Network outage hits AWSISDS today']) assert.equal(verdict(title), null, title);
  // the rule is exact about case: "Isd" is not a district
  assert.equal(verdict('Airport Isd system outage ends'), null);
});

test('phase 6 taste: animal culls, "the best" and photo archives are dropped, and a word that holds them is not', () => {
  for (const title of ['Cattle culled after outbreak', 'Officials cull flocks after bird flu', 'Culling of poultry begins', 'Hundreds of hens culls reported']) assert.equal(verdict(title)?.family, 'death', title);
  for (const title of ['A table that is the best of the best for outages', 'The best apps to use when the cloud is down', 'Why this is the best time to check your backups']) assert.ok(verdict(title), title);
  // a photo-archive tag ends the headline or a clause
  for (const title of ['Photo archive: ice storm hits region', 'Spring daffodils covered in snow after an ice storm hit the Niagara region April 15. Archives.', 'Photos from the archive | Storm hits region', 'Storm photos, archives', 'Flood photos: Archives']) assert.equal(verdict(title)?.family, 'format', title);
  // a site with archive in its name has real outages and breaches, so a headline that merely names it is news
  for (const title of ['National Archives website hit by cyberattack', 'Archive of Our Own down after DDoS attack', 'The Wayback Machine archives went offline after attack', 'Archives show the grid failed before', 'Internet Archive hacked again', 'Internet Archive breach exposes 31 million accounts', 'Outage keeps the Internet Archive offline']) assert.equal(verdict(title), null, title);
  for (const title of ['Mcculloch says the grid is back', 'Cullen says the cloud is up', 'Disarchive tool goes offline', 'The bestseller outage hits the store']) assert.equal(verdict(title), null, title);
});

test('phase 6 taste: a story from a press-release wire is dropped by the news site, whatever its headline says', () => {
  assert.deepEqual(EXCLUDE_SOURCES, ['EIN Presswire', 'EIN News', 'PR Newswire', 'Business Wire', 'GlobeNewswire', 'Accesswire', 'openPR', 'PRWeb', 'Newsfile']);
  const title = 'Cloudflare outage knocks thousands of sites offline';
  assert.equal(verdict(title, { source: 'EIN Presswire' })?.family, 'press release');
  assert.deepEqual(verdict(title, { source: 'EIN Presswire' }), { family: 'press release', term: 'EIN Presswire' });
  // case, spacing and punctuation do not matter, and extra words after the name do not either
  for (const source of ['ein presswire', 'EIN-Presswire', 'ein_presswire', 'EIN Presswire (press release)', 'PRNewswire', 'PR Newswire', 'Business Wire', 'BUSINESSWIRE', 'GlobeNewswire', 'Globe Newswire', 'Accesswire', 'openPR', 'OpenPR', 'PRWeb', 'Newsfile', 'EIN News']) assert.equal(verdict(title, { source })?.family, 'press release', source);
  // the wire's web address is the same site: GDELT names its sources that way
  for (const source of ['einpresswire.com', 'www.einpresswire.com', 'prnewswire.com', 'https://www.businesswire.com/', 'globenewswire.com', 'accesswire.com', 'openpr.com', 'prweb.com', 'einnews.com', 'Globe Newswire (press release)', 'PRNewswire (press release)']) assert.equal(verdict(title, { source })?.family, 'press release', source);
  // whole words: a news site that merely holds the letters is a news site
  for (const source of ['The Verge', 'Open Prairie Reporter', 'Press Democrat', 'Einstein Weekly', 'Wired', 'Presswire Daily Review', 'openprairie.com', 'prwebdesign.com', 'newsfiles.com', 'seinnews.com', 'businesswired.com', '', null, undefined, 42]) assert.equal(verdict(title, { source }), null, String(source));
  // with no source given, a headline is read alone, as it always was
  assert.equal(verdict(title), null);
});

test('phase 6 taste: a headline hidden by hand is dropped by a lowercase piece of its title', () => {
  assert.deepEqual(HIDE_TITLES.slice(0, 2), ['muir announces', 'drastic step']);
  assert.ok(HIDE_TITLES.every((t) => t === t.toLowerCase() && t.trim() === t && t.length > 3), 'lowercase, trimmed, and not so short that it catches everything');
  assert.deepEqual(verdict('FAA ground stop led a woman to take this DRASTIC STEP to get home'), { family: 'hidden', term: 'drastic step' }, 'any case in the title');
  assert.equal(verdict('Muir announces plan for the lights')?.family, 'hidden');
  assert.equal(verdict('Cloudflare outage knocks thousands of sites offline'), null);
  // the families are the only place a piece is held: a custom list works the same way
  const own = compileExcluder([{ name: 'hidden', titles: ['One-Off Title', ''], sources: ['Some Wire'] }]);
  assert.equal(own.test('A one-off title appears')?.term, 'one-off title');
  assert.equal(own.test('Nothing like it'), null, 'an empty piece catches nothing');
  assert.equal(own.test('Nothing like it', { source: 'some-wire' })?.term, 'Some Wire');
});

test('phase 6 taste: the door, a stored story and the build all read the same rules, news site included', () => {
  const gk = createGatekeeper(cfg);
  const now = Date.parse('2026-11-17T15:00:00Z');
  const raw = (over = {}) => ({ kind: 'news', cat: 'internet', title: 'Cloudflare outage knocks thousands of sites offline', url: 'https://pub.example/a', source: 'The Verge', publishedAt: now - 3600e3, ...over });
  assert.equal(gk.admit(raw(), now).keep?.title, 'Cloudflare outage knocks thousands of sites offline');
  assert.deepEqual(gk.admit(raw({ source: 'EIN Presswire' }), now), { drop: 'excluded:press release', detail: 'EIN Presswire' }, 'at the door');
  assert.equal(gk.admit(raw({ title: 'Cloudflare outage over, says Attorney General of Texas' }), now).drop, 'excluded:politics');
  assert.ok(gk.admit(raw({ title: 'Cloudflare outage over, says Mayor of Springfield' }), now).keep, 'a mayor is not a reason');
  const stored = { ...raw(), id: 'abc123abc123', firstSeenAt: '2026-11-17T12:00:00.000Z', outlets: 1, outletNames: ['EIN Presswire'] };
  assert.deepEqual(gk.recheck({ ...stored, source: 'EIN Presswire' }), { drop: 'excluded:press release', detail: 'EIN Presswire' }, 'a story already stored is cleaned on the next run');
  assert.equal(gk.recheck({ ...stored, title: 'Katy ISD network outage' }).drop, 'excluded:children');
  assert.ok(gk.recheck(stored).keep, 'and a good one stays');
});
