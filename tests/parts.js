// Part-mode + adult-bar tests (repetition workflow)
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Waits out a condition the routed requests decide (`posts` fills in THIS process).
// A timeout falls through to the checks, which then say what never arrived.
const until = async (cond, ms) => { const end = Date.now() + ms; while (!(await cond()) && Date.now() < end) await sleep(50); };
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  [' + x + ']' : '')); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const posts = [];
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => { posts.push(JSON.parse(r.request().postData())); r.fulfill({ status: 204, body: '' }); });
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, current: '', voices: [] }) }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  // Page-side waits; a timeout falls through to the checks.
  const waitFor = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms }).catch(() => {});
  const booted = () => waitFor(() => S.lesson && runwayCfg, null, 5000);   // boot loaded the lessons + runway
  // A viewport change resizes the door bar from its resize handler, which runs in
  // the next frames: wait for the new size, then two frames.
  const resize = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(([w, h]) => new Promise(done => {
      let n = 0;
      const tick = () => (innerWidth === w && innerHeight === h) || ++n > 60
        ? requestAnimationFrame(() => requestAnimationFrame(done)) : requestAnimationFrame(tick);
      tick();
    }), [width, height]);
  };
  const chooserUp = () => page.locator('#sBig.show #bigRow .action').count();
  await page.goto('http://127.0.0.1:8377/');
  await page.evaluate(() => Dwell.set({ ms: 250, graceMs: 120, decayMs: 250 }));
  await booted();
  await page.evaluate(() => setPointer(1));   // full runway: idx = lesson-1, tests run on lesson 2
  await until(() => posts.length >= 1, 1000); posts.length = 0;   // its /runway POST has landed: start A from zero

  console.log('A) adult bar: lesson pager (touch-only)');
  check('bar shows current lesson', (await page.textContent('#aLesson')).includes('Lesson'));
  check('bar is touch-only (no dwell)', await page.locator('#adultBar .dwell').count() === 0);
  await page.click('#aNext');
  await until(() => posts.length >= 1, 1000);
  check('next lesson label updated', (await page.textContent('#aLesson')).includes('3'), await page.textContent('#aLesson'));
  check('pointer persisted to server', posts.length === 1 && posts[0].pointer === 2, JSON.stringify(posts));
  await page.click('#aPrev');
  await waitFor(() => document.getElementById('aLesson').textContent.includes('2'), null, 1000);
  check('back to lesson 2', (await page.textContent('#aLesson')).includes('2'));

  console.log('B) sort-only day ends after sorting (no transfer, no make)');
  await page.click('.abtn.part[data-part="sort"]');   // synchronous: S.part, then the start screen
  const b = await page.locator('#btnStart').boundingBox();
  await page.mouse.move(b.x + b.width/2, b.y + b.height/2, { steps: 4 });
  // the dwell starts it; /settings and the speech self-test (capped at 3 s) run,
  // then a sort-only day asks how to sort
  await waitFor(() => document.querySelector('#sBig.show #bigRow .action') || S.phase === 'sort', null, 6000);
  // dismiss the sort-type chooser (pick first card)
  if (await chooserUp()) await page.locator('#bigRow .action').first().click();
  await waitFor(() => S.phase === 'sort' && document.querySelectorAll('.sorthead').length > 0, null, 3400);
  // sort now lives in the bottom full-bleed tray (8dde676): heads are .sorthead, no floating #cols
  check('went straight to sort (heads in tray)', await page.evaluate(() => S.phase === 'sort' && document.querySelectorAll('.sorthead').length > 0));
  check('no spelling letter-tray in sort-only', await page.locator('.letter[data-letter]').count() === 0);
  // finish sort via partner skips -> must END, not transfer
  await page.click('#partnerTab');
  for (let i = 0; i < 16; i++) {
    if (await page.locator('#sEnd.show').count()) break;
    await page.click('#pSkip');
    // ready for the next skip (a word is up) or done: the last skip runs the sort
    // recap and ends the lesson. Never skip into a recap still running.
    await waitFor(() => document.querySelector('#sEnd.show') || (S.phase === 'sort' && currentSortWord()), null, 2000);
  }
  check('sort-only ends at rating screen', await page.locator('#sEnd.show').count() === 1);
  // dad 9/3 on the I-13 (1280x720 CSS px): "not enough space for too easy, just
  // right" - the three tiles must sit whole on the screen, under the adult bar
  await resize(1280, 720);
  const fit = await page.evaluate(() => {
    const bar = document.getElementById('adultBar').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('#sEnd .action')].map(t => t.getBoundingClientRect());
    const title = document.querySelector('#sEnd .title').getBoundingClientRect();
    return { n: tiles.length, titleBelowBar: title.top >= bar.bottom,
             inside: tiles.every(r => r.top >= bar.bottom && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth),
             gap: Math.min(...tiles.slice(1).map((r, i) => r.top - tiles[i].bottom)),
             font: getComputedStyle(document.querySelector('#sEnd .action')).fontSize };
  });
  check('end screen: three whole tiles on a 1280x720 kiosk, below the adult bar', fit.n === 3 && fit.inside && fit.titleBelowBar, JSON.stringify(fit));
  check('end screen: tiles keep the 74px floor and real separation', parseFloat(fit.font) >= 74 && fit.gap >= 20, JSON.stringify(fit));
  await resize(1920, 1080);
  // ...and rating is not a dead end: "I could not move on to transfer/make, I had to exit"
  // the rating holds the end screen 2 s (studio.js backToStart timer), then the start screen
  await page.locator('#sEnd .action[data-rate="right"]').click();
  await waitFor(() => S.phase === 'start', null, 3200);
  const after = await page.evaluate(() => ({ phase: S.phase, start: document.getElementById('sStart').classList.contains('show'),
    bar: getComputedStyle(document.getElementById('adultBar')).display, btn: document.getElementById('btnStart').textContent,
    op: document.getElementById('btnStart').style.opacity, starting: S.starting }));
  check('after rating: back on the start screen with the adult bar', after.phase === 'start' && after.start && after.bar === 'flex', JSON.stringify(after));
  check('after rating: "Let\'s play" is fresh (text + opacity + state reset)', /play/.test(after.btn) && after.op === '' && !after.starting, JSON.stringify(after));
  // the adult bar's part buttons pick the next part and land on the start screen right away
  await page.evaluate(() => { S.phase = 'end'; show('sEnd'); });
  await page.click('.abtn.part[data-part="transfer"]');
  await waitFor(() => S.phase === 'start' && S.part === 'transfer', null, 1000);
  check('adult "transfer" on the end screen goes to the start screen', await page.evaluate(() => S.phase === 'start' && S.part === 'transfer' && document.getElementById('sStart').classList.contains('show')));

  console.log('C) transfer-only day: columns arrive pre-sorted');
  await page.reload(); await page.evaluate(() => Dwell.set({ ms: 250, graceMs: 120, decayMs: 250 }));
  await booted();   // setPointer needs boot's runway
  // jump pointer to a words-transfer lesson (32 = idx 31); /runway is mocked so real state is safe
  await page.evaluate(() => setPointer(31));
  await page.click('.abtn.part[data-part="transfer"]');
  await page.evaluate(() => { S.transferType = 'spell'; S.sortType='rhyme'; });
  const b2 = await page.locator('#btnStart').boundingBox();
  await page.mouse.move(b2.x + b2.width/2, b2.y + b2.height/2, { steps: 4 });
  // the start pre-sorts the columns and opens the first transfer word (a chooser
  // or a placard would show in #sBig instead)
  await waitFor(() => document.querySelector('#sBig.show #bigRow .action') || S.phase === 'transfer', null, 6000);
  if (await chooserUp()) await page.locator('#bigRow .action').first().click();
  await waitFor(() => S.phase === 'transfer' && S.transferStep === 1, null, 3800);
  const st = await page.evaluate(() => ({ phase: S.phase, model: document.querySelectorAll('#model .m').length, prompt: document.getElementById('promptText').textContent, colsHidden: document.getElementById('cols').style.display === 'none' }));
  check('transfer shows a model word (specialist-style)', st.phase === 'transfer' && st.model >= 2, JSON.stringify(st));
  check('transfer prompt is "Spell X", columns hidden', /^Spell /.test(st.prompt) && st.colsHidden, JSON.stringify(st));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
