// layout.test.mjs — the screen must FIT. Nothing overflows, nothing overprints.
//
// Why this test exists (dad 9/6, two photos off the I-13): the subtitle
// "Word 1 of 6 — it rhymes with stand" was sitting on top of the tile row, and
// the letter bar was sliced off along the bottom of the screen.
//
// The cause was a VIEWPORT the app had never been measured at. The original
// studio was always launched with --force-device-scale-factor=1 (aac-studio
// install/windows-device.ps1:50, "scale forced so her layout never shrinks"),
// so her 1920x1080 panel was a 1920x1080 CSS viewport. The hub's kiosk line
// (era-hub/tools/build-payload.sh:156) does not pass that flag, so the same
// panel at Windows 150% scaling is a 1280x720 CSS viewport — and every FIXED px
// in index.html suddenly costs 1.5x the screen. Both the old studio and this
// one drew fine at 1920x1080 and fell apart at 1280x720; nothing tested there.
//
// So this test pins the screens dad photographed at every viewport she can
// actually get. Her I-13 TODAY is the 1280x720 pair — that is the PRIMARY
// target; the 1920 pair is what she gets if the kiosk ever forces scale 1
// again, and 1536x864 is 125% scaling:
//   1280x720   150% display scaling, true kiosk   <- her I-13 today
//   1280x672   150% scaling with the taskbar over it  <- dad's photos
//   1920x1080  scale 1, true kiosk (the original's viewport)
//   1920x1032  scale 1 with the taskbar over it
//   1920x1040  scale 1, small-icon taskbar
//   1536x864   125% display scaling
//
// HOW TO RUN:  node --test tests/layout.test.mjs   (nothing else needed)
// The suite serves the studio itself, on an OS-assigned free port — the app,
// era-core's shared assets and this repo's lessons.json, plus the handful of
// hub endpoints the page pokes. It deliberately has NO default hub: this file
// used to default to the hub's standard port, which on a family's own machine
// is their LIVE hub — running the suite drove it and read their real
// lessons.json / runway.json, and the "longest word" screen walked every lesson
// in it. Set ERA_BASE to drive a scratch hub instead:
//   ERA_DATA_DIR=<scratch dir> node ../../era-hub/server.js 8466
//   ERA_BASE=http://127.0.0.1:8466 node --test tests/layout.test.mjs
//
// The name is load-bearing: era-gate.sh runs era-making-words' CJS suites from
// a hard-coded allowlist (`run parts transfer …`) and everything else only if
// it matches *.test.mjs. As tests/layout.js this guard was copied into gate/
// and never executed — the 1280x720 overflow could have come back green.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pick = (cands, probe) => cands.filter(Boolean).map(d => path.resolve(d))
  .find(d => fs.existsSync(path.join(d, probe))) || null;
// WORKTREE SUFFIX (9/17). A multi-repo feature keeps sibling worktrees named
// era-<repo>--wt-<feature> (era-gate.sh sib(), ERA_WT_SUFFIX). Naming era-core
// flat meant this suite served MASTER's shared assets to the worktree's app —
// the whole point of T7 is a bar that lives in era-core, so that resolution
// tested the change against the code it replaced. Prefer the suffixed sibling,
// from the env or, failing that, from the name of the checkout we are in.
const SUFFIX = process.env.ERA_WT_SUFFIX
  || ((HERE.match(/[/\\]era-[a-z-]+?(--wt-[a-z0-9-]+)[/\\]/) || [])[1])
  || "";
