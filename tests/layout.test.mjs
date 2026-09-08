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
// Two shapes to find the files in: this repo's own checkout (tests/ → ../app),
// and the parity gate, which flattens every repo's tests into era-hub/gate/ —
// from there the sibling repo is ../../era-making-words and era-core's shared
// assets are reachable through era-hub's assembled public/ (tools/assemble.sh).
const REPO = pick([path.join(HERE, ".."), path.join(HERE, "..", "..", "era-making-words")], "app/studio.js");
const APP_DIR = REPO && path.join(REPO, "app");
const CORE_DIR = pick([REPO && path.join(REPO, "..", "era-core"), path.join(HERE, "..", "public")], "dwell.js");
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
    if (req.method !== "GET") { req.resume(); return p === "/kiosk/exit" ? done(200, '{"action":"none"}', MIME[".json"]) : done(204, ""); }
    if (p === "/settings") return done(200, '{"dwellMs":1200}', MIME[".json"]);
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
    '#tray .letter, #parkPad, #door, #replay, #sortword, .colstack .colword')].filter(vis);
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
  const over = [document.querySelector('#prompt > div'), document.getElementById('door'),
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

  return { outside, overlap, skew, cramped, spill, targets, heads, declared, actual,
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
const DOOR = { w: 170, h: 110 };
const undersized = a => a.targets.filter(t => t.tray
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
