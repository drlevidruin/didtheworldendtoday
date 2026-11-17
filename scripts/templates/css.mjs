// The stylesheet, inlined into every page for first paint. A safety sign for the planet: a black band
// with the question, ALMOST. in black on yellow, and the Doom Score on a black board. League Gothic
// for the big type, Libre Franklin for everything else. No other font loads.
//
// Colors: yellow, black and one red, and nothing grey. The red is used in two places only: the
// Doom Score number on the board (.bn) and the number 1 on the closest call (.row.best .rn). In quiet mode
// the page is white and there is no red and no yellow at all.
import { INK, RED, WHITE, YELLOW } from './palette.mjs';

// The stand-in for League Gothic while it loads, or if it never does. League Gothic is a narrow face; a
// system bold at 52% of its size has about the same width, so ALMOST. takes the same room and a page
// cannot grow wider than a phone while the font is on its way.
const FIT_FACE = `@font-face{font-family:"League Gothic Fit";src:local("Arial Bold"),local("Arial-BoldMT"),local("Helvetica Neue Bold"),local("HelveticaNeue-Bold"),local("Roboto Bold"),local("Roboto-Bold"),local("Liberation Sans Bold"),local("LiberationSans-Bold");font-weight:400;font-style:normal;size-adjust:52%}`;

