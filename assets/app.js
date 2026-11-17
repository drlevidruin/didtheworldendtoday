// didtheworldendtoday.com page script. One small file, no libraries, no inline
// script anywhere (the page policy forbids it). Everything here is a nicety:
// the page already reads correctly without it.
(function () {
  'use strict';

  // ---- plain helpers (also loaded by the tests under node) -------------------

  var MIN = 60000;
  var HOUR = 3600000;

  // Every clock time on the site is Eastern, written like "6:12 AM ET". This is built
  // the same way the server builds it (scripts/templates/copy.mjs), from the hour and
  // minute alone, so the page the server wrote and this script always say the same thing.
  var ET_CLOCK = null;
  function etClock(ms) {
    if (ms == null || ms === '' || typeof ms === 'boolean' || !Number.isFinite(Number(ms))) return '';
    var at = new Date(Number(ms));
    if (!Number.isFinite(at.getTime())) return '';
    if (!ET_CLOCK) ET_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
    var part = {};
    ET_CLOCK.formatToParts(at).forEach(function (p) {
      part[p.type] = p.value;
    });
    var hour = Number(part.hour) % 24;
    return (hour % 12 || 12) + ':' + part.minute + ' ' + (hour < 12 ? 'AM' : 'PM') + ' ET';
  }

  function etDay(ms) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  }

  function addDay(dateStr, n) {
    var d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Consecutive ET days of visiting. state is what was saved last time.
  function streakNext(state, today) {
    var ok = state && typeof state.last === 'string' && typeof state.n === 'number' && state.n >= 1;
    if (!ok || state.last > today) return { last: today, n: 1 };
    if (state.last === today) return { last: today, n: state.n };
    if (state.last === addDay(today, -1)) return { last: today, n: state.n + 1 };
    return { last: today, n: 1 };
  }

  function newer(a, b) {
    var x = Date.parse(a);
    var y = Date.parse(b);
    return Number.isFinite(x) && Number.isFinite(y) && x > y;
  }

  // Whether the site is quiet, as fresh data says it: true, false, or null when the data does not say.
  function quietIn(json) {
    var q = json && json.quiet;
    return q && typeof q.quiet === 'boolean' ? q.quiet : null;
  }

  // The share text with "Checked N days running." added for a streak of 2 or
  // more: above the link when the text ends with one, else at the end.
  function withStreak(text, n) {
    var body = String(text || '');
    if (!(n >= 2)) return body;
    var line = 'Checked ' + n + ' days running.';
    if (!body) return line;
    var lines = body.split('\n');
    if (/^\S+\/day\/\d{4}-\d{2}-\d{2}\/?$/.test(lines[lines.length - 1])) lines.splice(lines.length - 1, 0, line);
    else lines.push(line);
    return lines.join('\n');
  }

  // Someone closing the share sheet is not a failure; anything else falls back to copying.
  function shouldCopyAfterShareError(err) {
    return !(err && err.name === 'AbortError');
  }

  // A request that gives up after ms, body included, so a stalled connection can
  // never leave a button disabled. read(response) turns the response into a value.
  var TIMEOUT_MS = 8000;
  function timedFetch(url, ms, read) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = 0;
    var init = { cache: 'no-store' };
    if (controller) {
      init.signal = controller.signal;
      timer = setTimeout(function () {
        controller.abort();
      }, ms);
    }
    function done() {
      clearTimeout(timer);
    }
    return fetch(url, init)
      .then(read)
      .then(
        function (value) {
          done();
          return value;
        },
        function (err) {
          done();
          throw err;
        },
      );
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = {
      etClock: etClock,
      etDay: etDay,
      addDay: addDay,
      streakNext: streakNext,
      newer: newer,
      quietIn: quietIn,
      withStreak: withStreak,
      shouldCopyAfterShareError: shouldCopyAfterShareError,
      timedFetch: timedFetch,
    };
  }
  if (typeof document !== 'object') return;

  // ---- the page ----------------------------------------------------------------

  var doc = document;
  var html = doc.documentElement;
  var ROOT = html.getAttribute('data-root') || './';
  var LIVE = html.getAttribute('data-live') === '1';
  var KEY = 'dtwet.streak';
  var reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    reduce = false;
  }

  function $(sel, scope) {
    return (scope || doc).querySelector(sel);
  }
  function $$(sel, scope) {
    return Array.prototype.slice.call((scope || doc).querySelectorAll(sel));
  }
  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // The line that says the data is old. The time in the hero is a clock time, so it never
  // needs to tick; only this line can appear while the page is open.
  function tick() {
    var stale = $('#stale');
    var seen = Date.parse(html.getAttribute('data-success'));
    if (stale && LIVE && Number.isFinite(seen)) {
      if (Date.now() - seen > 2 * HOUR) {
        stale.textContent = (stale.getAttribute('data-template') || '').replace('{time}', etClock(seen));
        stale.hidden = false;
      } else {
        stale.hidden = true;
      }
    }
  }

  function savedStreak() {
    try {
      return JSON.parse(window.localStorage.getItem(KEY));
    } catch (e) {
      return null;
    }
  }

  // Counts this visit once per Eastern day. The count goes into the share text
  // ("Checked 3 days running.") and nowhere else on the page.
  function streak() {
    var next = streakNext(savedStreak(), etDay(Date.now()));
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      /* private mode: the share text still counts this visit */
    }
  }

  // ---- toast and share ------------------------------------------------------------

  var toastEl = null;
  var toastTimer = 0;
  function toast(text) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('on');
    }, 2400);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return legacyCopy(text);
        },
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var box = doc.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.className = 'sr';
    doc.body.appendChild(box);
    box.select();
    var ok = false;
    try {
      ok = doc.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    box.remove();
    return ok;
  }

  // The button's own day: the nearest block that carries share text. The hero's
  // "Share today" has the page itself (today), a day block has its own.
  function share(from) {
    var block = (from && from.closest ? from.closest('[data-share-full]') : null) || $('#main');
    if (!block) return;
    // The streak is the visitor's own, so it is added here and not by the server.
    var days = streakNext(savedStreak(), etDay(Date.now())).n;
    var text = withStreak(block.getAttribute('data-share-text') || '', days);
    var full = withStreak(block.getAttribute('data-share-full') || text, days);
    var link = block.getAttribute('data-share-url') || '';
    function copy() {
      copyText(full).then(function (ok) {
        toast(ok ? 'Copied. Paste it anywhere.' : 'Could not copy. Select the text and try again.');
      });
    }
    var touch = false;
    try {
      touch = window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      touch = false;
    }
    if (touch && navigator.share) {
      try {
        navigator.share({ text: text, url: link }).catch(function (err) {
          if (shouldCopyAfterShareError(err)) copy();
        });
      } catch (e) {
        copy();
      }
      return;
    }
    copy();
  }

  // ---- fresh data -----------------------------------------------------------------

  function minute() {
    return Math.floor(Date.now() / MIN);
  }

  function fetchLatest() {
    return timedFetch(ROOT + 'api/today.json?t=' + minute(), TIMEOUT_MS, function (res) {
      return res.ok ? res.json() : null;
    }).catch(function () {
      return null;
    });
  }

  // Fetch this same page again and swap the content in place.
  function swapMain() {
    return timedFetch(window.location.pathname + '?t=' + minute(), TIMEOUT_MS, function (res) {
      if (!res.ok) throw new Error('page');
      return res.text();
    })
      .then(function (text) {
        var next = new DOMParser().parseFromString(text, 'text/html');
        var fresh = next.querySelector('#main');
        var old = $('#main');
        if (!fresh || !old) throw new Error('page');
        old.replaceWith(doc.adoptNode(fresh));
        var foot = $('footer');
        var freshFoot = next.querySelector('footer');
        if (foot && freshFoot) foot.replaceWith(doc.adoptNode(freshFoot));
        ['build', 'success', 'quiet', 'date'].forEach(function (k) {
          var v = next.documentElement.getAttribute('data-' + k);
          if (v !== null) html.setAttribute('data-' + k, v);
        });
        removeBar();
        init();
      });
  }

  // The site can go quiet while a page is open. The fetched data knows before the page does,
  // so the page takes quiet from it and the tap on ALMOST. stops joking at once.
  function takeQuiet(json) {
    var q = quietIn(json);
    if (q !== null) html.setAttribute('data-quiet', q ? '1' : '0');
  }

  var bar = null;
  function removeBar() {
    if (bar) bar.remove();
    bar = null;
  }
  function showBar() {
    if (bar) return;
    bar = doc.createElement('button');
    bar.type = 'button';
    bar.className = 'fresh';
    bar.innerHTML = '<span class="dot" aria-hidden="true"></span><span>Updated. Tap to refresh.</span>';
    bar.addEventListener('click', function () {
      swapMain().catch(function () {
        window.location.reload();
      });
    });
    doc.body.appendChild(bar);
  }

  function poll() {
    if (bar) return;
    fetchLatest().then(function (json) {
      takeQuiet(json);
      if (json && newer(json.buildTime, html.getAttribute('data-build'))) showBar();
    });
  }

  // ---- Tap ALMOST. ---------------------------------------------------------------

  var busy = false;

  function sequence(hero, lines) {
    var slot = $('#check');
    hero.classList.add('is-checking');
    var chain = Promise.resolve();
    lines.forEach(function (line) {
      chain = chain.then(function () {
        slot.textContent = line;
        return wait(500);
      });
    });
    return chain.then(function () {
      hero.classList.remove('is-checking');
      slot.textContent = '';
    });
  }

  function snap() {
    var word = $('#verdict');
    if (!word) return;
    word.classList.remove('snap');
    void word.offsetWidth;
    word.classList.add('snap');
    setTimeout(function () {
      word.classList.remove('snap');
    }, 200);
  }

  // Replays the check, looks for newer data at the same time, and swaps the page in place when there is some.
  function check() {
    if (busy) return;
    var hero = $('#hero');
    if (!hero) return;
    busy = true;
    var lines = [];
    try {
      lines = JSON.parse(hero.getAttribute('data-lines')) || [];
    } catch (e) {
      lines = [];
    }
    var plain = html.getAttribute('data-quiet') === '1' || reduce || !lines.length;
    var fetched = LIVE ? fetchLatest() : Promise.resolve(null);
    var shown = plain ? Promise.resolve() : sequence(hero, lines);
    Promise.all([fetched, shown])
      .then(function (done) {
        var json = done[0];
        takeQuiet(json);
        if (LIVE && json && newer(json.buildTime, html.getAttribute('data-build'))) return swapMain();
        return null;
      })
      .catch(function () {
        return null;
      })
      .then(function () {
        busy = false;
        if (!plain) snap();
        tick();
        var said = $('#said');
        if (said) said.textContent = 'Checked. ' + ($('#verdict') ? $('#verdict').textContent : '');
      });
  }

  // ---- wiring ------------------------------------------------------------------------

  function onClick(event) {
    var node = event.target && event.target.closest ? event.target.closest('[data-act]') : null;
    if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'check') check();
    else if (act === 'share') share(node);
  }

  function init() {
    tick();
    streak();
  }

  doc.addEventListener('click', onClick);
  init();
  setInterval(tick, 30000);
  if (LIVE) {
    setInterval(poll, 5 * MIN);
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) poll();
    });
  }
})();
