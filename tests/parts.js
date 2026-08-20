// Part-mode + adult-bar tests (repetition workflow)
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  await page.goto('http://127.0.0.1:8377/');
  await page.evaluate(() => Dwell.set({ ms: 250, graceMs: 120, decayMs: 250 }));
  await sleep(900);
  await page.evaluate(() => setPointer(1)); await sleep(300); posts.length = 0;   // full runway: idx = lesson-1, tests run on lesson 2

  console.log('A) adult bar: lesson pager (touch-only)');
  check('bar shows current lesson', (await page.textContent('#aLesson')).includes('Lesson'));
  check('bar is touch-only (no dwell)', await page.locator('#adultBar .dwell').count() === 0);
  await page.click('#aNext'); await sleep(400);
  check('next lesson label updated', (await page.textContent('#aLesson')).includes('3'), await page.textContent('#aLesson'));
  check('pointer persisted to server', posts.length === 1 && posts[0].pointer === 2, JSON.stringify(posts));
  await page.click('#aPrev'); await sleep(400);
  check('back to lesson 2', (await page.textContent('#aLesson')).includes('2'));

  console.log('B) sort-only day ends after sorting (no transfer, no make)');
  await page.click('.abtn.part[data-part="sort"]'); await sleep(200);
  const b = await page.locator('#btnStart').boundingBox();
  await page.mouse.move(b.x + b.width/2, b.y + b.height/2, { steps: 4 });
  await sleep(2400); await sleep(800);
  // dismiss the sort-type chooser (pick first card)
  if (await page.locator('#sBig.show #bigRow .action').count()) { await page.locator('#bigRow .action').first().click(); await sleep(800); }
  await sleep(2600);
  // sort now lives in the bottom full-bleed tray (8dde676): heads are .sorthead, no floating #cols
  check('went straight to sort (heads in tray)', await page.evaluate(() => S.phase === 'sort' && document.querySelectorAll('.sorthead').length > 0));
  check('no spelling letter-tray in sort-only', await page.locator('.letter[data-letter]').count() === 0);
  // finish sort via partner skips -> must END, not transfer
  await page.click('#partnerTab');
  for (let i = 0; i < 16; i++) { if (await page.locator('#sEnd.show').count()) break; await page.click('#pSkip'); await sleep(350); }
  check('sort-only ends at rating screen', await page.locator('#sEnd.show').count() === 1);

  console.log('C) transfer-only day: columns arrive pre-sorted');
  await page.reload(); await page.evaluate(() => Dwell.set({ ms: 250, graceMs: 120, decayMs: 250 })); await sleep(900);
  // jump pointer to a words-transfer lesson (32 = idx 31); /runway is mocked so real state is safe
  await page.evaluate(() => setPointer(31)); await sleep(300);
  await page.click('.abtn.part[data-part="transfer"]'); await sleep(200);
  await page.evaluate(() => { S.transferType = 'spell'; S.sortType='rhyme'; });
  const b2 = await page.locator('#btnStart').boundingBox();
  await page.mouse.move(b2.x + b2.width/2, b2.y + b2.height/2, { steps: 4 });
  await sleep(2400); await sleep(800);
  if (await page.locator('#sBig.show #bigRow .action').count()) { await page.locator('#bigRow .action').first().click(); await sleep(800); }
  await sleep(3000);
  const st = await page.evaluate(() => ({ phase: S.phase, model: document.querySelectorAll('#model .m').length, prompt: document.getElementById('promptText').textContent, colsHidden: document.getElementById('cols').style.display === 'none' }));
  check('transfer shows a model word (specialist-style)', st.phase === 'transfer' && st.model >= 2, JSON.stringify(st));
  check('transfer prompt is "Spell X", columns hidden', /^Spell /.test(st.prompt) && st.colsHidden, JSON.stringify(st));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