const sib = (root, name) => [path.join(root, name + SUFFIX), path.join(root, name)];
// Two shapes to find the files in: this repo's own checkout (tests/ → ../app),
// and the parity gate, which flattens every repo's tests into era-hub/gate/ —
// from there the sibling repo is ../../era-making-words[suffix] and era-core's
// shared assets are reachable through era-hub's assembled public/ (assemble.sh).
const REPO = pick([path.join(HERE, ".."), ...sib(path.join(HERE, "..", ".."), "era-making-words")], "app/studio.js");
const APP_DIR = REPO && path.join(REPO, "app");
const CORE_DIR = pick([...(REPO ? sib(path.join(REPO, ".."), "era-core") : []), path.join(HERE, "..", "public")], "dwell.js");
const CONTENT_DIR = pick([REPO && path.join(REPO, "content"), path.join(HERE, "..", "public")], "lessons.json");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
// The studio's whole server surface, answered locally: no key is ever spent, no
// family pointer is ever written, and /tts fails the way a hub with no voice
// does (the page falls back to on-screen words, which is what we measure).
function studioServer() {
  const roots = [APP_DIR, CORE_DIR, CONTENT_DIR];
  const srv = http.createServer((req, res) => {
    const done = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "text/plain" }); res.end(body); };
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (req.method !== "GET") {
      req.resume();
      if (p === "/kiosk/exit") return done(200, '{"action":"none"}', MIME[".json"]);
      // the 💬's hub leg: "paused" = the kiosk is going under her, the page does
      // nothing more. A 204 here would send the bar down its fall-through leg
      // (the 🚪) and navigate the page away mid-suite.
      if (p === "/kiosk/pause") return done(200, '{"action":"paused"}', MIME[".json"]);
      return done(204, "");
    }
    // pauseGoes: there IS a TD Snap to go and talk in, so the 💬 is mounted and
    // measured at every viewport alongside the 🚪.
    if (p === "/settings") return done(200, '{"dwellMs":1200,"pauseGoes":"tdsnap"}', MIME[".json"]);
    if (p === "/voices") return done(200, '{"enabled":false,"current":"","voices":[]}', MIME[".json"]);
    if (p === "/" || p === "") p = "/index.html";
    for (const root of roots) {
      const f = path.resolve(path.join(root, p));
      if (!f.startsWith(root + path.sep)) continue;              // no traversal out of a root
      if (fs.existsSync(f) && fs.statSync(f).isFile())
        return done(200, fs.readFileSync(f), MIME[path.extname(f)] || "application/octet-stream");
    }
    done(404, "not found");
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv)));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEWPORTS = [
  { width: 1280, height: 720 }, { width: 1280, height: 672 },
  { width: 1920, height: 1080 }, { width: 1920, height: 1032 }, { width: 1920, height: 1040 },
  { width: 1536, height: 864 },
];

// The three screens in dad's photos + the worst case the lesson file can throw
// + the sort screen (the other half of the app: bottom choice tray, word heads,
// the stacks that grow toward the pill).
const SCREENS = {
  // "Spell the word you hear" with a 5-letter word and a 5-letter model row
  'spell-the-word-you-hear': async page => page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    S.lesson = db.lessons.find(l => l.lesson === 1); S.tts = true;
    document.getElementById('adultBar').style.display = 'none';
    show('stage');
    S.phase = 'transfer'; S.transferIdx = 0;
    S.spellWords = ['stand', 'brand', 'grand', 'bland', 'sand', 'band'];
    await transferOne();
  }),
  // "Add a letter at the end." — make phase, model row revealed (two-strike)
  'add-a-letter-at-the-end': async page => page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    S.lesson = db.lessons.find(l => l.lesson === 1); S.tts = true;
    document.getElementById('adultBar').style.display = 'none';
    show('stage'); buildTray(S.lesson.letters, true);
    S.wordIdx = 2; await startMakeWord();
    renderModel(currentWord());
  }),
  // the longest word in the whole lesson file, on the widest tray it ships with
  'longest-word': async page => page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    let worst = null;
    for (const l of db.lessons) for (const w of (l.make || []))
      if (!worst || w.length > worst.w.length) worst = { l, w };
    S.lesson = worst.l; S.tts = true;
    document.getElementById('adultBar').style.display = 'none';
    show('stage'); buildTray(S.lesson.letters, true);
    S.wordIdx = S.lesson.make.indexOf(worst.w); await startMakeWord();
    renderModel(currentWord());
    return worst.w;
  }),
  // RHYME SORT, fully sorted — the screen buildChoiceTray draws: word heads in
  // the bottom band and every made word stacked above its head. Sorted to the
  // END, because that is the fullest the screen ever gets: dad's 9/3 photo was
  // a stack that had climbed into the current-word pill.
  'sort-by-rhyme': async page => page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    S.lesson = db.lessons.find(l => l.lesson === 1);
    S.tts = false;                                   // say() resolves at once; no Speech round-trip
    document.getElementById('adultBar').style.display = 'none';
    show('stage');
    S.sortType = 'rhyme'; S.sortCols = buildSortCols('rhyme');
    await startSort();
    const stacks = [...document.querySelectorAll('#colStacks .colstack')];
    // liveColumns() for a rhyme sort = the families with something to sort, in
    // order — index-aligned to the stacks buildChoiceTray just made.
    S.sortCols.filter(c => c.length >= 2)
      .forEach((col, i) => { for (const w of col.slice(1)) addColWord(stacks[i], w); });
  }),
};

