// The line under ALMOST. on the homepage and on every day page: a joke that points down at the list.
//
// There are 100. The page carries one of them in its HTML, picked from the date, so a visitor with
// no JavaScript and a search crawler read a real line. A small inline script then swaps it for the
// next one from the visitor's own shuffled bag, so every visit shows a quip they have not seen yet.
//
// The rules for these lines, which the tests hold them to: at most 64 characters, a period at the
// end, no exclamation mark, question mark, semicolon, dash, straight quote or emoji, no word that
// dates the line (today, tonight, yesterday, this morning, this week), and every line points down
// at the list below it.
import { createHash } from 'node:crypto';
import { isDateStr } from '../lib/time.mjs';

export const QUIPS = Object.freeze([
  'The universe missed again. The receipts are below.',
  'Space has terrible aim. Evidence below.',
  'Space threw more rocks. Every one missed. See below.',
  'The universe swung and missed. Again. See below.',
  'Earth dodged a few. Replays below.',
  'The sky stayed up. Here’s what tried to knock it down.',
  'The cosmos rolled the dice. Results below.',
  'Space keeps aiming at us. Space keeps whiffing. Proof below.',
  'Gravity held. Here’s everything that tested it.',
  'Still spinning. Here’s what made it wobble.',
  'The sun behaved. Mostly. The rest is below.',
  'Physics held. Barely. The fine print is below.',
  'The universe is still trying. Its best efforts are below.',
  'Planet status: still here. The incident report is below.',
  'The world held together. Here’s what pulled on it.',
  'Doom knocked. Nobody answered. Doorbell footage below.',
  'Doom called. It went to voicemail. Messages below.',
  'Doomsday got rescheduled. Details below.',
  'Apocalypse postponed. Reasons below.',
  'The end of the world took a day off. Here’s who filled in.',
  'Doom showed up late and left early. Its attempts are below.',
  'Doom was on the calendar. It got moved. Notes below.',
  'Doom RSVP’d maybe. The guest list is below.',
  'Apocalypse canceled due to technical difficulties. See below.',
  'The end of the world is buffering. Here’s what loaded so far.',
  'Doom is 0 for forever. The latest tries are below.',
  'The end is near. Ish. Details below.',
  'The world’s end is still on back order. Updates below.',
  'Your homework survived too. Sorry. Close calls below.',
  'Here’s what almost got you out of homework.',
  'The planet passed the test. Barely. Grades below.',
  'No snow day from the apocalypse. Here’s how close it got.',
  'The world turned in its work on time. Barely. See below.',
  'Class is still on. Here’s what almost canceled it.',
  'Pencils down. Eyes down. Near misses ahead.',
  'Recess is safe. The close calls are below.',
  'Field trip to the end of the world: canceled. Details below.',
  'Show your work: the close calls are below.',
  'Mondays remain undefeated. Everything else is below.',
  'Your to-do list survived. Sorry. Here’s what almost saved you.',
  'Here’s everything that almost canceled Monday.',
  'Here’s why the dog kept barking.',
  'The reason your Wi-Fi blinked is somewhere below.',
  'Your alarm still works. Here’s what almost stopped it.',
  'Your weekend plans are safe. Mostly. Scroll down.',
  'Laundry still exists. Here’s what almost fixed that.',
  'The bills are still due. Here’s what almost got them canceled.',
  'Good news first: still here. The other news is below.',
  'Bad news: you still have chores. Details below.',
  'Keep calm and scroll down.',
  'Still here. The bloopers are below.',
  'Earth stays undefeated. The near misses are below.',
  'Final score: Earth 1, Everything else 0. Box score below.',
  'Earth is still in the game. Here are the close plays.',
  'Another big save for planet Earth. Scroll down for the tape.',
  'Earth went to overtime. Highlights below.',
  'Instant replay confirms it: still here. Footage below.',
  'The planet’s goalie had a busy shift. Saves below.',
  'Nothing ended. Lots of things tried. Scroll down.',
  'Everything below tried. Nothing below worked.',
  'Forecast: 100% chance of still here. Details below.',
  'Doom levels are elevated. The readings are below.',
  'Cloudy with a chance of almost. Radar below.',
  'Doom forecast: scattered near misses. See below.',
  'The doom report is in. Read it below.',
  'Earth’s story continues. The cliffhangers are below.',
  'No spoilers. Fine, one: still here. The rest is below.',
  'The season finale got pushed back. The episodes are below.',
  'Earth got renewed for another season. Recap below.',
  'The apocalypse trailer dropped. The movie did not. See below.',
  'Here’s what nearly got us.',
  'The close calls are right down there.',
  'It was close. How close is right below.',
  'Look down. That’s how close it got.',
  'Still here. Somehow. Scroll down to see how.',
  'Breathe. Then scroll down.',
  'Don’t panic. Scroll down. Then don’t panic again.',
  'Scroll down for the stuff that almost did it.',
  'Not the end. Just a lot of almosts. Scroll down.',
  'We checked. Everything still works. Mostly. See below.',
  'Close calls below, ranked by how much they should scare you.',
  'The near misses are below. Number one was rude.',
  'The doomsday list got longer. It’s right below.',
  'The almosts are below. Scariest first.',
  'Ranked below: everything that almost pulled it off.',
  'Proceed below with mild concern.',
  'Scroll slowly. Some of these are close.',
  'We ran the numbers. Still here. The numbers are below.',
  'The experiment called Earth continues. Lab notes below.',
  'The world is still loading. The error messages are below.',
  'System check complete. A few warnings below.',
  'Earth did not need a restart. Here’s what almost forced one.',
  'Nobody tell the dinosaurs how close it got. Scroll down.',
  'The streak lives. Here’s what tried to end it.',
  'Your snacks are safe. The close calls are below.',
  'Earth’s warranty held. The claims are below.',
  'The planet hit snooze on the apocalypse. Details below.',
  'Close enough to wave at. Photos below.',
  'Turns out the world is pretty sturdy. The stress test is below.',
  'Somehow still here. Here’s the near miss list, scariest first.',
]);

