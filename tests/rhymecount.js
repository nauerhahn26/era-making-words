// His report: rhyme sort offered only 2 words. Must be >=6 across runway lessons.
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
  for (const L of [2, 11, 21, 32, 44]) {
    const r = await page.evaluate(async (num) => {
      const db = await (await fetch('lessons.json')).json(); buildDict(db);
      S.lesson = db.lessons.find(l=>l.lesson===num); S.tts=false;
      S.sortType='rhyme'; S.sortCols=buildSortCols('rhyme'); sortSeq=null; S.sortIdx=0;
      const seq = sortRemaining();
      // every sortable word must actually rhyme with its column head
      const rime = s => (s.toLowerCase().match(/[aeiou].*$/)||[s])[0];
      const allRhyme = sortColumns().every(c => c.every(w => rime(w) === rime(c[0])));
      return { n: seq.length, heads: sortColumns().map(c=>c[0]), allRhyme, seq };
    }, L);
    check(`L${L}: rhyme sort has >=6 words (${r.n})`, r.n >= 6, JSON.stringify(r.seq));
    check(`L${L}: every column internally rhymes`, r.allRhyme, JSON.stringify(r.heads));
  }
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