// Everything below runs INSIDE the page.
const AUDIT = () => {
  const vis = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05;
  };
  const W = window.innerWidth, H = window.innerHeight;
  const nm = el => el.id || '.' + (el.className || '').toString().split(' ').filter(Boolean).join('.');

  // 1. nothing leaves the viewport — her letter bar included
  const onScreen = [...document.querySelectorAll(
    '#prompt > div, #prompt .text, #prompt .sub, #slots .slot, #model .m, ' +
    '#tray .letter, #parkPad, #barDoor, #barTalk, #replay, #sortword, .colstack .colword')].filter(vis);
  const outside = [];
  for (const el of onScreen) {
    const r = el.getBoundingClientRect(), o = [];
    if (r.bottom > H + 0.5) o.push('below+' + Math.round(r.bottom - H));
    if (r.top < -0.5) o.push('above' + Math.round(r.top));
    if (r.right > W + 0.5) o.push('right+' + Math.round(r.right - W));
    if (r.left < -0.5) o.push('left' + Math.round(r.left));
    if (o.length) outside.push(nm(el) + ' ' + o.join(','));
  }

  // 2. the prompt block, the fixed chrome and the current-word pill never
  //    overprint a tile row or a word stack (dad 9/3: "tan" over the column)
  const overlap = [];
  const rows = [...document.querySelectorAll('#model .m, #slots .slot, #tray .letter, #parkPad, .colstack .colword')].filter(vis);
  const hit = (a, b, an, bn) => {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) overlap.push(an + ' over ' + bn + ' by ' + Math.round(ox) + 'x' + Math.round(oy));
  };
  const over = [document.querySelector('#prompt > div'), document.getElementById('barDoor'),
                document.getElementById('barTalk'),
                document.getElementById('replay'), document.getElementById('sortword')].filter(e => e && vis(e));
  for (const c of over) for (const el of rows) hit(c.getBoundingClientRect(), el.getBoundingClientRect(), nm(c), nm(el));
  for (const [an, bn] of [['model', 'slots'], ['slots', 'tray']]) {
    const a = document.getElementById(an), b = document.getElementById(bn);
    if (a && b && vis(a) && vis(b)) hit(a.getBoundingClientRect(), b.getBoundingClientRect(), an, bn);
  }

  // 3. every tile in a row shares a top edge (dad 9/6: "one letter sits higher")
  const skew = [];
  for (const [n, sel] of [['model', '#model .m'], ['slots', '#slots .slot'], ['tray', '#tray .letter']]) {
    const t = [...document.querySelectorAll(sel)].filter(vis).map(e => e.getBoundingClientRect().top);
    if (t.length > 1) { const d = Math.round(Math.max(...t) - Math.min(...t)); if (d > 1) skew.push(n + ' top spread ' + d + 'px'); }
  }

  // 4. every letter fits its tile with room to spare. Her tiles carry a bottom
  //    reserve for the Windows taskbar, so measure the CONTENT box, and use a
  //    real Segoe UI line box (~1.34em) — not the nominal font size. Sort heads
  //    are tray letters (.letter.dwell.sorthead), so this covers them too.
  const cramped = [];
  const fits = (el, label) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
    const boxH = r.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const boxW = r.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const needH = fs * 1.34, needW = fs * 0.62 * (el.textContent || '').length;
    if (needH > boxH - 2 || needW > boxW - 2)
      cramped.push(label + ' ' + Math.round(fs) + 'px needs ' + Math.round(needH) + 'x' + Math.round(needW) +
                   ' in ' + Math.round(boxW) + 'x' + Math.round(boxH));
  };
  [...document.querySelectorAll('#tray .letter')].filter(vis).forEach(e => fits(e, 'tray "' + e.textContent + '"'));
  [...document.querySelectorAll('#model .m')].filter(vis).forEach(e => fits(e, 'model "' + e.textContent + '"'));
  [...document.querySelectorAll('#slots .slot')].filter(vis).filter(e => e.textContent).forEach(e => fits(e, 'slot "' + e.textContent + '"'));
  // The stack words and the pill set their own line-height (1.2) and carry
  // decorative padding, so the 1.34em line-box proxy above does not apply to
  // them; what can actually go wrong is a word spilling sideways out of its
  // column into the neighbouring one. Measure that instead.
  const spill = [];
  for (const st of document.querySelectorAll('#colStacks .colstack')) {
    const s = st.getBoundingClientRect();
    for (const w of [...st.children].filter(vis)) {
      const r = w.getBoundingClientRect();
      if (r.left < s.left - 2 || r.right > s.right + 2)
        spill.push('"' + w.textContent + '" ' + Math.round(r.width) + ' wide in a ' + Math.round(s.width) + ' column');
    }
  }

  // 5. gaze targets stay big — EVERY one of them. (This used to sort by area and
  //    test only the smallest, so the tray's narrower backspace tile was never
  //    the one compared and a 147px-wide target reported PASS.)
  const targets = [...document.querySelectorAll('.dwell')].filter(vis)
    .map(e => { const r = e.getBoundingClientRect();
                return { n: e.id || e.textContent.slice(0, 4), tray: !!e.closest('#tray'),
                         bar: !!e.closest('.msgbar'),
                         w: Math.round(r.width), h: Math.round(r.height) }; });

  // 6. the letter band keeps the 30%-of-screen contract it declares (it used to
  //    be flex-shrunk below it, which is how the bottom of the row went missing)
  const tray = document.getElementById('tray');
  const cssVar = k => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(k)) || 0;
  const declared = Math.round(cssVar('--trayH'));
  const actual = tray ? Math.round(tray.getBoundingClientRect().height) : 0;

  // 7. the sort screen's word heads are READING content: they carry the
  //    contract's label floor like every other choice she reads off a tile.
  const heads = [...document.querySelectorAll('.sorthead')].filter(vis)
    .map(e => ({ t: e.textContent, fs: Math.round(parseFloat(getComputedStyle(e).fontSize) * 10) / 10 }));

  // 8. the shared door bar (era-core lib/doorbar.js) is on THIS screen, and the
  //    app's own chrome really did move under it (--bar-h is not a decoration).
  const barEl = document.querySelector('.msgbar');
  const barR = barEl && barEl.getBoundingClientRect();
  const barInner = barEl
    ? Math.round(parseFloat(getComputedStyle(barEl).getPropertyValue('--bar-inner')) || 0) : 0;
  const barH = Math.round(parseFloat(getComputedStyle(document.body).getPropertyValue('--bar-h')) || 0);
  // anything of hers that starts ABOVE the bar's bottom edge. NOT #colStacks:
  // that overlay is `inset:0` and can never fail this row, while the things it
  // holds are `position:fixed` with a `bottom:` (studio.js buildChoiceTray) and
  // so escape it entirely — a stack that grew into the strip would have passed.
  // The stacks and their words are what actually climbs; measure THEM.
  const under = [];
  if (barR) for (const el of [...document.querySelectorAll(
      '#stage, .screen.show, #prompt, #tray, #replay, .colstack, .colstack .colword')].filter(vis))
    if (el.getBoundingClientRect().top < barR.bottom - 0.5)
      under.push(nm(el) + ' top ' + Math.round(el.getBoundingClientRect().top) + ' < bar ' + Math.round(barR.bottom));

  return { outside, overlap, skew, cramped, spill, targets, heads, declared, actual,
           bar: { present: !!barEl, doors: barEl ? barEl.querySelectorAll('.dwell').length : 0,
                  h: barR ? Math.round(barR.height) : 0, inner: barInner, barH, under },
           unit: cssVar('--letterSize'), fontFloor: window.EllieContract.CONTRACT.sizes.fontFloor,
           hScroll: document.documentElement.scrollWidth > W + 1 };
};

