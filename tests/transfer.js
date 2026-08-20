// P0-1 regression: a misspelled TRANSFER word must stay in transfer (no wordIdx
// touch, no sort restart, no "jumping" resurrection). Driven on real lesson 32.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? '  [' + x + ']' : '')); } };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/log', r => r.fulfill({ status: 204, body: '' }));
  await page.route('**/voices', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, current: '', voices: [] }) }));
  await page.route('**/tts', r => r.fulfill({ status: 503, body: '' }));
  await page.goto('http://127.0.0.1:8377/');
  await sleep(800);
  // jump straight into lesson 32's transfer phase
  const state = await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    S.lesson = db.lessons.find(l => l.lesson === 32);
    S.tts = false;                       // silence; words on screen
    show('stage'); S.sortType='rhyme'; S.sortCols=buildSortCols('rhyme');
    await startSort();                   // builds real sort columns + heads
    S.sortIdx = 999;                     // sort finished
    S.transferType='spell'; await startTransfer();
    return { phase: S.phase, words: transferWords(), cols: sortColumns().length };
  });
  check('entered transfer with real words', state.phase === 'transfer' && state.words.length > 0, JSON.stringify(state));

  const result = await page.evaluate(async () => {
    const w = currentTransferWord();
    // force spelling step with a wrong attempt, bypassing geometry
    S.transferStep = 1; S.misses = 0;
    renderSlotsFrom(w, null);
    for (let i = 0; i < w.length; i++) S.attempt[i] = 'z';        // all wrong
    document.querySelectorAll('#slots .slot').forEach(s => { s.textContent = 'z'; s.classList.add('filled'); });
    const beforeIdx = S.transferIdx, beforeWordIdx = S.wordIdx;
    await checkAttempt(w);
    const modelText = [...document.querySelectorAll('#model .m')].map(m => m.textContent).join('');
    return {
      phase: S.phase, fixing: S.fixing, misses: S.misses,
      transferIdxSame: S.transferIdx === beforeIdx,
      wordIdxSame: S.wordIdx === beforeWordIdx,
      answerHidden: modelText.toLowerCase() !== w.toLowerCase(),
      slotsNeutral: document.querySelectorAll('#slots .slot.check').length === w.length,
      promptText: document.getElementById('promptText').textContent
    };
  });
  check('stays in transfer phase', result.phase === 'transfer', result.phase);
  check('transferIdx untouched', result.transferIdxSame);
  check('make-ladder wordIdx untouched (no jumping resurrection)', result.wordIdxSame);
  check('FIRST miss: answer NOT revealed (two-strike, D50)', result.answerHidden && result.misses === 1, JSON.stringify(result));
  check('all slots neutral dashed (never red)', result.slotsNeutral);
  check('no sort restart (prompt unchanged)', !/Sort the words/i.test(result.promptText), result.promptText);

  // second wrong attempt on the SAME word -> now the model appears for compare-and-fix
  const second = await page.evaluate(async () => {
    const w = currentTransferWord();
    for (let i = 0; i < w.length; i++) if (S.attempt[i] === null) {
      S.attempt[i] = 'z';
      const s = document.querySelectorAll('#slots .slot')[i];
      s.textContent = 'z'; s.classList.add('filled');
    }
    await checkAttempt(w);
    const modelText = [...document.querySelectorAll('#model .m')].map(m => m.textContent).join('');
    return { misses: S.misses, modelShown: modelText.toLowerCase() === w.toLowerCase(),
             stillTransfer: S.phase === 'transfer' };
  });
  check('SECOND miss: model held for fixing', second.modelShown && second.misses === 2 && second.stillTransfer, JSON.stringify(second));

  // now fix it correctly and confirm it advances WITHIN transfer
  const adv = await page.evaluate(async () => {
    const w = currentTransferWord();
    for (let i = 0; i < w.length; i++) if (S.attempt[i] === null) S.attempt[i] = w[i];
    const before = S.transferIdx;
    await checkAttempt(w);
    return { advanced: S.transferIdx === before + 1 || S.phase === 'end', phase: S.phase };
  });
  check('correct fix advances within transfer', adv.advanced, JSON.stringify(adv));

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
