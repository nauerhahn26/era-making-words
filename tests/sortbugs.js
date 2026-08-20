// Regression for the photographed bugs: chosen-type consistency, non-grouped order,
// rhyming models only, target word never displayed. Lesson 44 (his exact repro).
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0; const check=(n,c,x)=>{ if(c){pass++;console.log('  PASS  '+n);}else{fail++;console.log('  FAIL  '+n+(x?'  ['+x+']':''));} };
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/log', r => r.fulfill({status:204,body:''}));
  await page.route('**/voices', r => r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false,"voices":[]}'}));
  await page.route('**/tts', r => r.fulfill({status:503,body:''}));
  await page.goto('http://127.0.0.1:8377/'); await sleep(900);

  // A) choose RHYME on L44 → title, chip, and heads must ALL be rhyme
  const a = await page.evaluate(async () => {
    const db = await (await fetch('lessons.json')).json(); buildDict(db);
    S.lesson = db.lessons.find(l=>l.lesson===44); S.tts=true; S.part='all';
    show('stage');
    const p = startSort();
    await new Promise(r=>setTimeout(r,300));
    const cards = [...document.querySelectorAll('#bigRow .action')];
    const dwellMs = cards.map(c=>c.getAttribute('data-dwell-ms'));
    cards.find(c=>/Rhyme/.test(c.textContent)).click();
    await p; await new Promise(r=>setTimeout(r,300));
    return { dwellMs,
      title: document.getElementById('promptText').textContent,
      chip: (document.getElementById('sortMethod')||{}).textContent || '',
      heads: [...document.querySelectorAll('.sorthead')].map(h=>h.textContent),
      seq: sortRemaining() };
  });
  check('chooser cards deliberate (2400ms — reading ≠ choosing)', a.dwellMs.every(d=>d==='2400'), JSON.stringify(a.dwellMs));
  check('title matches CHOSEN type (rhyme)', /rhyme/i.test(a.title), a.title);
  check('chip matches chosen type', /RHYME/.test(a.chip), a.chip);
  check('word heads, not letters', a.heads.every(h=>h.length>1), JSON.stringify(a.heads));
  // order: not grouped by column (no 3-run), shorter words first-ish
  const cols44 = await page.evaluate(() => sortColumns());
  const colOf = w => cols44.findIndex(c=>c.map(x=>x.toLowerCase()).includes(w.toLowerCase()));
  // interleave is best-effort when families are skewed: assert it's not answer-GROUPED —
  // adjacent same-family pairs must be under half the sequence
  let samePairs = 0;
  for (let i=1;i<a.seq.length;i++) if(colOf(a.seq[i])===colOf(a.seq[i-1])) samePairs++;
  check('sequence not answer-grouped (adjacent same-family pairs < half)', samePairs <= Math.floor(a.seq.length/2), JSON.stringify(a.seq)+' pairs='+samePairs);
  check('easier (shorter) words lead', a.seq[0].length <= a.seq[a.seq.length-1].length, JSON.stringify(a.seq));

  // B) transfer models must rhyme; target word hidden when TTS on
  const bres = await page.evaluate(async () => {
    S.sortIdx = 999; S.transferType='spell';
    await startTransfer();
    const out = [];
    for (let g=0; g<4; g++) {
      const w = currentTransferWord(); if (!w) break;
      const model = [...document.querySelectorAll('#model .m')].map(m=>m.textContent).join('') || null;
      out.push({ w, model,
        title: document.getElementById('promptText').textContent,
        sub: document.getElementById('promptSub').textContent });
      for (const ch of w) await pickLetter(ch);
      await new Promise(r=>setTimeout(r,150));
    }
    return out;
  });
  const rime = s => (s.toLowerCase().match(/[aeiou].*$/)||[s])[0];
  check('every model RHYMES with its target', bres.every(x=>x.model && rime(x.model)===rime(x.w)), JSON.stringify(bres.map(x=>x.w+'<-'+x.model)));
  check('target word NEVER displayed (title)', bres.every(x=>!x.title.toLowerCase().includes(x.w.toLowerCase())), JSON.stringify(bres.map(x=>x.title)));
  check('target word NEVER displayed (sub)', bres.every(x=>!x.sub.toLowerCase().includes(x.w.toLowerCase())), JSON.stringify(bres.map(x=>x.sub)));
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
