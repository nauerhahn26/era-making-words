// Barge-in + rapid-answer regression: fast correct answers must advance exactly
// once each, never re-prompt the same word, never double-place. Lesson 44 (his repro).
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0; const check=(n,c,x)=>{ if(c){pass++;console.log('  PASS  '+n);}else{fail++;console.log('  FAIL  '+n+(x?'  ['+x+']':''));} };
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/log', r => r.fulfill({status:204,body:''}));
  await page.route('**/voices', r => r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false,"voices":[]}'}));
  await page.route('**/tts', r => r.fulfill({status:503,body:''}));
  await page.goto('http://127.0.0.1:8377/'); await sleep(1000);
  const t = await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    buildDict(db);
    S.lesson = db.lessons.find(l=>l.lesson===44); S.tts=false; S.part='all';
    show('stage'); S.sortType='rhyme'; S.sortCols=buildSortCols('rhyme');
    await startSort();
    const out = { placed: [], repeats: 0 };
    for (let g=0; g<8; g++) {
      const w = currentSortWord(); if (!w) { out.done = S.phase; break; }
      if (g === 0) out.firstPrompt = document.getElementById('promptSub').textContent;   // progress lives here now
      const ci = sortColumns().findIndex(c=>c.slice(1).map(x=>x.toLowerCase()).includes(w.toLowerCase()));
      // RAPID triple-fire on the same head (simulates gaze re-activation during speech)
      const before = S.sortIdx;
      pickColumn(ci); pickColumn(ci); pickColumn(ci);
      await new Promise(r=>setTimeout(r,450));
      if (S.sortIdx === before) out.repeats++;
      out.placed.push(w + ':' + (S.sortIdx - before));
    }
    out.colwords = document.querySelectorAll('.colword').length;
    out.expected = sortRemaining().length;
    return out;
  });
  check('every word advanced exactly once despite triple-fire', t.placed.every(p=>/:1$/.test(p)), JSON.stringify(t.placed));
  check('no duplicate placements', t.colwords === t.expected, `colwords=${t.colwords} expected=${t.expected}`);
  check('no stuck words', t.repeats === 0, 'repeats='+t.repeats);
  // Speech.stop exists and clears queue
  const st = await page.evaluate(() => typeof Speech.stop === 'function');
  check('Speech.stop (barge-in) exported', st);
  // no progress line and no separate gaze target: the tally chip went 7/28
  // (unreadable), the "Word 1 of N - read it in your head" sub-line went 9/3
  // (dad on the I-13: "remove all that text") - the pill alone is the sort screen.
  const noTally = await page.evaluate(() => !document.getElementById('tally'));
  check('no progress text, no separate gaze target', (t.firstPrompt || '') === '' && noTally, JSON.stringify({ firstPrompt: t.firstPrompt, noTally }));
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
