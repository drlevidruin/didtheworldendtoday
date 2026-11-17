# Did the world end today?

A site that answers "Did the world end today?" with ALMOST. and then shows the day's near misses, one day at a time. Every day gets a headline of one plain sentence and then "Still here.", 5 to 10 lines, a Doom Score from 0 to 99, and its own page. It looks like a safety sign: black on yellow, with a huge ALMOST. and the Doom Score on a black board. The homepage is a feed of the last week. Older days live in the Almanac of Almost. Made by [@thelpdrive](https://x.com/thelpdrive).

## How it works

Every 15 minutes a GitHub Action reads the feeds, saves what it found as plain JSON in `data/`, asks Claude to write today's edition (when it is due: about every hour or two in the day, every three hours overnight, and within 15 minutes when big news breaks), builds the whole site into `dist/`, and publishes it to GitHub Pages. There is no server and no database. The pages are static files. A small script in the page checks for newer data and offers a refresh.

### Where it reads

- Google News and Bing News: headlines for 12 categories (flights, hacks, internet, space, sun, earth, markets, AI, grid, germs, weather, animals)
- GDELT: a bonus set of headlines, when it answers
- Hacker News: tech outages and breaches
- USGS: earthquakes
- NOAA Space Weather Prediction Center: Kp index and solar alerts
- NASA/JPL: asteroid close approaches
- FAA: ground stops
- Status pages of big services: "is the internet down"
- Google Trends: what people in the US are searching for right now (one read per run, no key). Each trend's news stories become headlines and go through the same filters as any other, and a story that was a trend carries how many searches it drew, so the editor can see what people are talking about. A headline that fits no category on its own is filed by its search instead ("apple outage" is internet), and the headline itself is still judged by the exclusion filter and the quality checks
- X: only when turned on (see below). Every post from Downdetector always counts, whatever it says

Headlines are stored as published, escaped when a page is built, and linked only if the link is http or https.

### Before the first push

Set up Pages first. In the repository's Settings, open Pages and set Source to **GitHub Actions**. The workflow deploys through it, so the first run fails until this is set.

### When it runs

`.github/workflows/update.yml` runs at minutes 4, 19, 34 and 49 of every hour (not on the hour, when GitHub is busiest) and on every push to `main`. Each run installs, updates the data, writes today's edition, builds, runs the tests, commits the data if it changed, and deploys.

The site is checked every 15 minutes, but the list of near misses is rewritten less often, because every rewrite is a paid call to Claude:

- About every hour or two in the day.
- Every three hours overnight, from midnight to 6 AM Eastern.
- Within 15 minutes when big news breaks.
- The day's money is spread so it lasts until midnight, so the list does not freeze for the evening.

How the editor decides is under "The daily edition" below.

### The Doom Score

A category fires when 3 or more different publishers have a headline in it within 24 hours, or when its instrument trips. Each fired category is worth 6 points. The floor is 11, because there is always something. The cap is 99, because it is never 100. Instruments add points on top: an FAA ground stop, an asteroid inside 1 lunar distance, a strong geomagnetic storm, a big quake, a big status page in major outage. The exact numbers live in `DOOM` in `scripts/config.mjs` and are printed on the About page, which reads them from the same place.

Today's score and stories are the last 24 hours, and each run saves that view as today's file in `data/days/`. When the Eastern date changes, that day's last file is its final version. It is never rewritten, so the Almanac scores never move, and "yesterday" always means yesterday's final score. Every date and time on the site is Eastern: a page says `Updated 6:12 AM ET`, and the feed and the sitemap use Eastern time too.

### The daily edition

Each day has an edition in `data/editions/YYYY-MM-DD.json`: a headline of one plain sentence and then "Still here." (up to 110 characters) and 5 to 10 lines, one per near miss, ranked from most world-ending to least, so line 1 is the closest call. Each line has a label that names the thing, in 1 to 4 words ("FAA outage"), over a line of up to 110 characters that says what happened. The order of the lines is the rank; there is no separate best story. The edition also has `more`, up to 30 ids of other stories worth a look that day, best first: the editor's picks from the rest of the day for "More from today" (an edition without `more`, a hand one or an older one, has none). A story shows up once. If an earlier day's edition already told it, it never appears in a later edition or in a later day's plain headlines.