function sheet({ quiet }) {
  // --bg the page, --ink text and rules, --on the text on black. In quiet mode the page is white, the text on
  // black is white, and the two red places are plain white and plain black.
  const bg = quiet ? WHITE : YELLOW;
  const on = quiet ? WHITE : YELLOW;
  const score = quiet ? WHITE : RED;
  const first = quiet ? INK : RED;
  return `
@font-face{font-family:"League Gothic";src:url(__ROOT__assets/leaguegothic.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Libre Franklin";src:url(__ROOT__assets/librefranklin-400.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Libre Franklin";src:url(__ROOT__assets/librefranklin-600.woff2) format("woff2");font-weight:600;font-style:normal;font-display:swap}
@font-face{font-family:"Libre Franklin";src:url(__ROOT__assets/librefranklin-700.woff2) format("woff2");font-weight:700;font-style:normal;font-display:swap}
${FIT_FACE}
:root{--bg:${bg};--ink:${INK};--on:${on};--disp:"League Gothic","League Gothic Fit",sans-serif;--text:"Libre Franklin","Helvetica Neue",Arial,sans-serif;color-scheme:light}
html[data-quiet="1"]{--bg:${WHITE};--on:${WHITE}}
html[data-quiet="1"] .bn{color:${WHITE}}
html[data-quiet="1"] .row.best:not(.quiet) .rn{color:${INK}}
html[data-quiet="1"] .em{display:none}
html[data-quiet="1"] #quip{display:none}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);color:var(--ink);font:400 16px/1.5 var(--text);-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth;overflow-x:hidden}
body{margin:0;min-height:100vh;overflow-x:hidden;overflow-x:clip}
h1,h2,h3,p,ul,ol,dl,dd,figure{margin:0}
ul,ol{padding:0;list-style:none}
a{color:inherit;text-decoration-color:var(--ink);text-underline-offset:.2em}
button{font:inherit;color:inherit}
[hidden]{display:none!important}
:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.band{display:flex;align-items:center;justify-content:center;height:56px;padding:0 20px;background:var(--ink);color:var(--on)}
.band .q{margin:0;font:400 26px/1 var(--disp);text-transform:uppercase;text-align:center;color:var(--on)}
a.band{text-decoration:none}
.band:focus-visible{outline-color:var(--on);outline-offset:-6px}

.hero{max-width:600px;margin:0 auto;padding:20px 20px 28px;text-align:center}
.vbox{position:relative;display:block;width:100%;margin:0;padding:0;border:0;background:none;appearance:none;-webkit-appearance:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.verdict{display:block;font:400 min(31vw,120px)/.8 var(--disp);white-space:normal;overflow-wrap:anywhere;color:var(--ink);transform-origin:50% 60%}
.check{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 4px;font:600 18px/1.3 var(--text);text-align:center;color:var(--ink)}
.is-checking .verdict{visibility:hidden}
.is-checking .check{display:flex}
.snap{animation:snap .12s ease-out}
.hero .note{max-width:330px;margin:12px auto 0;font:600 15px/1.4 var(--text);overflow-wrap:anywhere}
.deck{max-width:330px;margin:12px auto 0;font:700 22px/1.25 var(--text);min-height:2.5em;text-wrap:balance;overflow-wrap:anywhere;color:var(--ink)}
.board{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:16px;row-gap:6px;align-items:center;min-height:120px;margin-top:20px;padding:16px;background:var(--ink);color:var(--on);text-align:left}
.bl{grid-column:1/-1;grid-row:1;font:700 12px/1.2 var(--text);letter-spacing:.08em;text-transform:uppercase}
.bn{grid-column:1;grid-row:2;font:400 72px/.8 var(--disp);color:${score}}
.bm{grid-column:2;grid-row:2;display:block;min-width:0}
.sq{display:flex;gap:4px}
.sq span{display:block;flex:0 0 14px;width:14px;height:14px;border:2px solid var(--on)}
.sq .f{background:var(--on)}
.bt{display:block;margin-top:8px;font:400 13px/1.3 var(--text)}
.hero .stale{margin-top:12px;font:600 14px/1.4 var(--text)}

.btn{appearance:none;-webkit-appearance:none;display:flex;align-items:center;justify-content:center;width:100%;height:52px;margin-top:24px;padding:0 24px;border:0;border-radius:0;background:var(--ink);color:var(--on);font:700 18px/1 var(--text);cursor:pointer}
.btn:hover{background:var(--bg);color:var(--ink);box-shadow:inset 0 0 0 3px var(--ink)}

.wrap{width:100%;max-width:600px;margin:0 auto;padding:0 20px}
.day+.day{margin-top:48px;padding-top:20px;border-top:3px solid var(--ink)}
.sec{font:400 24px/1.1 var(--disp);text-transform:uppercase;text-wrap:balance;color:var(--ink)}
.dk{font:700 12px/1.2 var(--text);letter-spacing:.08em;text-transform:uppercase}
.dl{margin-top:4px;font:400 30px/1.05 var(--disp);text-transform:uppercase;color:var(--ink)}
.dl a{display:inline-flex;align-items:center;min-height:48px}
.dh{margin-top:8px;font:600 18px/1.3 var(--text);text-wrap:balance;overflow-wrap:anywhere;color:var(--ink)}
.ds{display:flex;align-items:center;gap:8px;margin-top:8px;font:700 14px/1.2 var(--text)}
.ds .sq{gap:3px}
.ds .sq span{flex:0 0 10px;width:10px;height:10px;border:2px solid var(--ink)}
.ds .sq .f{background:var(--ink)}
.ds+.rows,.ds+.dd{margin-top:20px}
.sec+.rows{margin-top:12px}

.rows{border-bottom:0}
.row{position:relative;display:flex;align-items:flex-start;gap:8px;min-height:48px;padding:16px 0;border-top:2px solid var(--ink)}
.rn{flex:0 0 32px;display:block;font:400 36px/1 var(--disp);color:var(--ink)}
.row.best:not(.quiet) .rn{color:${first}}
.em{flex:0 0 48px;display:block;font:400 40px/1 var(--text);text-align:center}
.rb{flex:1 1 0;min-width:0}
.card{display:block;color:inherit;text-decoration:none}
.card::after{content:"";position:absolute;inset:0}
.card:focus-visible{outline:none}
.card:focus-visible::after{outline:3px solid var(--ink);outline-offset:-3px}
.lb{display:block;font:700 18px/1.25 var(--text);color:var(--ink);overflow-wrap:break-word}
.row.plain .lb{font-size:16px}
.ln{display:block;margin-top:4px;font:400 15px/1.4 var(--text);color:var(--ink);overflow-wrap:break-word}
.src{display:block;margin-top:8px;font:400 14px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em;overflow-wrap:anywhere}
.cap{display:block;margin-top:8px;font:600 15px/1.4 var(--text);overflow-wrap:anywhere;color:var(--ink)}
.help{position:relative;z-index:1;display:inline-flex;align-items:center;min-height:48px;font:600 15px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em}
.xp{position:relative;z-index:1;display:inline-flex;align-items:center;min-width:48px;min-height:48px;font:400 14px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em;overflow-wrap:anywhere}
.df{margin-top:24px;display:flex;flex-direction:column;align-items:flex-start}
.df .btn{margin-top:0}
.follow{display:inline-flex;align-items:center;min-height:48px;margin-top:8px;font:600 16px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em;text-wrap:balance}
.empty{padding:16px 0;font:600 16px/1.4 var(--text)}
.end{margin-top:48px;font:600 16px/1.4 var(--text)}
.end a{display:inline-flex;align-items:center;min-height:48px;color:var(--ink);text-decoration:underline;text-underline-offset:.2em}

.dd summary,.more summary{display:flex;align-items:center;min-height:48px;padding:0 16px;border:2px solid var(--ink);color:var(--ink);font:700 16px/1.2 var(--text);list-style:none;cursor:pointer}
.dd summary::-webkit-details-marker,.more summary::-webkit-details-marker{display:none}
.dd summary:hover,.more summary:hover{background:var(--ink);color:var(--on)}
.dd .rows{margin-top:12px}

#all{margin-top:48px;padding-top:20px;border-top:3px solid var(--ink)}
.heads{margin-top:12px}
.hd{position:relative;border-top:2px solid var(--ink)}
.hla{display:block;min-height:48px;padding:16px 0;color:inherit;text-decoration:none}
.hla::after{content:"";position:absolute;inset:0}
.hla:focus-visible{outline:none}
.hla:focus-visible::after{outline:3px solid var(--ink);outline-offset:-3px}
.ht{display:block;font:700 16px/1.3 var(--text);color:var(--ink);overflow-wrap:break-word}
.hs{display:block;margin-top:8px;font:400 14px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em;overflow-wrap:anywhere}
.hd.quiet .hla{padding-bottom:0}
.hd .cap{margin-top:8px}
.hd .help{margin-bottom:8px}
.hd .cap:last-child{margin-bottom:16px}
.more{margin-top:12px}
.more .rows,.more .heads{margin-top:12px}
.sub{margin-top:24px;font:400 20px/1.1 var(--disp);text-transform:uppercase;color:var(--ink)}
.dnav{margin-top:32px;display:flex;justify-content:space-between;gap:16px}
.dnav a{display:inline-flex;align-items:center;min-height:48px;font:600 16px/1.4 var(--text);color:var(--ink);text-decoration:underline;text-underline-offset:.2em}

.pg{margin:28px 0 16px;font:400 clamp(44px,12vw,64px)/.95 var(--disp);text-transform:uppercase;overflow-wrap:anywhere}
.lead{margin:0 0 16px;font:600 18px/1.4 var(--text)}
.record{margin:0 0 16px;font:700 14px/1.4 var(--text)}
.alm{margin-top:16px}
.alm li{border-top:2px solid var(--ink)}
.al{display:block;min-height:48px;padding:16px 0;text-decoration:none}
.ad{display:block;font:700 14px/1.4 var(--text)}
.ah{display:block;margin-top:4px;font:600 18px/1.3 var(--text);text-wrap:balance;overflow-wrap:anywhere;color:var(--ink)}
.al:hover .ah{text-decoration:underline;text-underline-offset:.2em}
.prose{max-width:560px;padding-bottom:16px;overflow-wrap:break-word}
.prose h2{margin:40px 0 12px;font:400 24px/1.1 var(--disp);text-transform:uppercase;color:var(--ink)}
.prose p{margin:0 0 16px;font-size:17px;line-height:1.55}
.prose ul{margin:0 0 16px;padding-left:20px;list-style:disc}
.prose li{margin:8px 0;padding-left:2px;font-size:17px;line-height:1.55}
.prose .lede{font:600 20px/1.35 var(--text)}
.prose .scope{font-weight:700}

footer{width:calc(100% - 40px);max-width:560px;margin:48px auto 0;padding:16px 0 48px;border-top:3px solid var(--ink);font:400 14px/1.6 var(--text)}
footer p{margin:0}
footer .up{font-weight:700}
footer .all{margin-top:4px}
footer .all a{display:inline-flex;align-items:center;min-height:48px;font-weight:700;text-decoration:underline;text-underline-offset:.2em}
footer .fl{display:flex;flex-wrap:wrap;column-gap:20px}
footer .fl a{display:inline-flex;align-items:center;min-height:48px;font-weight:600;text-decoration:underline;text-underline-offset:.2em}
footer .tagline{margin-top:12px;font-weight:700}

.toast{position:fixed;left:50%;bottom:24px;z-index:9;transform:translate(-50%,8px);max-width:calc(100% - 32px);padding:12px 18px;background:var(--ink);color:var(--on);font:600 15px/1.3 var(--text);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
.toast.on{opacity:1;transform:translate(-50%,0)}
.fresh{position:fixed;left:0;right:0;bottom:0;z-index:8;display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));border:0;background:var(--ink);color:var(--on);font:700 16px/1.2 var(--text);cursor:pointer}

@keyframes snap{from{transform:scale(1.08)}to{transform:scale(1)}}
@media (max-width:339px){
.sq{gap:3px}
.bn{font-size:64px}
}
@media (prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
.snap{animation:none}
.toast{transition:none}
}
`;
}

