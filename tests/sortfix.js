// Regression: the stuck-sort bug + the new type toggle, driven on lesson 11.
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

  // A) chooser appears; pick FIRST LETTER; head-words must sort and ADVANCE (the bug)
  const a = await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    buildDict(db);
    S.lesson = db.lessons.find(l=>l.lesson===11); S.tts=false; S.part='all';
    show('stage');
    const p = startSort();                       // opens chooser
    await new Promise(r=>setTimeout(r,300));
    const chooser = [...document.querySelectorAll('#bigRow .action')].map(e=>e.textContent);
    document.querySelectorAll('#bigRow .action')[0].click();   // "First letter"
    await p; await new Promise(r=>setTimeout(r,200));
    const out = { chooser, heads: [...document.querySelectorAll('.sorthead')].map(h=>h.textContent) };
    // sort every word by always picking its correct letter column
    out.progress = [];
    for (let g=0; g<12; g++) {
      const w = currentSortWord(); if (!w) { out.progress.push('DONE:'+S.phase); break; }
      const heads = sortHeads();
      const idx = heads.indexOf(w[0].toLowerCase());
      const before = S.sortIdx;
      await pickColumn(idx);
      await new Promise(r=>setTimeout(r,400));   // human-scale gap (anti-double-fire lock is 350ms)
      out.progress.push(w + (S.sortIdx===before+1 ? ' ✓' : ' STUCK'));
      if (S.sortIdx === before) break;
    }
    return out;
  });
  check('chooser offered both types (native starred)', a.chooser.length===2 && a.chooser.some(t=>/First letter ★/.test(t)), JSON.stringify(a.chooser));
  check('letter heads rendered', a.heads.every(h=>h.length===1), JSON.stringify(a.heads));
  const stuck = a.progress.filter(p=>/STUCK/.test(p));
  check('EVERY word advances (bug fixed) — incl. head words', stuck.length===0 && a.progress.some(p=>/DONE/.test(p)), JSON.stringify(a.progress));

  // B) same lesson, choose RHYME on a natively first-letter lesson (derived columns)
  await page.reload(); await sleep(1000);
  const bres = await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json();
    buildDict(db);
    S.lesson = db.lessons.find(l=>l.lesson===11); S.tts=false; S.part='all';
    show('stage');
    const p = startSort();
    await new Promise(r=>setTimeout(r,300));
    document.querySelectorAll('#bigRow .action')[1].click();   // "Rhyme"
    await p; await new Promise(r=>setTimeout(r,200));
    return { heads: [...document.querySelectorAll('.sorthead')].map(h=>h.textContent),
             remaining: sortRemaining(), type: S.sortType };
  });
  check('rhyme mode derived word-heads on a first-letter lesson', bres.type==='rhyme' && bres.heads.every(h=>h.length>1), JSON.stringify(bres.heads));
  check('rhyme mode has words to sort', bres.remaining.length>=1, JSON.stringify(bres.remaining));
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