// The smallest target the original ever drew: the door, 170x110 at every
// viewport — 18700 px² of screen. Every target is measured against it, but the
// two kinds of target are measured differently, because the full-bleed letter
// band is not free to be 170 wide: it splits the WHOLE width between the
// lesson's letters with no gaps (dad 7/26), so on a 1280px kiosk an 8-letter
// lesson draws 138px letters and a 99px backspace (0.72 of a unit by design,
// index.html .letter.small). Those are 216px TALL — more screen than the door.
// So: fixed chrome must clear the door's 170x110; a band tile must be the full
// unit wide and the full band tall (never shrunk out of the row it declares)
// and still cover more screen than the door.
// THREE kinds of target now, and the third is the reason this constant survives
// the door tile it was named after:
//   fixed chrome  — must clear the old door's 170x110;
//   a band tile   — full unit wide, full band tall, and more screen than the door;
//   BAR CHROME    — the 🚪 and the 💬 in the shared strip (era-core doorbar.css),
//                   which are DELIBERATELY smaller (dad 9/2: "the icon for the
//                   exit can be smaller", and a top corner is the easiest reach
//                   on the screen). They are judged against the STRIP instead —
//                   the same law era-hub's invariants.mjs law 1 applies: each
//                   door fills the bar's inner height and is twice as wide as
//                   tall. A door that is short, or narrow, or that stopped
//                   tracking --bar-inner, still fails.
const DOOR = { w: 170, h: 110 };
const undersized = a => a.targets.filter(t => t.bar
  ? (t.h < a.bar.inner - 1 || t.w < 2 * t.h - 1)
  : t.tray
  ? (t.w < (t.n === 'backspace' ? Math.floor(a.unit * 0.72) : a.unit) - 1
     || t.h < a.declared - 1 || t.w * t.h < DOOR.w * DOOR.h)
  : (t.w < DOOR.w || t.h < DOOR.h));

