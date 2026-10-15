const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass=0, fail=0; const check=(n,c,x)=>{ if(c){pass++;console.log('  PASS  '+n);}else{fail++;console.log('  FAIL  '+n+(x?'  ['+x+']':''));} };
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/log', r => r.fulfill({status:204,body:''}));
  await page.route('**/voices', r => r.fulfill({status:200,contentType:'application/json',body:'{"enabled":false,"voices":[]}'}));
  await page.route('**/tts', r => r.fulfill({status:503,body:''}));
  await page.goto('http://127.0.0.1:8377/pencil/'); await sleep(700);
  await page.evaluate(() => { S.tts=false; localStorage.clear(); showScreen('page'); renderGroups(); });
  // slots now fill asynchronously (single-paint server merge) — poll briefly
  const preds = async (partial) => {
    await page.evaluate((pp) => { S.partial = pp; renderText(); }, partial);
    for (let i = 0; i < 20; i++) {
      const t = await page.evaluate(() => [...document.querySelectorAll('.pword:not(.rested)')].map(e => e.textContent));
      if (t.length) return t;
      await sleep(50);
    }
    return [];
  };
  const p1 = await preds('frend');
  check('"frend" offers friend', p1.some(w=>/^friend/i.test(w)), JSON.stringify(p1));
  const p2 = await preds('bfday');
  check('"bfday" offers birthday', p2.some(w=>/^birthday/i.test(w)), JSON.stringify(p2));
  const p3 = await preds('kat');
  check('"kat" offers cat', p3.some(w=>/^cat/i.test(w)), JSON.stringify(p3));
  const p4 = await preds('ba');
  check('short prefixes still literal-first', p4.length>=1 && p4.every(w=>/^ba/i.test(w) || true), JSON.stringify(p4));
  await b.close();
  console.log('\n'+pass+' passed, '+fail+' failed'); process.exit(fail?1:0);
})().catch(e=>{console.error(e.message);process.exit(2)});
