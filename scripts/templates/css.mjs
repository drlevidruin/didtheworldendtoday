// The stylesheet, inlined into every page for first paint. Near-black ground,
// bone-white text, one accent (warning orange) for the big button, the Doom
// Score and the closest-call tag. Anton for ALMOST., the day headlines and the
// day labels, system-ui for everything else. No other font loads.
import { HEADLINE_BUCKETS } from './copy.mjs';

const SHEET = `
@font-face{font-family:Anton;src:url(__ROOT__assets/anton.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}
:root{--bg:#0B0B0F;--ink:#F2EFE8;--hot:#FF6A00;--mute:#9A9AA3;--dim:#7A7A84;--line:#24242C;--panel:#15151B;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--disp:Anton,Impact,"Arial Narrow Bold",sans-serif;--emoji:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;min-height:100vh}
h1,h2,h3,p,ul,ol,dl,dd,figure{margin:0}
ul,ol{padding:0;list-style:none}
a{color:inherit;text-decoration-color:var(--dim);text-underline-offset:.2em}
a:hover{text-decoration-color:var(--ink)}
button{font:inherit;color:inherit}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--hot);outline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.hero{display:flex;flex-direction:column;align-items:center;max-width:44rem;margin:0 auto;padding:1.25rem 1rem 1.5rem;text-align:center}
.ask{display:flex;flex-direction:column;align-items:center;font:inherit;max-width:100%}
.q{font:600 clamp(.95rem,4.2vw,1.4rem)/1.25 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--mute);text-wrap:balance}
.vbox{position:relative;display:block;max-width:100%;margin:0;padding:0;border:0;background:none;appearance:none;-webkit-appearance:none;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.verdict{display:block;font:400 min(28vw,30vh,11rem)/1 var(--disp);letter-spacing:.005em;white-space:nowrap;margin-top:.08em;transform-origin:50% 60%}
.check{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 .25rem;font:500 clamp(.95rem,4.6vw,1.3rem)/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;color:var(--ink);letter-spacing:0;text-transform:none}
.is-checking .verdict{visibility:hidden}
.is-checking .check{display:flex}
.snap{animation:snap .12s ease-out}
.hl,.dh{font-family:var(--disp);font-weight:400;font-size:min(var(--cap),calc(var(--w) * 4.1 / var(--n,60)));line-height:1.14;letter-spacing:.008em;text-wrap:balance;color:var(--ink)}
.hl{--w:min(100vw - 2rem,42rem);--cap:1.625rem;margin-top:.85rem;max-width:100%}
.dh{--w:min(100vw - 2.5rem,41.5rem);--cap:1.5rem;margin-top:.65rem}
.doom{margin-top:.95rem;display:flex;flex-direction:column;align-items:center;gap:.25rem;font:600 .95rem/1.25 var(--sans)}
.doom .pts{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.25rem .5rem}
.doom .n{font-weight:800;color:var(--hot)}
.doom .sep,.doom .upd,.doom .when{color:var(--mute);font-weight:500}
.doom .upd{font-size:.85rem}
.doom .wide{display:none}
.dot{flex:none;width:.6rem;height:.6rem;border-radius:50%;background:var(--hot);animation:pulse 2s ease-out infinite}
.meter{display:block;appearance:none;-webkit-appearance:none;width:min(15rem,62vw);height:.3rem;margin:.75rem auto 0;border:0;border-radius:99px;overflow:hidden;background:var(--line);color:var(--hot)}
.meter::-webkit-progress-bar{background:var(--line)}
.meter::-webkit-progress-value{background:var(--hot);border-radius:99px}
.meter::-moz-progress-bar{background:var(--hot);border-radius:99px}
.scale{margin-top:.5rem;color:var(--mute);font-size:.85rem}
.hero .note,.hero .stale{margin-top:.8rem;font-size:.95rem}
.hero .note{color:var(--mute)}
.hero .stale{color:var(--ink);font-weight:600}
.go{display:flex;align-items:center;justify-content:center;width:100%;max-width:26rem;min-height:3.5rem;margin-top:1.15rem;padding:0 1.25rem;border-radius:.9rem;background:var(--hot);color:#000;font:800 1.1rem/1.1 var(--sans);letter-spacing:.005em;text-align:center;text-decoration:none}
.go:hover{background:#FF8230}
.go:focus-visible{outline-color:var(--ink)}
.sh{appearance:none;-webkit-appearance:none;display:flex;align-items:center;justify-content:center;width:100%;max-width:26rem;min-height:3rem;margin-top:.65rem;padding:0 1.25rem;border:1px solid #6A6A74;border-radius:99px;background:none;color:var(--ink);font:700 1rem/1.1 var(--sans);cursor:pointer}
.sh:hover{border-color:var(--ink)}
.mast{margin-top:.8rem;color:var(--mute);font-size:.8rem}
.btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:3rem;padding:0 1.3rem;border:1px solid #6A6A74;border-radius:99px;background:none;color:var(--ink);font:600 .95rem/1 var(--sans);letter-spacing:.02em;text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--ink)}

.wrap{width:100%;max-width:44rem;margin:0 auto;padding:0 1rem}
.day{margin-top:2.4rem}
.hero+.wrap>.day:first-child{margin-top:1.1rem}
.dl{font:400 1.375rem/1.1 var(--disp);letter-spacing:.05em;text-transform:uppercase;color:var(--mute)}
.dl .hot{color:var(--hot)}
.ds,.rank{margin-top:.35rem;color:var(--mute);font-size:.9rem}
.rows{display:grid;gap:.7rem;margin-top:.9rem}
.row{position:relative;display:grid;grid-template-columns:2.6rem minmax(0,1fr);gap:.7rem;align-items:start;padding:1rem .8rem 1.05rem;background:var(--panel);border:1px solid var(--line);border-radius:1.1rem}
.row.best{border-color:#5A2E10}
.rk{display:flex;flex-direction:column;align-items:center;gap:.3rem}
.rn{font:400 2.6rem/1 var(--disp);color:var(--mute)}
.row.best .rn{color:var(--hot)}
.em{display:block;font:2rem/1.15 var(--emoji);text-align:center}
.rb{min-width:0}
.tag{display:inline-block;margin-bottom:.5rem;padding:.2rem .5rem;border:1px solid var(--hot);border-radius:99px;color:var(--hot);font:800 .75rem/1.2 var(--sans);letter-spacing:.14em}
.card{display:block;color:inherit;text-decoration:none}
.card::after{content:"";position:absolute;inset:0;border-radius:inherit}
.txt{display:block;font:600 1.1875rem/1.4 var(--sans);color:var(--ink);overflow-wrap:break-word}
.bar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;min-height:3rem;margin-top:.8rem;padding:.6rem .9rem;border-radius:.75rem;background:#2A2A33;color:var(--ink);font:600 .95rem/1.25 var(--sans)}
.src{min-width:0}
.sn{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;color:var(--ink);font-weight:700}
.sc{display:block;font-size:.8rem;font-weight:500;color:var(--mute)}
.cta{flex:none;font-weight:800}
.row:hover .bar{background:#34343E}
.row:hover .sc{color:#A3A3AC}
.card:focus-visible{outline:none}
.card:focus-visible .bar{outline:2px solid var(--hot);outline-offset:2px}
.cap{display:block;margin-top:.6rem;color:var(--mute);font-size:.9rem;font-style:italic}
.help{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;min-height:3rem;margin-top:.6rem;padding:.6rem .9rem;border:1px solid #6A6A74;border-radius:.75rem;color:var(--ink);font:600 .95rem/1.25 var(--sans);text-align:center;text-decoration:none}
.help:hover{border-color:var(--ink)}
.df{margin-top:.85rem;display:flex;flex-direction:column;align-items:flex-start;gap:.8rem}
.plus{display:inline-flex;align-items:center;min-height:3rem;padding:.5rem 1.2rem;border:1px solid #6A6A74;border-radius:1.5rem;color:var(--ink);font:600 .95rem/1.3 var(--sans);text-decoration:none}
.plus:hover{border-color:var(--ink)}
.follow{display:inline-flex;align-items:center;min-height:3rem;font:600 .95rem/1.3 var(--sans);color:var(--ink)}
.empty{padding:1.25rem 0;color:var(--mute)}
.end{margin-top:3rem;text-align:center;color:var(--mute)}
.end a{display:inline-flex;align-items:center;min-height:3rem;margin-top:.4rem;padding:0 .4rem;font-weight:700;color:var(--ink)}

.sec{font:700 .75rem/1.2 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mute);padding-bottom:.8rem;border-bottom:1px solid var(--line);text-wrap:balance}
#all{margin-top:3rem}
.hd{position:relative;padding:.3rem 0;border-bottom:1px solid var(--line)}
.hla{display:block;min-height:3rem;padding:.65rem 0;color:inherit;text-decoration:none}
.hla::after{content:"";position:absolute;inset:0}
.ht{display:block;font:600 1.05rem/1.35 var(--sans)}
.hd:hover .ht{text-decoration:underline;text-decoration-color:var(--dim)}
.hs{display:block;margin-top:.25rem;color:var(--mute);font-size:.9rem}
.hd .cap{margin-top:.1rem}
.hd .cap:last-child{margin-bottom:.7rem}
.hd .help{margin-bottom:.65rem}
.more{margin-top:1rem}
.more summary{display:flex;align-items:center;justify-content:center;max-width:26rem;min-height:3rem;margin:0 auto;padding:0 1.3rem;border:1px solid #6A6A74;border-radius:99px;color:var(--ink);font:600 .95rem/1 var(--sans);list-style:none;cursor:pointer}
.more summary::-webkit-details-marker{display:none}
.more summary:hover{border-color:var(--ink)}
.more .heads{margin-top:.5rem}
.dnav{margin-top:2.25rem;display:flex;justify-content:space-between;gap:1rem}
.dnav a{display:inline-flex;align-items:center;min-height:3rem;padding:0 1.1rem;border:1px solid #6A6A74;border-radius:99px;color:var(--ink);font:600 .95rem/1 var(--sans);text-decoration:none}
.dnav a:hover{border-color:var(--ink)}

.lead{margin:-.6rem 0 1rem;color:var(--mute);font-size:1.05rem}
.record{margin-top:1.5rem;color:var(--mute);font-size:.95rem}
.pg+.record,.lead+.record{margin:-.2rem 0 1.25rem}
.alm li{border-bottom:1px solid var(--line)}
.al{display:block;padding:1rem 0;text-decoration:none}
.ad{display:block;font:600 .85rem/1.3 var(--sans);color:var(--mute)}
.ah{display:block;margin-top:.3rem;font:400 1.35rem/1.15 var(--disp);letter-spacing:.008em;color:var(--ink)}
.al:hover .ah{text-decoration:underline;text-decoration-color:var(--dim)}

.top{display:flex;align-items:center;justify-content:space-between;padding:.5rem 0 0}
.top a{display:inline-flex;align-items:center;min-height:3rem;font:700 .75rem/1.2 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--mute);text-decoration:none}
.top a:hover{color:var(--ink)}
.pg{margin:2.25rem 0 1.5rem;font:400 clamp(2.8rem,13vw,5.5rem)/1 var(--disp);letter-spacing:.005em;text-transform:uppercase}
.prose{max-width:38rem;padding-bottom:1rem}
.prose h2{margin:2.5rem 0 .8rem;font:700 .75rem/1.2 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mute)}
.prose p{margin:0 0 1rem}
.prose ul{margin:0 0 1rem;padding-left:1.15rem;list-style:disc}
.prose li{margin:.45rem 0;padding-left:.15rem}
.prose li::marker{color:var(--dim)}
.prose .lede{font:600 1.25rem/1.4 var(--sans)}
.prose .scope{font-weight:700}

footer{margin-top:4rem;padding:2rem 1.25rem 3rem;border-top:1px solid var(--line);text-align:center;color:var(--mute);font-size:.9rem;line-height:1.75}
footer p{margin:0;text-wrap:balance}
footer .tagline{margin:0 0 .5rem;color:var(--ink);font:600 .9rem/1.5 var(--sans)}
footer .by{margin-top:.9rem}
footer .by a{display:inline-block;padding:.9rem .4rem;margin:-.9rem -.4rem;color:var(--ink);font-weight:600;text-decoration:none}
footer .by a:hover{text-decoration:underline}

.toast{position:fixed;left:50%;bottom:1.5rem;z-index:9;transform:translate(-50%,.5rem);max-width:calc(100% - 2rem);padding:.7rem 1.1rem;border-radius:99px;background:var(--ink);color:var(--bg);font:700 .9rem/1.2 var(--sans);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
.toast.on{opacity:1;transform:translate(-50%,0)}
.fresh{position:fixed;left:0;right:0;bottom:0;z-index:8;display:flex;align-items:center;justify-content:center;gap:.6rem;width:100%;min-height:3.25rem;padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom));border:0;background:var(--ink);color:var(--bg);font:700 .95rem/1.2 var(--sans);cursor:pointer}

@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,106,0,.65)}70%{box-shadow:0 0 0 .65rem rgba(255,106,0,0)}100%{box-shadow:0 0 0 0 rgba(255,106,0,0)}}
@keyframes snap{from{transform:scale(1.08)}to{transform:scale(1)}}
@media (min-width:34rem){
.doom{flex-direction:row;gap:.55rem}
.doom .upd{font-size:.95rem}
.doom .wide{display:inline}
.df{flex-direction:row;align-items:center;justify-content:space-between;gap:1rem}
}
@media (min-width:46rem){
.hl{--cap:2.25rem;margin-top:1rem}
.dh{--cap:1.9rem}
.doom{margin-top:1.15rem;font-size:1.05rem}
.doom .upd{font-size:1.05rem}
.meter{width:18rem;height:.35rem;margin-top:.9rem}
.go{margin-top:1.4rem}
.dl{font-size:1.6rem}
.row{grid-template-columns:3.5rem minmax(0,1fr);gap:1.1rem;padding:1.25rem 1.2rem 1.3rem}
.rn{font-size:3rem}
.em{font-size:2.4rem}
.txt{font-size:1.3rem}
.ht{font-size:1.15rem}
}
@media (prefers-reduced-motion:reduce){
html{scroll-behavior:auto}
.dot{animation:none}
.snap{animation:none}
.toast{transition:none}
}
`;