let browser, server, BASE;
before(async () => {
  if (process.env.ERA_BASE) BASE = process.env.ERA_BASE.replace(/\/$/, '');
  else {
    assert.ok(APP_DIR && CORE_DIR && CONTENT_DIR,
      `cannot find the studio's files (app=${APP_DIR} core=${CORE_DIR} content=${CONTENT_DIR}) — run from the repo, or set ERA_BASE`);
    server = await studioServer();
    BASE = 'http://127.0.0.1:' + server.address().port;
  }
  browser = await chromium.launch();
}, { timeout: 120000 });
after(async () => {
  await browser?.close();
  if (server) await new Promise(r => server.close(r));
});

for (const vp of VIEWPORTS) {
  test(vp.width + 'x' + vp.height, { timeout: 180000 }, async t => {
    const page = await browser.newPage({ viewport: vp });
    await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
    await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));   // never touch the family's real pointer
    await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"current":"","voices":[]}' }));
    await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
    await page.goto(BASE + '/');
    await sleep(800);
    // The 💬 is a /settings decision (pauseGoes:"tdsnap"). Force it on so the
    // second door is MEASURED at every viewport whatever hub ERA_BASE points at
    // — its geometry is the thing this suite exists to pin.
    // window.__doorBar, not the bare `doorBar`: studio.js is a classic script and
    // its top-level `const` is a global-scope BINDING, not a property of window.
    // Reaching it from page.evaluate worked by accident of scope; the app now
    // publishes the handle on purpose (studio.js, right after mountDoorBar).
    await page.evaluate(() => window.__doorBar.setPause(true));

    for (const [name, drive] of Object.entries(SCREENS)) {
      await drive(page);
      await sleep(350);
      const a = await page.evaluate(AUDIT);
      const check = (label, cond, extra) => t.test(name + ': ' + label, () => assert.ok(cond, extra));
      await check('everything on screen', a.outside.length === 0, a.outside.join('; '));
      await check('nothing overprints a tile row', a.overlap.length === 0, a.overlap.join('; '));
      await check('tiles share a top edge', a.skew.length === 0, a.skew.join('; '));
      await check('letters fit their tiles', a.cramped.length === 0, a.cramped.join('; '));
      await check('stack words stay in their column', a.spill.length === 0, a.spill.join('; '));
      await check('no horizontal scroll', !a.hScroll);
      // the shared strip is on EVERY screen, carrying exactly the two doors,
      // and the app really does start below it
      await check('door bar present with both doors',
                  a.bar.present && a.bar.doors === 2, JSON.stringify(a.bar));
      await check('the app sits under the bar',
                  a.bar.under.length === 0, a.bar.under.join('; '));
      await check('--bar-h matches the strip it drew',
                  Math.abs(a.bar.barH - a.bar.h) <= 1, '--bar-h=' + a.bar.barH + ' strip=' + a.bar.h);
      // the letter band is her biggest target; it must not be flex-shrunk away
      await check('letter band keeps its declared height',
                  Math.abs(a.actual - a.declared) <= 1, 'declared=' + a.declared + ' actual=' + a.actual);
      // gaze floor: nothing she looks at is smaller than the door
      await check('every gaze target clears the door (170x110)',
                  undersized(a).length === 0, JSON.stringify(undersized(a)) + ' of ' + JSON.stringify(a.targets));
      if (a.heads.length) {   // sort screen: the word heads she reads and picks
        await check('sort heads keep the ' + a.fontFloor + 'px label floor',
                    a.heads.every(h => h.fs >= a.fontFloor), JSON.stringify(a.heads));
        // …and they keep HALF THE BAND, the size buildChoiceTray declares,
        // unless the word's own width takes it below that. Paired with "letters
        // fit their tiles" above (which measures the content box, i.e. above the
        // taskbar reserve) this brackets the head: never too big for the cell,
        // never smaller than the cell can carry. The reserve must NOT come off
        // the top of it — half a band always clears a 0.72-band reserve, so
        // subtracting first only ever shrinks a head that already fitted.
        await check('sort heads keep half the band',
                    a.heads.every(h => h.fs >= Math.min(a.declared * 0.5, a.unit * 0.92 / (0.58 * h.t.length)) - 1),
                    JSON.stringify(a.heads) + ' band=' + a.declared + ' unit=' + a.unit);
      }
    }
    await page.close();
  });
}

