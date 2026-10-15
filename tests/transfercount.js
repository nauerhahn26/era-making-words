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
  for (const L of [2, 11, 32, 44]) {
    const r = await page.evaluate(async (num) => {
      const db = await (await fetch('lessons.json')).json(); buildDict(db);
      S.lesson = db.lessons.find(l=>l.lesson===num); S.tts=false;
      // spell-mode count
      S.spellWords = null;
      const spell = transferWords().length ? transferWords() : deriveFamilyWords();
      // first-letter count (mirror startTransfer's top-up)
      let flw = firstLetterWords().length ? firstLetterWords() : (transferWords().length ? transferWords() : deriveFamilyWords());
      if (flw.length && flw.length < 6) {
        const have = new Set(flw.map(w=>w.toLowerCase()));
        for (const w of deriveFamilyWords()) if(!have.has(w.toLowerCase())){flw.push(w);have.add(w.toLowerCase());}
        for (const w of S.lesson.make.map(x=>x.split('/')[0].trim())) { if(flw.length>=6)break; if(!have.has(w.toLowerCase())){flw.push(w);have.add(w.toLowerCase());} }
        flw = flw.slice(0,10);
      }
      return { spell: spell.length, fl: flw.length };
    }, L);
    check(`L${L}: spell transfer 4-6 words (${r.spell})`, r.spell>=4 && r.spell<=6, JSON.stringify(r));
    check(`L${L}: first-letter transfer 6-10 words (${r.fl})`, r.fl>=6 && r.fl<=10, JSON.stringify(r));
  }
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
