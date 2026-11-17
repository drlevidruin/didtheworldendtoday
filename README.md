# Did the world end today?

A one-page site that checks the news every 15 minutes and keeps saying ALMOST. It shows the day's near misses, a Doom Score from 0 to 99, and an archive of every day, the Almanac of Almost. Made by [@thelpdrive](https://x.com/thelpdrive).

## How it works

Every 15 minutes a GitHub Action reads the feeds, saves what it found as plain JSON in `data/`, builds the whole site into `dist/`, and publishes it to GitHub Pages. There is no server and no database. The pages are static files. A small script in the page checks for newer data and offers a refresh.

### Where it reads

- Google News and Bing News: headlines for 12 categories (flights, hacks, internet, space, sun, earth, markets, AI, grid, germs, weather, animals)
- GDELT: a bonus set of headlines, when it answers
- Hacker News: tech outages and breaches
- USGS: earthquakes
- NOAA Space Weather Prediction Center: Kp index and solar alerts
- NASA/JPL: asteroid close approaches
- FAA: ground stops
- Status pages of big services: "is the internet down"
- X: only when turned on (see below)

Headlines are stored as published, escaped when a page is built, and linked only if the link is http or https.

### Before the first push

Set up Pages first. In the repository's Settings, open Pages and set Source to **GitHub Actions**. The workflow deploys through it, so the first run fails until this is set.

### When it runs

`.github/workflows/update.yml` runs at minutes 4, 19, 34 and 49 of every hour (not on the hour, when GitHub is busiest) and on every push to `main`. Each run installs, updates the data, builds, runs the tests, commits the data if it changed, and deploys.

### The Doom Score

A category fires when 3 or more different publishers have a headline in it within 24 hours, or when its instrument trips. Each fired category is worth 6 points. The floor is 11, because there is always something. The cap is 99, because it is never 100. Instruments add points on top: an FAA ground stop, an asteroid inside 1 lunar distance, a strong geomagnetic storm, a big quake, a big status page in major outage. The exact numbers live in `DOOM` in `scripts/config.mjs` and are printed on the About page, which reads them from the same place.

Today's score and stories are the last 24 hours, the same as the homepage, and each run saves that view as today's file in `data/days/`. When the Eastern date changes, that day's last file is its final edition. It is never rewritten, so the Almanac scores never move, and "yesterday" always means yesterday's final score.

## Run it on your computer

Node 22 or newer.

```
npm ci
npm run update     # reads the live feeds and writes data/
npm run build      # writes dist/
npm run serve      # http://127.0.0.1:8787/
npm test           # offline, no network
```

`npm run serve` also serves the same files under `http://127.0.0.1:8787/didtheworldendtoday/`. Every link on the site is relative, so both addresses work. `PORT` and `HOST` change where it listens. `SITE_URL` changes the address used in share images, the feed and the sitemap (the default is `https://didtheworldendtoday.com`).

The fonts are committed in `assets/fonts/` (Anton, SIL Open Font License). The build never downloads anything.

## Quiet mode

When something terrible is dominating the news, the site drops the jokes and says "Not a day for jokes. Back soon."

To turn it on by hand, open `quiet.json` in the GitHub app, change `false` to `true`, optionally add a short `note`, and commit. Within 15 minutes the site goes plain. Change it back the same way.

Only an explicit `false` turns quiet mode off. If `quiet.json` is unreadable (a stray comma from a phone, say), or the `quiet` setting is missing, misspelled, empty, or anything other than `true` or `false`, the site goes quiet and the run logs a warning that says why. It never guesses the other way. A missing file counts as off.

It also turns on by itself when 3 or more of the top 30 Google News headlines are about a mass-casualty event, or name a toll such as "12 dead", and then stays on for at least 6 hours. Separately, any story about a big quake, a flood, a fire or a storm that could hurt people gets a quiet card with no joke. When people are likely hurt it also links to the Red Cross (the international Red Cross and Red Crescent for a quake abroad); a quake that is only big gets the caption alone.

Even on an ordinary day, a joke goes only on a near miss. A story gets its category's joke when its headline holds one of that category's near-miss words, such as an outage, a glitch, a delay, a hack, a breach, a market plunge, an asteroid, a solar flare or a blackout. Any other story that passes the filters is listed with no caption at all. The words are the `nearMiss` lists in `scripts/config.mjs`.

## Turn on X

The site works without X. To add live posts from breaking-news accounts:

1. In the repository, open Settings, then Secrets and variables, then Actions.
2. Under Secrets, add a repository secret named `X_BEARER_TOKEN` with your X API bearer token.
3. Optional: under Variables, add `X_DAILY_BUDGET_USD` to cap daily spend. The default is 0.50.

X runs at most once an hour and skips the call when it could go over the daily cap. The token is never printed. Remove the secret and X is off again.

## The custom domain

The deploy uses GitHub Actions, so the repository has no `CNAME` file and no `.nojekyll`. The domain is set in the repository's Settings, under Pages, as the custom domain `didtheworldendtoday.com`. Tick Enforce HTTPS once GitHub's certificate is ready.

At the registrar, point the domain at GitHub Pages with these records:

- Four A records for the apex (`didtheworldendtoday.com`): `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and `185.199.111.153`.
- One CNAME record for `www`, pointing at your GitHub Pages host, which is your GitHub username followed by `.github.io`.

`SITE_URL` in the workflow is the domain used for absolute links. Change it there if the domain ever changes.

## What is in the box

- `scripts/update.mjs`: the data pipeline (`npm run update`)
- `scripts/build.mjs` and `scripts/templates/`: the site builder (`npm run build`)
- `scripts/serve.mjs`: the local server (`npm run serve`)
- `scripts/config.mjs`: every query, keyword, caption and number in one place
- `assets/`: the page script and the fonts
- `data/`: what the pipeline saves, committed by the bot
- `test/`: the offline tests
- `quiet.json`: the manual quiet switch