// ---- 💬 PAUSE TO TALK (dad 9/17) ----
// She is mid-lesson and wants to SAY something. The door must stop the studio
// talking over her and hand the screen to TD Snap — and it must name THIS page
// when it does, or the hub brings back a fresh kiosk instead of her lesson.
// dwell.js fires el.click() on a dwell select, so a click here is the same code
// path her gaze takes.
test('the talk door stops speech and pauses this app', { timeout: 120000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"current":"","voices":[]}' }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  const pauses = [];
  await page.route('**/kiosk/pause', r => {
    pauses.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"paused"}' });
  });
  // a fall-through to the 🚪 would navigate the page away — that is the failure
  // this row is watching for, so count it rather than let it wreck the test
  let exits = 0;
  await page.route('**/kiosk/exit', r => { exits++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"closed"}' }); });
  await page.goto(BASE + '/');
  await sleep(800);
  await page.evaluate(() => window.__doorBar.setPause(true));

  await t.test('💬 is a live gaze target once settings allow it', async () => {
    assert.ok(await page.locator('#barTalk').isVisible());
    assert.ok(await page.locator('#barTalk.dwell').count() === 1);
  });

  // The bar's pausedFlag is the whole difference between "she is back from TD
  // Snap" and "something else took the screen for a moment". With NO pause
  // pending, a visibilitychange must be completely inert — it must not un-pause
  // a partner ⏸, and it must not talk to the hub.
  await t.test('a visibilitychange with no pause pending changes nothing', async () => {
    const before = await page.evaluate(() => S.paused);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(200);
    assert.equal(await page.evaluate(() => S.paused), before);
    assert.equal(pauses.length, 0, JSON.stringify(pauses));
    assert.equal(exits, 0);
  });

  // spy on the shared speech layer: onPause's barge-in is the promise that she
  // is never talked over the moment she asks for the floor
  await page.evaluate(() => {
    window.__stops = 0;
    const orig = Speech.stop;
    Speech.stop = function (...a) { window.__stops++; return orig.apply(this, a); };
  });
  await page.click('#barTalk');
  await sleep(600);

  await t.test('💬 stops speech', async () => {
    assert.ok(await page.evaluate(() => window.__stops) >= 1, 'Speech.stop was never called');
  });
  await t.test('💬 pauses the studio in place', async () => {
    assert.equal(await page.evaluate(() => S.paused), true);
    assert.ok(await page.locator('#sStart.show').count() === 1, 'the screen changed under her');
  });
  await t.test('💬 POSTs /kiosk/pause naming this page', async () => {
    assert.equal(pauses.length, 1, JSON.stringify(pauses));
    assert.equal(pauses[0].path, '/');
  });
  await t.test('a paused kiosk does not also walk out of the 🚪', async () => {
    assert.equal(exits, 0);
  });

  // coming back: the hub re-foregrounds the kiosk, the page sees "visible"
  await t.test('coming back un-pauses the studio', async () => {
    // visibilityState is already "visible" here; the bar's own pausedFlag (set
    // only by a hub that really paused this kiosk) is what makes the event mean
    // "she is back" rather than an alt-tab.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(200);
    assert.equal(await page.evaluate(() => S.paused), false);
  });
  await page.close();
});