The editor (`npm run edit`, `scripts/editor.mjs`) writes today's edition by sending the day's headlines to the Claude API. It only calls when the stories have changed since the last call, and at most 20 times a day. A gap is counted from the last call, even one whose answer was thrown out for breaking a rule, so a bad answer is not paid for again 15 minutes later (`lastCallAt` in `data/state/editor.json`). A regular call waits the longer of two gaps. The clock gap is 60 minutes from 6 AM to midnight Eastern and 180 minutes from midnight to 6 AM. The paced gap spreads the money: the editor keeps $0.25 of the $1.40 back for breaking news, works out how many calls the rest buys (each reckoned at the larger of $0.09 and today's average cost), and waits the minutes left until midnight divided by that number. With less than one call left, the log says the rest is saved for breaking news. A skipped run says when the next call can be, like `next regular call after 4:05 PM ET (60-minute gap; $0.81 left for 9 calls)`. A story is big news when it has 20,000 or more Google searches, or is a signal that scores 5 or more (a nationwide ground stop, a quake of 7 or more, a G3 or stronger storm, an X5 or bigger flare, an asteroid inside 0.1 lunar distances, a critical outage on a status page), or is in 8 or more outlets and first reached our feeds in the last 3 hours. When a big story is not in today's edition and has not been sent to the editor while big (`bigSent` in `data/state/editor.json`), the next run calls as soon as 15 minutes have passed since the last call, even if the stories are the same ids, and may spend the $0.25. Every call sends the big stories first. There are at most 6 of these breaking calls a day (`breakingCalls`), and the $1.40 and the 20-call cap still stop them. All of these numbers are the `EDITOR_*` settings in `scripts/config.mjs`. It stops for the day once it has spent $1.40: after each answer it adds the cost, worked out from the token counts the API reports and the prices in `EDITOR_PRICES`, to `usd` in `data/state/editor.json`, and the next run says so in one line and skips. X gets the other $0.60, so the two together stay inside $2 a day. Every story it sends has `hoursAgo`, how many whole hours ago the story came out, and the input has `told`, the items of the last two editions before today as "label: line" (at most 12). The prompt asks for the newest events first (the last 12 hours, and an older one only when that leaves fewer than 5) and tells it to skip anything already in `told` unless something new and bigger happened, so an outage or a quake is not told again the next day under new story ids. It does nothing when quiet mode is on, and it never replaces an edition written by hand. It never fails a run: if the key is missing, the call fails, or the answer breaks a rule, it logs one line and the edition already on file stays.

One check decides whether an edition can be used, for the editor and for the build. It needs a headline of one sentence and then "Still here." (at least 5 words before "Still here.", a first sentence of at least 4 words that is not the whole headline, and no text after that sentence that starts with a lowercase letter or a number, which means an abbreviation cut it short; up to 110 characters), at least 3 usable lines, no dashes, semicolons or exclamation marks in our own text, nothing the taste filter blocks, and ids that are real stories not used on an earlier day. A label has its own check: 1 to 4 words, up to 32 characters, no period, and the same text rules as a line. The `more` list keeps only ids of the stories the editor was sent (the day's stories, when the build checks the file again), leaves out an id an item already holds and any repeat, and stops at 30 (`EDITION.moreMax`); a missing or bad `more` is an empty list and never costs the edition. A missing or bad label never costs the row. The row stays, its line shows where the label would be, and the log says why the label was left off. A day with no usable edition shows its plain headlines instead: up to 5, in the usual order, no more than 2 from one category, no jokes, no rank numbers and no closest call. The first two editions (Nov 16 and Nov 17, 2026) were written by hand.

## Run it on your computer

Node 22 or newer.

```
npm ci
npm run update     # reads the live feeds and writes data/
npm run edit       # writes today's edition (needs ANTHROPIC_API_KEY, else says so and stops)
npm run build      # writes dist/
npm run serve      # http://127.0.0.1:8787/
npm test           # offline, no network
```

`npm run serve` also serves the same files under `http://127.0.0.1:8787/didtheworldendtoday/`. Every link on the site is relative, so both addresses work. `PORT` and `HOST` change where it listens. `SITE_URL` changes the address used in share images, the feed and the sitemap (the default is `https://didtheworldendtoday.com`).

The fonts are committed in `assets/fonts/`: League Gothic and Libre Franklin, both under the SIL Open Font License. The license texts sit next to them and the build copies them into `dist/assets/` beside the web fonts. League Gothic is the Google Fonts release (`ofl/leaguegothic`), whose license reserves no font name, so a subset of it is allowed. The pages use four small woff2 subsets: League Gothic Regular (10.7 KB) and Libre Franklin in 400, 600 and 700 (about 16.8 KB each). They keep the Latin letters, numbers and punctuation, Latin Extended-A (U+0100 to U+017F) and the comma-below letters (U+0218 to U+021B), so names like Doncic with its accents, Erdogan, Lodz and Brasov draw. The share image is drawn by resvg from three TTF files: League Gothic Regular, Libre Franklin SemiBold and Libre Franklin Bold. The build never downloads anything. Until League Gothic loads, a stand-in made from the phone's own Arial Bold, cut to the width of League Gothic, holds ALMOST. inside the screen, so no page scrolls sideways at 320 pixels wide.

## The look

A safety sign: yellow (`#FFD100`) and black (`#000000`), and one red (`#D81E05`) in two places only, the Doom Score number on the board and the number 1 of the day's closest call. There is no grey, no orange and no cream. League Gothic sets the big type (the question, ALMOST., the numbers and the line over the rows) and Libre Franklin sets everything else, in 400, 600 and 700. Nothing has a rounded corner. The colors live in `scripts/templates/palette.mjs`. Quiet mode is white and black with no red, no yellow and no emoji.

The first screen, top to bottom: a black band with the question, ALMOST. as one huge button (tap it to check again), a joke that points down at the list, and the Doom Score on a black board with the number, ten squares (one solid square for each ten points) and the scale in small print. The joke is one of 100 in `scripts/templates/quips.mjs`. Every visit shows one the visitor has not seen yet, and a tap on ALMOST. shows the next, so all 100 come up before any repeats. The page carries the joke picked from the date for a visitor with no JavaScript and for search crawlers, and one small inline script swaps in the next one from a shuffled bag the browser keeps. The page policy allows that one script by its hash, which the build works out from the script itself. Quiet mode has no jokes: the line there stays "Not a day for jokes. Back soon." The day's headline is not on the first screen any more, but it is still in the share card, in the feed of earlier days, in the almanac and in the description of the day's page. Then today's near misses: the first five show, and one See more holds the rest of them and then a small "More from today" heading over the day's other headlines (the ones that are not near misses): the editor's picks first, in its order, all showing, and then the rest behind "Show N more headlines". A day with no picks shows ten headlines first, as before. The See more says how many it opens, like "See 87 more", "See 3 more near misses" or "See 84 more headlines". A row is its rank, its emoji, the label, the line and the news site, and the whole row is one link to the story. One black Share today button follows, under all of it. Earlier days come next: yesterday's rows show, and the days before it fold theirs behind a button; any list of more than five rows shows five and keeps the rest behind its own See more. A day page does the same for its near misses and keeps every headline in its own list further down. A very busy day gives up its earlier days and then its lowest headlines to keep the page under 100 KB. A day with no edition has no rank numbers and nothing red but the score. The footer says when the site last checked, links to every headline of today, and credits [@thelpdrive](https://x.com/thelpdrive).

Sharing works like a word game. The share text is the question and ALMOST., the emoji of the day's first five rows in rank order, the Doom Score with ten squares (black for the score, yellow for what is left), and the address of the day. A past day asks about its own date. Quiet mode keeps its own plainer text.

The share image shows the first sentence of the day's headline, so the first sentence has to make sense on its own. A card is 1200 by 630: a black band with the question, ALMOST. in black on yellow, the Doom Score on a black board, that sentence, and the address.

## Quiet mode

When something terrible is dominating the news, the site drops the jokes and says "Not a day for jokes. Back soon."

To turn it on by hand, open `quiet.json` in the GitHub app, change `false` to `true`, optionally add a short `note`, and commit. Within 15 minutes the site goes plain. Change it back the same way.

Only an explicit `false` turns quiet mode off. If `quiet.json` is unreadable (a stray comma from a phone, say), or the `quiet` setting is missing, misspelled, empty, or anything other than `true` or `false`, the site goes quiet and the run logs a warning that says why. It never guesses the other way. A missing file counts as off.

It also turns on by itself when 3 or more of the top 30 Google News headlines are about a mass-casualty event, or name a toll such as "12 dead", and then stays on for at least 6 hours. Separately, any story about a big quake, a flood, a fire or a storm that could hurt people gets a quiet card with no joke. The card also links to a charity, but only when something says people were hurt: a headline that reports harm to people or homes (damage, destroyed, homes, evacuated, displaced, injured, dead, killed, missing), or a USGS quake with a PAGER rating of yellow, orange or red or a tsunami flag. The link goes to the Red Cross for a place in the United States and to the international Red Cross and Red Crescent for a place in another country. A state or city names a US place; a bare "US" counts only when no other place is named; a region that other countries share (the Midwest, the Gulf Coast, the Northeast) names nothing, so a headline with only that gets no link. A warning, a forecast, a headline that says nobody was hurt (no damage, no injuries), an evacuation that has ended, or a quake that is only big gets the caption alone.

In quiet mode every day shows plain headlines and no jokes, the page is white and black with no red and no emoji, and the editor stays off.

## Turn on X

The site works without X. To add live posts from breaking-news accounts:

1. In the repository, open Settings, then Secrets and variables, then Actions.
2. Under Secrets, add a repository secret named `X_BEARER_TOKEN` with your X API bearer token.
3. Optional: under Variables, add `X_DAILY_BUDGET_USD` to cap daily spend. The default is 0.60.

X runs at most once an hour and skips the call when it could go over the daily cap. A post from the breaking-news accounts has to match one of the keywords in `X` in `scripts/config.mjs`. Every post from Downdetector (`X.everyPost`) always counts, with or without a keyword, and is filed as an internet outage. The token is never printed. Remove the secret and X is off again.

## Turn on the editor

The site builds without it, and every day shows plain headlines until it is on. To have Claude write each day's edition:

1. In the repository, open Settings, then Secrets and variables, then Actions.
2. Under Secrets, add a repository secret named `ANTHROPIC_API_KEY` with an Anthropic API key.

The key is visible to the "Write today's edition" step and no other. It is never printed. Remove the secret and the editor goes quiet again: it says so in one log line and exits 0. To try it on your computer, run `ANTHROPIC_API_KEY=... npm run edit`. It reads `data/` and writes only today's file in `data/editions/`.

## The custom domain

The deploy uses GitHub Actions, so the repository has no `CNAME` file and no `.nojekyll`. The domain is set in the repository's Settings, under Pages, as the custom domain `didtheworldendtoday.com`. Tick Enforce HTTPS once GitHub's certificate is ready.

At the registrar, point the domain at GitHub Pages with these records:

- Four A records for the apex (`didtheworldendtoday.com`): `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
- One CNAME record for `www`, pointing at your GitHub Pages host, which is your GitHub username followed by `.github.io`.

`SITE_URL` in the workflow is the domain used for absolute links. Change it there if the domain ever changes.

## What is in the box

- `scripts/update.mjs`: the data pipeline (`npm run update`)
- `scripts/editor.mjs`: the editor that writes today's edition (`npm run edit`)
- `scripts/lib/editions.mjs`: the one check for editions, the plain-headline fallback, and the used-ids rule
- `scripts/build.mjs` and `scripts/templates/`: the site builder (`npm run build`)
- `scripts/templates/quips.mjs`: the 100 jokes under ALMOST., the one picked from the date, and the small script that shows the next one
- `scripts/serve.mjs`: the local server (`npm run serve`)
- `scripts/config.mjs`: every query, keyword and number in one place, including the news sites we never publish (`EXCLUDE_SOURCES`) and one-off headlines to hide (`HIDE_TITLES`)
- `assets/`: the page script and the fonts (League Gothic and Libre Franklin, with their licenses)
- `data/`: what the pipeline and the editor save, committed by the bot
- `test/`: the offline tests
- `quiet.json`: the manual quiet switch