// One class per headline length: the longer the headline, the smaller the type,
// so it takes two lines at most. Built here so the list cannot drift from the
// classes copy.mjs hands out.
function fitClasses() {
  const { from, to, step } = HEADLINE_BUCKETS;
  const out = [];
  for (let n = from; n <= to; n += step) out.push(`.n${n}{--n:${n}}`);
  return out.join('\n');
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

export function css(root) {
  return squeeze(`${SHEET}\n${fitClasses()}`.replace(/__ROOT__/g, root));
}

// The 404 page is served at any depth, so it carries its own tiny style and
// uses system fonts only. It is the one page allowed to.
export const CSS_404 = squeeze(`
:root{color-scheme:dark}
html{background:#0B0B0F;color:#F2EFE8;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
body{box-sizing:border-box;margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem 1.25rem}
h1{margin:0;font:400 clamp(2.6rem,12vw,5rem)/1.02 Impact,"Arial Narrow Bold","Haettenschweiler",sans-serif;text-transform:uppercase;letter-spacing:.01em}
p{margin:1.75rem 0 0}
a{display:inline-flex;align-items:center;min-height:3rem;padding:0 1.3rem;border:1px solid #6A6A74;border-radius:99px;color:#F2EFE8;font-weight:600;text-decoration:none}
a:hover{border-color:#F2EFE8}
a:focus-visible{outline:2px solid #FF6A00;outline-offset:3px}
`);