// A pause that only calls Speech.stop() is NOT a pause. stop() bumps the shared
// layer's generation and kills what is QUEUED (era-core speech.js:152) — but the
// studio's prompts are CHAINS of awaits (`await say(op); await say(sentence)`,
// studio.js startMakeWord, checkAttempt, the recap, the secret reveal). A
// cancelled utterance RESOLVES (sayLocal resolves on cancel), so the next line
// in the chain starts with a FRESH gen and plays at full volume — into a kiosk
// that is now minimized under TD Snap, straight over the top of her. The app's
// own say() has to be the door: paused means silent, full stop.
test('💬 silences the prompt chain that was already running', { timeout: 120000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"current":"","voices":[]}' }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.route('**/kiosk/pause', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"paused"}' }));
  let exits = 0;
  await page.route('**/kiosk/exit', r => { exits++; r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"closed"}' }); });
  await page.goto(BASE + '/');
  await sleep(800);
  await page.evaluate(() => window.__doorBar.setPause(true));

  // Drive a real word prompt, with a stand-in for the shared speech layer that
  // behaves the way the real one does under a barge-in: every line is recorded,
  // every line takes a beat, and a stopped line still RESOLVES — which is
  // exactly what marches the chain on to the line after it.
  await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    S.lesson = db.lessons.find(l => l.lesson === 1); S.tts = true;
    document.getElementById('adultBar').style.display = 'none';
    show('stage'); buildTray(S.lesson.letters, true);
    window.__says = [];
    Speech.say = (text) => { window.__says.push(text); return new Promise(r => setTimeout(r, 1200)); };
    S.wordIdx = 2;
    startMakeWord();          // deliberately NOT awaited: we interrupt it mid-line
  });
  await sleep(300);           // she is one line in — the operation, not the sentence

  const midLine = await page.evaluate(() => window.__says.slice());
  await t.test('the studio really is talking when she asks for the floor', () => {
    assert.equal(midLine.length, 1, JSON.stringify(midLine));
  });

  await page.click('#barTalk');
  await sleep(2500);          // longer than the whole rest of the chain

  await t.test('not one more word after 💬', async () => {
    const after = await page.evaluate(() => window.__says.slice());
    assert.deepEqual(after, midLine,
      'the studio spoke ' + JSON.stringify(after.slice(midLine.length)) + ' into TD Snap');
  });
  await t.test('and the studio is paused, still on her screen', async () => {
    assert.equal(await page.evaluate(() => S.paused), true);
    assert.equal(exits, 0);
  });
  await page.close();
});

// The strip is 9% of the viewport, recomputed by sizeBar(). Nothing recomputed
// it: after a viewport change the bar kept its mount-time height and --bar-h
// with it, while usableH()/vs() (studio.js:369) read the LIVE innerHeight — so
// the offset the app's chrome sits at and the scale its rows are drawn to
// disagreed. The Board (board.js:186) and the Pencil (pencil.js:554) both
// re-size on resize; the studio did not.
test('the bar re-sizes with the viewport', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"current":"","voices":[]}' }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.goto(BASE + '/');
  await sleep(800);
  const read = () => page.evaluate(() => ({
    h: window.innerHeight,
    want: window.EllieDoorBar.barHeight(window.innerHeight),
    barH: Math.round(parseFloat(getComputedStyle(document.body).getPropertyValue('--bar-h')) || 0),
    strip: Math.round(document.querySelector('.msgbar').getBoundingClientRect().height),
  }));
  const a = await read();
  assert.equal(a.barH, a.want, 'at mount: ' + JSON.stringify(a));
  assert.equal(a.strip, a.want, 'at mount: ' + JSON.stringify(a));

  await page.setViewportSize({ width: 1920, height: 1080 });
  await sleep(300);
  const b = await read();
  assert.notEqual(b.want, a.want, 'the two viewports must want different strips');
  assert.equal(b.barH, b.want, 'after resize: ' + JSON.stringify(b));
  assert.equal(b.strip, b.want, 'after resize: ' + JSON.stringify(b));
  await page.close();
});

