// didtheworldendtoday.com page script. One small file, no libraries, no inline
// script anywhere (the page policy forbids it). Everything here is a nicety:
// the page already reads correctly without it.
(function () {
  'use strict';

  // ---- plain helpers (also loaded by the tests under node) -------------------

  var MIN = 60000;
  var HOUR = 3600000;

  // Same wording and thresholds as the server side, so nothing changes when
  // this script takes over from the page the server wrote.
  function ago(ms) {
    var sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (sec < 60) return 'just now';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' min ago';
    var hours = Math.floor(min / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';
    var days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : days + ' days ago';
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

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { ago: ago, etDay: etDay, addDay: addDay, streakNext: streakNext, newer: newer };
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

  // The date under ALMOST. is the visitor's own date, not ours.
  function localDate() {
    var el = $('[data-local="date"]');
    if (!el) return;
    try {
      el.textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    } catch (e) {
      /* keep the date the server wrote */
    }
  }

  function tick() {
    var now = Date.now();
    $$('time.rel').forEach(function (el) {
      var at = Date.parse(el.getAttribute('datetime'));
      if (Number.isFinite(at)) el.textContent = ago(now - at);
    });
    $$('.ago[data-since]').forEach(function (el) {
      var at = Date.parse(el.getAttribute('data-since'));
      if (Number.isFinite(at)) el.textContent = 'checked ' + ago(now - at);
    });
    var stale = $('#stale');
    var seen = Date.parse(html.getAttribute('data-success'));
    if (stale && LIVE && Number.isFinite(seen)) {
      var late = now - seen;
      if (late > 2 * HOUR) {
        stale.textContent = (stale.getAttribute('data-template') || '').replace('{n}', String(Math.floor(late / HOUR)));
        stale.hidden = false;
      } else {
        stale.hidden = true;
      }
    }
  }

  function streak() {
    var el = $('#streak');
    if (!el) return;
    var saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(KEY));
    } catch (e) {
      saved = null;
    }
    var next = streakNext(saved, etDay(Date.now()));
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
      /* private mode: show the line anyway */
    }
    el.textContent = (el.getAttribute('data-template') || '').replace('{n}', String(next.n));
    el.hidden = false;
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

  function share() {
    var main = $('#main');
    if (!main) return;
    var text = main.getAttribute('data-share-text') || '';
    var full = main.getAttribute('data-share-full') || text;
    var link = main.getAttribute('data-share-url') || '';
    var touch = false;
    try {
      touch = window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
      touch = false;
    }
    if (touch && navigator.share) {
      navigator.share({ text: text, url: link }).catch(function () {});
      return;
    }
    copyText(full).then(function (ok) {
      toast(ok ? 'Copied. Paste it anywhere.' : 'Could not copy. Select the text and try again.');
    });
  }

  // ---- fresh data -----------------------------------------------------------------

  function minute() {
    return Math.floor(Date.now() / MIN);
  }

  function fetchLatest() {
    return fetch(ROOT + 'api/today.json?t=' + minute(), { cache: 'no-store' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  // Fetch this same page again and swap the content in place.
  function swapMain() {
    return fetch(window.location.pathname + '?t=' + minute(), { cache: 'no-store' })
      .then(function (res) {
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
    bar.innerHTML = '<span class="dot" aria-hidden="true"></span><span>New near misses. Tap to refresh.</span>';
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
      if (json && newer(json.buildTime, html.getAttribute('data-build'))) showBar();
    });
  }

  // ---- Check again ---------------------------------------------------------------

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

  function check() {
    if (busy) return;
    var hero = $('#hero');
    if (!hero) return;
    busy = true;
    var button = $('[data-act="check"]');
    if (button) button.disabled = true;
    var lines = [];
    try {
      lines = JSON.parse(hero.getAttribute('data-lines')) || [];
    } catch (e) {
      lines = [];
    }
    var plain = html.getAttribute('data-quiet') === '1' || reduce || !lines.length;
    var fetched = fetchLatest();
    var shown = plain ? Promise.resolve() : sequence(hero, lines);
    Promise.all([fetched, shown])
      .then(function (done) {
        var json = done[0];
        if (json && newer(json.buildTime, html.getAttribute('data-build'))) return swapMain();
        return null;
      })
      .catch(function () {
        return null;
      })
      .then(function () {
        busy = false;
        var again = $('[data-act="check"]');
        if (again) again.disabled = false;
        if (!plain) snap();
        tick();
        var said = $('#said');
        if (said) said.textContent = 'Checked. ' + ($('#verdict') ? $('#verdict').textContent : '');
      });
  }

  // ---- the category chips ------------------------------------------------------------

  function filter(cat) {
    $$('.chip').forEach(function (chip) {
      chip.setAttribute('aria-pressed', chip.getAttribute('data-cat') === cat ? 'true' : 'false');
    });
    var more = $('#receipts .more');
    $$('#receipts .card').forEach(function (card) {
      card.hidden = cat !== 'all' && card.getAttribute('data-cat') !== cat;
    });
    if (!more) return;
    if (more.getAttribute('data-was') === null) more.setAttribute('data-was', more.open ? '1' : '0');
    var inside = $$('.card', more).filter(function (card) {
      return !card.hidden;
    }).length;
    if (cat === 'all') {
      more.hidden = false;
      more.open = more.getAttribute('data-was') === '1';
      more.removeAttribute('data-was');
    } else {
      more.hidden = inside === 0;
      more.open = inside > 0;
    }
  }

  // ---- wiring ------------------------------------------------------------------------

  function onClick(event) {
    var node = event.target && event.target.closest ? event.target.closest('[data-act],.chip') : null;
    if (!node) return;
    if (node.classList.contains('chip')) {
      filter(node.getAttribute('data-cat'));
      return;
    }
    var act = node.getAttribute('data-act');
    if (act === 'check') check();
    else if (act === 'share') share();
  }

  function init() {
    var chips = $('.chips');
    if (chips) chips.hidden = false;
    localDate();
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
