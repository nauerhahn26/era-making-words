// Regression: the letter row must NEVER wrap, even on scaled viewports (photo bug).
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  [' + x + ']' : '')); } };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 1280, height: 720 }, { width: 1536, height: 864 }, { width: 1920, height: 1080 }]) {
    const page = await browser.newPage({ viewport: vp });
    await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
    await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));
    await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false,"voices":[]}' }));
    await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
    await page.goto('http://127.0.0.1:8377/');
    await page.evaluate(() => Dwell.set({ ms: 250, graceMs: 120, decayMs: 250 }));
    await sleep(900);
    await page.evaluate(() => setPointer(1));   // lesson 11 "clamps": 6 letters + backspace = 7 tray items
    await sleep(300);
    const b = await page.locator('#btnStart').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await sleep(2400); await sleep(3600);
    const geo = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#tray .letter')];
      // one row = all vertical CENTERS within 40px (backspace is shorter but centered)
      const cys = items.map(e => { const r = e.getBoundingClientRect(); return r.top + r.height/2; });
      const oneRow = Math.max(...cys) - Math.min(...cys) < 40;
      const rightmost = Math.max(...items.map(e => e.getBoundingClientRect().right));
      return { count: items.length, rows: oneRow ? 1 : 2, rightmost, vw: innerWidth,
               onscreen: rightmost <= innerWidth };
    });
    check(`${vp.width}px: ${geo.count} tray items on ONE row, all on-screen`,
          geo.rows === 1 && geo.onscreen, JSON.stringify(geo));
    // sort phase geometry on the same lesson (the second photo bug)
    await page.evaluate(() => { S.sortType='first-letter'; S.sortCols=buildSortCols('first-letter'); S.sortIdx = 0; startSort(); });
    await sleep(700);
    const sg = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.sorthead')];
      const rects = heads.map(e => e.getBoundingClientRect());
      return { heads: heads.length,
               leftOk: Math.min(...rects.map(r => r.left)) >= 0,
               rightOk: Math.max(...rects.map(r => r.right)) <= innerWidth,
               chips: document.querySelectorAll('#alsoMade .chip').length };
    });
    // video tuning: first-letter sorts use LETTER heads — every column live, no chips
    check(`${vp.width}px: sort heads all on-screen (${sg.heads} letter heads)`,
          sg.leftOk && sg.rightOk && sg.heads >= 2 && sg.heads <= 8, JSON.stringify(sg));
    await page.close();
  }
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