// S.paused is ONE flag with TWO owners: the partner's ⏸ (studio.js:1291) and the
// 💬. If the bar's onResume clears it unconditionally, then partner ⏸ → she
// touches 💬 → hand-back leaves the lesson RUNNING with Dwell disabled and the
// partner button still reading "▶ resume". The bar must give back what it took,
// not what it assumed.
test('the partner strip and the bar stay in step', { timeout: 120000 }, async t => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"current":"","voices":[]}' }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.route('**/kiosk/pause', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"paused"}' }));
  await page.route('**/kiosk/exit', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"action":"closed"}' }));
  await page.goto(BASE + '/');
  await sleep(800);
  await page.evaluate(() => window.__doorBar.setPause(true));

  await t.test('a partner ⏸ survives a 💬 round trip', async () => {
    await page.evaluate(() => document.getElementById('pPause').click());   // touch-only strip
    assert.equal(await page.evaluate(() => S.paused), true);
    await page.click('#barTalk');
    await sleep(400);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await sleep(200);
    assert.equal(await page.evaluate(() => S.paused), true, 'the lesson restarted under a partner pause');
    assert.equal(await page.evaluate(() => document.getElementById('pPause').textContent), '▶ resume');
    assert.equal(await page.evaluate(() => window.Dwell.config.enabled), false);
    // and the partner's own button still ends the pause
    await page.evaluate(() => document.getElementById('pPause').click());
    assert.equal(await page.evaluate(() => S.paused), false);
    assert.equal(await page.evaluate(() => window.Dwell.config.enabled), true);
  });

  // The paused-means-silent door (studio.js say()) is aimed at CHAINED prompts —
  // the lines nobody asked for. An adult PRESS is the opposite, and a 🔁 that
  // answers with silence reads as a broken button. repeatPrompt() is the one
  // caller allowed through (sayNow); a 💬 pause can never reach it, because that
  // kiosk is minimized under TD Snap with no 🔁 to press.
  await t.test('🔁 still speaks while a partner holds the ⏸', async () => {
    const said = await page.evaluate(() => {
      window.__says = [];
      Speech.say = (text) => { window.__says.push(text); return Promise.resolve(); };
      document.getElementById('pPause').click();          // partner ⏸
      document.getElementById('pRepeat').click();         // …and 🔁 on top of it
      return { paused: S.paused, says: window.__says.slice() };
    });
    assert.equal(said.paused, true, 'the ⏸ did not take');
    assert.equal(said.says.length, 1, JSON.stringify(said.says));
    // …and the pause is still a pause for everything nobody pressed
    const chained = await page.evaluate(() => {
      window.__says = [];
      say('a line the studio chose to say');
      return window.__says.slice();
    });
    assert.deepEqual(chained, [], JSON.stringify(chained));
    await page.evaluate(() => document.getElementById('pPause').click());   // hand it back
    assert.equal(await page.evaluate(() => S.paused), false);
  });

  // Dad's ruling (spec §5.1): the two doors off the screen hold 2x her dwell,
  // everything else holds it exactly. tuneDwell() moved the ENGINE and left the
  // doors on whatever /settings last said — so a partner who slowed her down
  // handed her two doors that were now faster, relatively, than everything else.
  await t.test('tuning her dwell moves both doors with it', async () => {
    for (const ms of [1000, 1600]) {
      const got = await page.evaluate((target) => {
        Dwell.setMs(target - 200);      // tuneDwell adds the +200 step
        tuneDwell(+200);
        return { ms: Dwell.config.ms,
                 door: document.getElementById('barDoor').dataset.dwellMs,
                 talk: document.getElementById('barTalk').dataset.dwellMs };
      }, ms);
      assert.equal(got.ms, ms, JSON.stringify(got));
      assert.equal(got.door, String(2 * ms), JSON.stringify(got));
      assert.equal(got.talk, String(2 * ms), JSON.stringify(got));
    }
  });
  await page.close();
});
