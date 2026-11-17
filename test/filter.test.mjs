import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../scripts/config.mjs';
import { compileExcluder, compileGate } from '../scripts/lib/filter.mjs';

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

test('every category has a caption line and a keyword gate', () => {
  assert.equal(cfg.categories.length, 12);
  assert.deepEqual(
    cfg.categories.map((c) => c.id),
    ['flights', 'hacks', 'internet', 'space', 'sun', 'earth', 'markets', 'ai', 'grid', 'germs', 'weather', 'animals'],
  );
  for (const c of cfg.categories) {
    assert.ok(c.captions.length >= 1 && c.captions[0].length > 5, c.id);
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