const DAY_MS = 86400000;

// The quip the static HTML carries. It depends only on the date: the number of days from 1970-01-01
// to that day, modulo the number of quips. A date that is not YYYY-MM-DD gets the first quip.
export function quipFor(date) {
  if (!isDateStr(date)) return QUIPS[0];
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return QUIPS[((days % QUIPS.length) + QUIPS.length) % QUIPS.length];
}

// A short hash of a list. It goes into the page script, so any edit to the list gives every
// visitor a new bag instead of an old one that points at lines that moved.
export const quipHash = (list) => createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 8);
export const QUIP_HASH = quipHash(QUIPS);

// The script that runs right after the quip element, for a list of lines. The page uses it for QUIPS
// (QUIP_SCRIPT below); a test uses it for a list that holds a "<" to prove the script stays safe.
// ES5 like assets/app.js, and no comments in it, because every byte is sent with every page.
//
// The bag lives in localStorage under dtwet-quips as { h, bag, last }: h is the hash above, bag
// holds the indexes not shown yet, last is the index shown last. Each load pops the next index,
// saves the state and sets the text of #quip. Anything the script cannot trust (bad JSON, another
// h, a bag that is not distinct whole numbers from 0 to 99, a missing key) counts as an empty bag.
// An empty bag is refilled with a fresh Fisher-Yates shuffle whose first index is never last, so a
// refill never repeats the quip on screen. Storage that throws means a fresh shuffle every time.
// Nothing in it throws, and window.dtwetQuip is the function that shows the next quip, which the
// page script calls after a tap on ALMOST. and after an in-place page swap.
export function quipScript(list) {
  // A "<" in the list is written as \u003c, so the script never holds "</" or "<!--" and cannot
  // close its own tag early.
  const items = JSON.stringify(list).replace(/</g, '\\u003c');
  return `(function () {
  'use strict';
  var Q = ${items};
  var H = '${quipHash(list)}';
  var K = 'dtwet-quips';
  var N = Q.length;
  var shown = -1;
  function whole(v) {
    return typeof v === 'number' && v >= 0 && v < N && v % 1 === 0;
  }
  function distinct(bag) {
    var seen = {};
    var i;
    if (!Array.isArray(bag)) return false;
    for (i = 0; i < bag.length; i++) {
      if (!whole(bag[i]) || seen[bag[i]]) return false;
      seen[bag[i]] = 1;
    }
    return true;
  }
  function store() {
    try {
      return window.localStorage || localStorage;
    } catch (e) {
      return null;
    }
  }
  function read() {
    var s = null;
    var ok;
    try {
      s = JSON.parse(store().getItem(K));
    } catch (e) {
      s = null;
    }
    ok = !!s && typeof s === 'object' && s.h === H && whole(s.last);
    return { bag: ok && distinct(s.bag) ? s.bag : [], last: ok ? s.last : shown };
  }
  function shuffled(last) {
    var a = [];
    var i;
    var j;
    var t;
    for (i = 0; i < N; i++) a.push(i);
    for (i = N - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    if (a[N - 1] === last) {
      j = Math.floor(Math.random() * (N - 1));
      t = a[N - 1];
      a[N - 1] = a[j];
      a[j] = t;
    }
    return a;
  }
  function pick() {
    var s = read();
    var bag = s.bag.length ? s.bag : shuffled(s.last);
    var i = bag.pop();
    try {
      store().setItem(K, JSON.stringify({ h: H, bag: bag, last: i }));
    } catch (e) {}
    return i;
  }
  function show() {
    var el;
    var i;
    try {
      el = document.getElementById ? document.getElementById('quip') : document.querySelector('#quip');
      if (!el) return;
      try {
        i = pick();
      } catch (e) {
        i = Math.floor(Math.random() * N);
      }
      if (!whole(i)) i = 0;
      shown = i;
      el.textContent = Q[i];
    } catch (e) {}
  }
  try {
    window.dtwetQuip = show;
  } catch (e) {}
  show();
})();`;
}

export const QUIP_SCRIPT = quipScript(QUIPS);

// What the page's security policy needs to allow that one script: the sha256 of its exact text, in
// the form a script-src list takes ('sha256-<base64>', quotes included). It is computed from the
// script itself, so the policy and the script cannot drift apart.
export const QUIP_CSP = `'sha256-${createHash('sha256').update(QUIP_SCRIPT, 'utf8').digest('base64')}'`;
