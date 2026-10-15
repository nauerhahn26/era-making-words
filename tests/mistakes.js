// TWO-STRIKE ANSWER REVEAL (dad 8/9, D50) — real-UI walk on lesson 2, word "as".
// Strike one: her correct letters stay locked, NO model word, dashed gaps, retry.
// Strike two: the model word appears for compare-and-fix. Then the fix advances.
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));   // never touch the family's real pointer
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, current: '', voices: [] }) }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.goto('http://127.0.0.1:8377/');
  await page.evaluate(() => { Dwell.set({ ms: 90, graceMs: 500, decayMs: 700 }); });
  await sleep(900);
  await page.evaluate(() => setPointer(1));   // lesson 2: letters a d h n s; make[0] = "as"
  await sleep(300);

  const gaze = async (sel, holdMs) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await sleep(holdMs || 1100);
  };
  const gazeLetter = async (L) => gaze(`.letter[data-letter="${L}"]`);
  const park = async () => { await page.mouse.move(960, 300, { steps: 4 }); await sleep(420); };

  await gaze('#btnStart', 2400);
  await sleep(4200);                               // TTS self-test timeout in headless
  await page.evaluate(() => { S.tts = false; if (window.Speech) Speech.stop(); });
  check('make phase, word 1 is "as"', await page.evaluate(() => S.phase === 'make' && currentWord() === 'as'));

  console.log('A) strike one — wrong attempt "ds": no answer shown, her "s" kept');
  await gazeLetter('d'); await park();
  await gazeLetter('s'); await park();
  await sleep(400);
  const s1 = await page.evaluate(() => ({
    misses: S.misses, fixing: S.fixing, phase: S.phase, wordIdx: S.wordIdx,
    modelCount: document.querySelectorAll('#model .m').length,
    locked: [...document.querySelectorAll('#slots .slot.locked')].map(s => s.textContent),
    dashed: document.querySelectorAll('#slots .slot.check').length
  }));
  check('first miss counted, in fix mode, word untouched',
    s1.misses === 1 && s1.fixing && s1.phase === 'make' && s1.wordIdx === 0, JSON.stringify(s1));
  check('NO model word after first miss', s1.modelCount === 0, JSON.stringify(s1));
  check('her correct letter locked in place (the "AT of SAT" rule)',
    s1.locked.length === 1 && s1.locked[0].toLowerCase() === 's', JSON.stringify(s1.locked));
  check('missing slot dashed-neutral', s1.dashed === 1, String(s1.dashed));

  console.log('B) strike two — wrong again ("hs"): now the model appears');
  await gazeLetter('h'); await park();
  await sleep(400);
  const s2 = await page.evaluate(() => ({
    misses: S.misses, phase: S.phase, wordIdx: S.wordIdx,
    model: [...document.querySelectorAll('#model .m')].map(m => m.textContent).join('')
  }));
  check('second miss counted, still on the same word',
    s2.misses === 2 && s2.phase === 'make' && s2.wordIdx === 0, JSON.stringify(s2));
  check('model word revealed on second miss', s2.model.toLowerCase() === 'as', s2.model);

  console.log('C) the fix — correct fill advances, miss count resets for the next word');
  await gazeLetter('a'); await park();
  await sleep(1200);                               // celebrate-then-advance window
  const s3 = await page.evaluate(() => ({ wordIdx: S.wordIdx, misses: S.misses, phase: S.phase }));
  check('advanced to word 2 with a fresh miss count',
    s3.wordIdx === 1 && s3.misses === 0 && s3.phase === 'make', JSON.stringify(s3));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
