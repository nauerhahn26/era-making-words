// layout.js — the screen must FIT. Nothing overflows, nothing overprints.
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
// Prereq: the studio served locally →  node ../server.js 8377
// Override the origin with ERA_BASE (e.g. a scratch hub on 8466+).
const { chromium } = require('playwright');

const BASE = process.env.ERA_BASE || 'http://127.0.0.1:8377';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}

const VIEWPORTS = [
  { width: 1280, height: 720 }, { width: 1280, height: 672 },
  { width: 1920, height: 1080 }, { width: 1920, height: 1032 }, { width: 1920, height: 1040 },
  { width: 1536, height: 864 },
];

// The three screens in dad's photos + the worst case the lesson file can throw.
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
    '#tray .letter, #parkPad, #door, #replay, .colhead, #sortword')].filter(vis);
  const outside = [];
  for (const el of onScreen) {
    const r = el.getBoundingClientRect(), o = [];
    if (r.bottom > H + 0.5) o.push('below+' + Math.round(r.bottom - H));
    if (r.top < -0.5) o.push('above' + Math.round(r.top));
    if (r.right > W + 0.5) o.push('right+' + Math.round(r.right - W));
    if (r.left < -0.5) o.push('left' + Math.round(r.left));
    if (o.length) outside.push(nm(el) + ' ' + o.join(','));
  }

  // 2. the prompt block and the fixed chrome never overprint a tile row
  const overlap = [];
  const rows = [...document.querySelectorAll('#model .m, #slots .slot, #tray .letter, #parkPad, .colhead')].filter(vis);
  const hit = (a, b, an, bn) => {
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) overlap.push(an + ' over ' + bn + ' by ' + Math.round(ox) + 'x' + Math.round(oy));
  };
  const over = [document.querySelector('#prompt > div'), document.getElementById('door'),
                document.getElementById('replay')].filter(e => e && vis(e));
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
  //    real Segoe UI line box (~1.34em) — not the nominal font size.
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

  // 5. gaze targets stay big. The smallest one she can look at, in px.
  const targets = [...document.querySelectorAll('.dwell')].filter(vis)
    .map(e => { const r = e.getBoundingClientRect(); return { n: e.id || e.textContent.slice(0, 4), w: Math.round(r.width), h: Math.round(r.height) }; });
  targets.sort((a, b) => a.w * a.h - b.w * b.h);

  // 6. the letter band keeps the 30%-of-screen contract it declares (it used to
  //    be flex-shrunk below it, which is how the bottom of the row went missing)
  const tray = document.getElementById('tray');
  const declared = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--trayH')) || 0;
  const actual = tray ? Math.round(tray.getBoundingClientRect().height) : 0;

  return { outside, overlap, skew, cramped, targets: targets.slice(0, 3), declared, actual,
           hScroll: document.documentElement.scrollWidth > W + 1 };
};

(async () => {
  const browser = await chromium.launch();
  for (const vp of VIEWPORTS) {
    const tag = vp.width + 'x' + vp.height;
    console.log('\n' + tag);
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
      check(name + ': everything on screen', a.outside.length === 0, a.outside.join('; '));
      check(name + ': nothing overprints a tile row', a.overlap.length === 0, a.overlap.join('; '));
      check(name + ': tiles share a top edge', a.skew.length === 0, a.skew.join('; '));
      check(name + ': letters fit their tiles', a.cramped.length === 0, a.cramped.join('; '));
      check(name + ': no horizontal scroll', !a.hScroll);
      // the letter band is her biggest target; it must not be flex-shrunk away
      check(name + ': letter band keeps its declared height',
            Math.abs(a.actual - a.declared) <= 1, 'declared=' + a.declared + ' actual=' + a.actual);
      // gaze floor: nothing she looks at is smaller than the door, the smallest
      // target the original ever drew (170x110 at every viewport).
      const small = a.targets[0];
      check(name + ': smallest gaze target >= 170x110', small && small.w >= 170 && small.h >= 110,
            JSON.stringify(a.targets));
    }
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