// Whitespace only: no rewriting of values, so nothing can change meaning.
function squeeze(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('')
    .replace(/\s*([{};])\s*/g, '$1');
}

// quiet: the site is in quiet mode when the page is built, so the red and the yellow are never in the
// sheet at all. A page that turns quiet while it is open gets the same result from html[data-quiet="1"].
export function css(root, { quiet = false } = {}) {
  return squeeze(sheet({ quiet }).replace(/__ROOT__/g, root));
}

// The 404 page is served at any depth, so it carries its own small style and reaches
// the two fonts by the site's address instead of a relative path.
export function css404(siteUrl) {
  return squeeze(`
@font-face{font-family:"League Gothic";src:url(${siteUrl}/assets/leaguegothic.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Libre Franklin";src:url(${siteUrl}/assets/librefranklin-700.woff2) format("woff2");font-weight:700;font-style:normal;font-display:swap}
${FIT_FACE}
:root{color-scheme:light}
html{background:${YELLOW};color:${INK};font:700 18px/1.5 "Libre Franklin","Helvetica Neue",Arial,sans-serif;overflow-x:hidden}
body{box-sizing:border-box;margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px 20px}
h1{margin:0;font:400 clamp(44px,12vw,80px)/.95 "League Gothic","League Gothic Fit",sans-serif;text-transform:uppercase;overflow-wrap:anywhere}
p{margin:28px 0 0}
a{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border:0;background:${INK};color:${YELLOW};text-decoration:none}
a:hover{background:${YELLOW};color:${INK};box-shadow:inset 0 0 0 3px ${INK}}
a:focus-visible{outline:3px solid ${INK};outline-offset:3px}
`);
}
