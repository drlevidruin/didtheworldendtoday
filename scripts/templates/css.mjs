// The stylesheet, inlined into every page for first paint. Near-black ground,
// bone-white text, one accent (warning orange) for the score, the fired grid
// cells and the pulse dot. Anton for ALMOST. and the numbers, system-ui for
// everything else, ui-monospace for the vital signs. No other font loads.

const SHEET = `
@font-face{font-family:Anton;src:url(__ROOT__assets/anton.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap}
:root{--bg:#0B0B0F;--ink:#F2EFE8;--hot:#FF6A00;--mute:#9A9AA3;--dim:#7A7A84;--line:#24242C;--panel:#111116;--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--disp:Anton,Impact,"Arial Narrow Bold",sans-serif;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh}
h1,h2,h3,p,ul,ol,dl,dd,figure{margin:0}
ul,ol{padding:0;list-style:none}
a{color:inherit;text-decoration-color:var(--dim);text-underline-offset:.2em}
a:hover{text-decoration-color:var(--ink)}
button{font:inherit;color:inherit}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--hot);outline-offset:3px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.hero{min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:1.5rem 1rem 3.5rem}
.ask{display:flex;flex-direction:column;align-items:center;font:inherit;max-width:100%}
.q{font:600 clamp(.95rem,4.2vw,1.4rem)/1.2 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--mute)}
.vbox{position:relative;display:block;max-width:100%}
.verdict{display:block;font:400 min(28vw,30vh)/1 var(--disp);letter-spacing:.005em;white-space:nowrap;margin-top:.08em;transform-origin:50% 60%}
.check{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:0 .25rem;font:500 clamp(.95rem,4.6vw,1.3rem)/1.3 var(--mono);text-align:center;color:var(--ink);letter-spacing:0;text-transform:none}
.is-checking .verdict{visibility:hidden}
.is-checking .check{display:flex}
.snap{animation:snap .12s ease-out}
.hero .line{margin-top:.9rem;max-width:100%;font:800 clamp(1.2rem,5.6vw,1.9rem)/1.15 var(--sans);letter-spacing:-.01em;text-wrap:balance}
.doom{margin-top:1.15rem;display:flex;flex-direction:column;align-items:center;gap:.45rem;font:600 1rem/1.2 var(--sans)}
.doom .pts{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.3rem .55rem}
.doom .n{font:400 1.9rem/1 var(--disp);color:var(--hot);letter-spacing:.01em}
.doom .chg{font-weight:700}
.doom .sep,.doom .ago,.doom .when{color:var(--mute);font-weight:500}
.doom .ago{font-size:.85rem}
.doom .wide{display:none}
.dot{flex:none;width:.6rem;height:.6rem;border-radius:50%;background:var(--hot);animation:pulse 2s ease-out infinite}
.meter{display:block;appearance:none;-webkit-appearance:none;width:min(15rem,62vw);height:.3rem;margin:.85rem auto 0;border:0;border-radius:99px;overflow:hidden;background:var(--line);color:var(--hot)}
.meter::-webkit-progress-bar{background:var(--line)}
.meter::-webkit-progress-value{background:var(--hot);border-radius:99px}
.meter::-moz-progress-bar{background:var(--hot);border-radius:99px}
.btns{margin-top:1.6rem;display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap}
.btn{appearance:none;-webkit-appearance:none;display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:0 1.3rem;border:1px solid #3B3B45;border-radius:99px;background:none;color:var(--ink);font:600 .95rem/1 var(--sans);letter-spacing:.02em;text-decoration:none;cursor:pointer}
.btn:hover{border-color:var(--ink)}
.btn[disabled]{opacity:.45;cursor:default}

.wrap{width:100%;max-width:44rem;margin:0 auto;padding:0 1.25rem}
.sub{padding:2.75rem 0 .5rem;text-align:center}
.sub .tag{color:var(--mute);font-size:.95rem}
.sub .stale,.sub .streak{margin-top:.8rem;font-size:.95rem}
.sub .stale{color:var(--ink);font-weight:600}
.sub .note{margin-top:.5rem;color:var(--mute)}
.streak,.record{color:var(--mute)}
.record{margin-top:1.5rem;font-size:.95rem}
.pg+.record{margin:-.6rem 0 1.25rem;font-size:.95rem}

.wrap>section{margin-top:3.25rem}
.sec{font:700 .75rem/1.2 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--mute);padding-bottom:.8rem;border-bottom:1px solid var(--line)}
.cards{margin-top:0}
.card{padding:1.05rem 0 1.1rem;border-bottom:1px solid var(--line)}
.card .cat{font:600 .7rem/1.2 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
.card h3{margin:.4rem 0 .3rem;font:600 1.1rem/1.3 var(--sans);letter-spacing:-.005em}
.card h3 a{text-decoration:none}
.card h3 a:hover{text-decoration:underline;text-decoration-color:var(--dim)}
.card .meta{color:var(--mute);font-size:.85rem}
.card .cap{margin-top:.4rem;color:var(--mute);font-size:.9rem;font-style:italic}
.card .cap a{font-style:normal;color:var(--ink)}
.lead{padding:1.4rem 0 1.5rem}
.lead h3{margin:.55rem 0 .5rem;font:800 clamp(1.5rem,6.4vw,2.3rem)/1.15 var(--sans);letter-spacing:-.015em}
.lead .meta{font-size:.95rem}
.lead .cap{font-size:1rem}
.lead .cat{font-size:.78rem}

.chips{display:flex;gap:.5rem;overflow-x:auto;padding:1rem 0 .85rem;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;appearance:none;-webkit-appearance:none;border:1px solid #33333C;border-radius:99px;background:none;color:var(--ink);padding:.4rem .8rem;font:600 .8rem/1.2 var(--sans);white-space:nowrap;cursor:pointer}
.chip .e{margin-right:.3rem}
.chip small{margin-left:.3rem;font-size:inherit;font-weight:500;color:var(--mute)}
.chip[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip[aria-pressed="true"] small{color:var(--bg)}
.more>summary{list-style:none;cursor:pointer;margin-top:1.1rem;display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1.3rem;border:1px solid #3B3B45;border-radius:99px;font:600 .95rem/1 var(--sans)}
.more>summary::-webkit-details-marker{display:none}
.more>summary:hover{border-color:var(--ink)}
.more[open]>summary{margin-bottom:.25rem}
.empty{padding:1.25rem 0;color:var(--mute)}

.bingo{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin-top:1rem}
.cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.25rem;padding:.2rem;border-radius:.8rem;background:var(--panel);border:1px solid var(--line);font-size:1.75rem;line-height:1;text-align:center}
.cell small{font:600 .6rem/1.15 var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
.cell.on{background:var(--hot);border-color:var(--hot)}
.cell.on small{color:var(--bg)}
.cell.off span{opacity:.25;filter:grayscale(1)}
.math{margin-top:.9rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;color:var(--mute);font-size:.9rem}

.vit{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1rem}
.v{border:1px solid var(--line);border-radius:.8rem;padding:.85rem .9rem;font-family:var(--mono);min-width:0}
.v dt{font:600 .66rem/1.2 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--mute)}
.v dd{margin-top:.4rem;font-size:.9rem;line-height:1.35;overflow-wrap:anywhere}
.v .big{display:block;font-size:1.3rem;line-height:1.15;color:var(--ink)}
.v .sm{display:block;margin-top:.3rem;color:var(--mute);font-size:.75rem;line-height:1.35}
.v a{text-decoration-color:var(--dim)}

.alm li{display:grid;grid-template-columns:5.4rem 2.4rem 1fr;gap:.2rem .75rem;align-items:baseline;padding:.8rem 0;border-bottom:1px solid var(--line)}
.alm .d{font:600 .85rem/1.3 var(--sans);color:var(--mute);text-decoration:none}
.alm .d:hover{color:var(--ink);text-decoration:underline}
.alm .s{font:400 1.5rem/1 var(--disp);color:var(--hot)}
.alm .t{font-size:.95rem;line-height:1.35;min-width:0}
.alm .t a{text-decoration:none}
.alm .t a:hover{text-decoration:underline}
.alm .f{display:block;margin-top:.25rem;font-size:.8rem;letter-spacing:.12em}
.all{margin-top:1.1rem;display:inline-block;font-weight:600;font-size:.9rem}
.dnav{margin-top:2.75rem;display:flex;justify-content:space-between;gap:1rem;font-weight:600;font-size:.9rem}
.dnav a{text-decoration:none;color:var(--mute)}
.dnav a:hover{color:var(--ink);text-decoration:underline}

.top{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0 0}
.top a{font:700 .75rem/1.2 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--mute);text-decoration:none}
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

footer{margin-top:4.5rem;padding:2rem 1.25rem 3rem;border-top:1px solid var(--line);text-align:center;color:var(--mute);font-size:.82rem;line-height:1.75}
footer p{margin:0}
footer nav{margin-top:1.1rem;display:flex;gap:1.4rem;justify-content:center;font-weight:600;font-size:.85rem}
footer nav a{color:var(--ink);text-decoration:none}
footer nav a:hover{text-decoration:underline}
footer .by{margin-top:.6rem}

.toast{position:fixed;left:50%;bottom:1.5rem;z-index:9;transform:translate(-50%,.5rem);max-width:calc(100% - 2rem);padding:.7rem 1.1rem;border-radius:99px;background:var(--ink);color:var(--bg);font:700 .9rem/1.2 var(--sans);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
.toast.on{opacity:1;transform:translate(-50%,0)}
.fresh{position:fixed;left:0;right:0;bottom:0;z-index:8;display:flex;align-items:center;justify-content:center;gap:.6rem;width:100%;min-height:3.25rem;padding:.7rem 1rem calc(.7rem + env(safe-area-inset-bottom));border:0;background:var(--ink);color:var(--bg);font:700 .95rem/1.2 var(--sans);cursor:pointer}

@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,106,0,.65)}70%{box-shadow:0 0 0 .65rem rgba(255,106,0,0)}100%{box-shadow:0 0 0 0 rgba(255,106,0,0)}}
@keyframes snap{from{transform:scale(1.08)}to{transform:scale(1)}}
@media (min-width:34rem){
.doom{flex-direction:row;gap:.55rem}
.doom .ago{font-size:1rem}
.doom .wide{display:inline}
}
@media (min-width:46rem){
.hero .line{margin-top:1.1rem}
.doom{margin-top:1.4rem;font-size:1.15rem}
.doom .ago{font-size:1.15rem}
.doom .n{font-size:2.3rem}
.meter{width:18rem;height:.35rem;margin-top:1rem}
.btns{margin-top:2rem}
.btn{min-height:3rem;padding:0 1.6rem;font-size:1rem}
.chips{flex-wrap:wrap;overflow:visible}
.card h3{font-size:1.2rem}
.vit{grid-template-columns:repeat(3,1fr)}
.cell{font-size:2.1rem}
.cell small{font-size:.68rem}
}
@media (prefers-reduced-motion:reduce){
.dot{animation:none}
.snap{animation:none}
.toast{transition:none}
}
`;

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
  return squeeze(SHEET.replace(/__ROOT__/g, root));
}

// The 404 page is served at any depth, so it carries its own tiny style and
// uses system fonts only. It is the one page allowed to.
export const CSS_404 = squeeze(`
:root{color-scheme:dark}
html{background:#0B0B0F;color:#F2EFE8;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
body{box-sizing:border-box;margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;text-align:center;padding:2rem 1.25rem}
h1{margin:0;font:400 clamp(2.6rem,12vw,5rem)/1.02 Impact,"Arial Narrow Bold","Haettenschweiler",sans-serif;text-transform:uppercase;letter-spacing:.01em}
p{margin:1.75rem 0 0}
a{display:inline-flex;align-items:center;min-height:2.75rem;padding:0 1.3rem;border:1px solid #3B3B45;border-radius:99px;color:#F2EFE8;font-weight:600;text-decoration:none}
a:hover{border-color:#F2EFE8}
a:focus-visible{outline:2px solid #FF6A00;outline-offset:3px}
`);
