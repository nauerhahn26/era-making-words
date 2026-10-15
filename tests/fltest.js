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
    S.lesson = db.lessons.find(l=>l.lesson===2); S.tts=false; S.part='all';
    show('stage'); S.sortType='first-letter'; S.sortCols=buildSortCols('first-letter'); await startSort(); S.sortIdx = 999; S.transferType='first-letter'; await startTransfer();
    const out = { phase: S.phase, step: S.transferStep,
      heads: [...document.querySelectorAll('.sorthead')].map(h=>h.textContent),
      firstWord: firstLetterWords()[0] };
    // pick the correct first letter for word 1
    const w = firstLetterWords()[0];
    const letters = S.lesson.letters.map(l=>l.toLowerCase());
    await flPick(letters.indexOf(w[0].toLowerCase()));
    out.placed = [...document.querySelectorAll('.colword')].map(e=>e.textContent);
    // wrong pick on word 2 must not advance
    const w2 = firstLetterWords()[1];
    const wrongIdx = letters.findIndex(l => l !== w2[0].toLowerCase());
    await flPick(wrongIdx);
    out.afterWrong = FL.idx;
    return out;
  });
  check('first-letter transfer engaged (step 9)', t.phase==='transfer' && t.step===9, JSON.stringify({p:t.phase,s:t.step}));
  check('letter heads shown (5 lesson letters)', t.heads.length===5 && t.heads.every(h=>h.length===1), JSON.stringify(t.heads));
  check('real-world word placed under its letter', t.placed.length===1 && t.placed[0]===t.firstWord, JSON.stringify(t.placed));
  check('wrong pick does not advance (partial credit re-ask)', t.afterWrong===1, 'idx='+t.afterWrong);
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
