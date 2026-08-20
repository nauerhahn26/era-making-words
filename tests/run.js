// Headless behavior tests for Making Words Studio v1.1 (post-review semantics).
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
  const logs = [];
  await page.route('**/log', async route => {
    logs.push(JSON.parse(route.request().postData()));
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/runway', r => r.fulfill({ status: 204, body: '' }));   // never touch the family's real pointer
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, current: '', voices: [] }) }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.goto('http://127.0.0.1:8377/');
  await page.evaluate(() => { Dwell.set({ ms: 90, graceMs: 500, decayMs: 700 }); });
  await sleep(900);
  await page.evaluate(() => setPointer(1));   // tests always run on lesson 2 (full runway: idx = lesson-1)
  await sleep(300);

  const gaze = async (sel, holdMs) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await sleep(holdMs || 1100);
  };
  const gazeLetter = async (L, holdMs) => gaze(`.letter[data-letter="${L}"]`, holdMs);
  const park = async () => { await page.mouse.move(960, 300, { steps: 4 }); await sleep(420); };

  console.log('A) boot + start screen');
  await sleep(900);
  check('lesson loaded', (await page.textContent('#startSub')).includes('letters'));
  check('rest spot removed (open space rests her eyes)', await page.locator('#rest').count() === 0);
  check('door long dwell', (await page.getAttribute('#door', 'data-dwell-ms')) === '2400');

  console.log('B) bottom-right empty space is safe to rest in');
  await page.mouse.move(1850, 1000, { steps: 4 }); await sleep(900);
  check('nothing activated from resting bottom-right', await page.locator('#sStart.show').count() === 1);

  console.log('C) start by gaze (includes TTS self-test path)');
  await gaze('#btnStart', 2400);
  await sleep(4200);   // TTS self-test timeout in headless (no voices) is 3s
  check('stage visible', await page.locator('#stage').isVisible());
  check('letters + backspace', await page.locator('.letter').count() >= 6);
  check('vowels tinted', await page.locator('.letter.vowel').count() >= 1);
  const ttsFailed = logs.some(l => l.event === 'tts_failed');
  if (ttsFailed) check('TTS fallback: banner shown + word on screen',
      await page.locator('#ttsWarn.show').count() === 1 &&
      (await page.textContent('#promptText')).toLowerCase().includes('as'),
      await page.textContent('#promptText'));
  else check('TTS available (no banner)', await page.locator('#ttsWarn.show').count() === 0);

  console.log('D) make word 1 "as"');
  await park(); await gazeLetter('a'); await park(); await gazeLetter('s'); await park();
  await sleep(2600);
  const a1 = logs.filter(l => l.event === 'attempt');
  check('attempt ok logged', a1.length >= 1 && a1[0].ok === true, JSON.stringify(a1[0] || {}));
  check('advanced to word 2', (await page.textContent('#promptSub')).includes('2 of'));

  console.log('E) letter persistence: word 2 "an" inherits the a');
  const lockedCount = await page.locator('.slot.locked').count();
  check('previous letter carried over (locked)', lockedCount === 1, 'locked=' + lockedCount);

  console.log('F) compare-and-fix: wrong letter keeps her correct work');
  await park(); await gazeLetter('d'); await park();     // "ad" instead of "an"
  await sleep(2200);
  check('first miss: NO model yet (two-strike, D50)', await page.locator('#model .m').count() === 0);
  check('correct letter kept (locked a)', await page.locator('.slot.locked').count() >= 1);
  check('mismatch slot neutral (dashed check)', await page.locator('.slot.check').count() === 1);
  const bad = logs.filter(l => l.event === 'attempt' && !l.ok);
  check('mismatch logged not punished', bad.length === 1 && bad[0].got === 'ad');
  await park(); await gazeLetter('n'); await park();
  await sleep(2600);
  check('fixed with ONE dwell, advanced to word 3', (await page.textContent('#promptSub')).includes('3 of'),
        await page.textContent('#promptSub'));

  console.log('G) backspace clears only unlocked slots');
  // word 3 "and": a,n locked; add wrong letter then backspace
  await park(); await gazeLetter('h'); await park();
  await sleep(300);
  await gaze('#backspace', 2400);
  await sleep(400);
  const lockedAfter = await page.locator('.slot.locked').count();
  const filledAfter = await page.locator('.slot.filled').count();
  check('locked letters survive backspace', lockedAfter === 2 && filledAfter === 2,
        'locked=' + lockedAfter + ' filled=' + filledAfter);

  console.log('H) invisible assessment flowing');
  const kinds = new Set(logs.map(l => l.event));
  check('latencies logged', logs.some(l => l.event === 'letter' && typeof l.sincePrompt === 'number'));
  check('lifecycle events', ['boot','session_start','word_start'].every(k => kinds.has(k)));

  console.log('I) partner strip: touch-only, phase-aware skip, closable');
  check('no .dwell inside strip', await page.locator('#partner .dwell').count() === 0);
  await page.click('#partnerTab');
  check('opens on touch', await page.locator('#partner.show').count() === 1);
  await page.click('#pSkip'); await sleep(700);
  check('skip logged with phase', logs.some(l => l.event === 'partner' && l.action === 'skip' && l.phase));
  await page.click('#pClose');
  check('closes via ✕', await page.locator('#partner.show').count() === 0);

  console.log('J) dwell floor: partner cannot set Midas-territory dwell');
  await page.click('#partnerTab');
  for (let i = 0; i < 6; i++) await page.click('#pFaster');
  const ms = await page.evaluate(() => Dwell.config.ms);
  check('floor at 800ms', ms >= 800, 'ms=' + ms);
  await page.click('#pClose');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
