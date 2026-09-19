// Run with Playwright installed, or set BOM_PLAYWRIGHT to its package path.
// Live integration reads public catalogue data; all mutation requests are blocked.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOM_PLAYWRIGHT || 'playwright');
const fs = require('node:fs/promises');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
(async () => {
 const server = http.createServer(async (req,res) => {try {const path = root + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]); const content = await fs.readFile(path); res.setHeader('Content-Type', path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/octet-stream'); res.end(content);}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({headless:true});
 try {
 const page = await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 await page.route('**/*', async route => { if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) return route.abort(); return route.continue(); });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.BOMPresentationBridge && document.querySelector('#bomV1Search'));
 await page.locator('#bomV1Search').fill('ra');
 await page.waitForSelector('.bom-v1-suggestion',{timeout:60000});
 console.log('LIVE suggestions', await page.locator('.bom-v1-suggestion').allTextContents());
 const live = await page.evaluate(async()=> {const data=await window.BOMPresentationBridge.getSearchCatalogue(); return {count:data.length,kinds:[...new Set(data.map(x=>x.kind))]};});
 console.log('LIVE catalogue',live);
 await page.screenshot({path:`${tmpdir()}/bom-desktop.png`});
 for (const width of [390,320]) {
  await page.setViewportSize({width,height:844});
  await page.locator('#bomV1Search').fill('ra');
  await page.waitForSelector('.bom-v1-suggestion');
  const layout=await page.evaluate(()=>{const p=document.querySelector('.bom-v1-suggestions').getBoundingClientRect(); const f=document.querySelector('.bom-v1-search').getBoundingClientRect();return {left:p.left,right:p.right,top:p.top,fieldBottom:f.bottom,overflow:document.documentElement.scrollWidth>innerWidth,tap:document.querySelector('.bom-v1-suggestion').getBoundingClientRect().height};});
  assert.ok(layout.left>=0 && layout.right<=width,JSON.stringify(layout)); assert.equal(layout.overflow,false);assert.ok(layout.tap>=44);assert.ok(layout.top>=layout.fieldBottom);
  await page.setViewportSize({width,height:420});
  await page.waitForTimeout(100);
  const bounds=await page.locator('.bom-v1-suggestions').boundingBox(); assert.ok(bounds.y+bounds.height<=421,JSON.stringify(bounds));
  await page.screenshot({path:`${tmpdir()}/bom-mobile-${width}.png`});
 }
 console.log('LIVE desktop/mobile layout and reduced keyboard viewport passed; page errors:',errors);
 // Exercise real navigation adapters with production writes blocked.
 await page.route('https://musicbrainz.org/**', route => route.fulfill({ json: { artists: [], releases: [], recordings: [], 'release-groups': [] } }));
 await page.setViewportSize({width:390,height:844});
 for (const kind of ['Album', 'Track', 'Artist']) {
  const title = await page.evaluate(async kind => (await window.BOMPresentationBridge.getSearchCatalogue()).find(item => item.kind === kind).title, kind);
  await page.locator('#bomV1Search').fill(title);
  const option = page.locator('.bom-v1-suggestion').filter({has:page.locator('small', {hasText: new RegExp(`^${kind}$`)})}).first();
  await option.waitFor(); await option.click();
  await page.waitForFunction(() => !document.querySelector('#detailSection').classList.contains('hidden'));
  await page.waitForFunction(title => document.querySelector('#selectedItemDetail')?.textContent.includes(title), title, {timeout:30000});
  assert.equal(await page.locator('#bomV1Search').getAttribute('aria-expanded'), 'false');
 }
 await page.locator('#bomV1Search').fill('NoSuchCatalogueResult');
 await page.locator('#bomV1Search').press('Enter');
 await page.waitForSelector('[data-bom-search]');
 await page.waitForFunction(() => document.querySelector('[data-bom-search]')?.textContent.includes('No results found.'));
 console.log('PASS real artist/album/track detail adapters and submitted full-search fallback');

 // Deterministic controller checks retain the actual shell, assets and submission handler.
 await page.evaluate(()=> {
  const input=document.querySelector('#bomV1Search'), form=input.closest('form');
  const clone=form.cloneNode(true);form.replaceWith(clone);clone.querySelector('.bom-v1-suggestions').remove();
  window.testCalls=0; window.testOpened=[];window.testSubmitted=0;
  window.testCatalogue=window.BOMAutocomplete.buildCatalogue(Array.from({length:12},(_,id)=>({id,title:`Radio ${id}`,artist:'Radiohead'})),[{id:99,title:'Paranoid Android',artist:'Radiohead',album_id:0}],()=> '');
  window.BOMAutocomplete.attach(clone.querySelector('input'),clone,{load:async()=>{window.testCalls++;const delay=window.testDelay || 0;await new Promise(r=>setTimeout(r,delay));return window.testCatalogue;},open:item=>window.testOpened.push(item.kind)});
  clone.addEventListener('submit',e=>{e.preventDefault();window.testSubmitted++;});
 });
 const input=page.locator('#bomV1Search');
 await input.fill('r');await page.waitForTimeout(220);assert.equal(await page.evaluate(()=>testCalls),0);
 await input.fill('ra');await input.fill('rad');await input.fill('radio');await page.waitForTimeout(240);assert.equal(await page.evaluate(()=>testCalls),1);
 assert.equal(await page.locator('[role=option]').count(),8);
 await input.fill('Radio 0');await page.waitForTimeout(230);await input.press('ArrowDown');await input.press('Enter');assert.deepEqual(await page.evaluate(()=>testOpened),['Album']);
 await input.fill('Radiohead');await page.waitForTimeout(230);await page.locator('[role=option]').first().click();assert.deepEqual(await page.evaluate(()=>testOpened),['Album','Artist']);
 await input.fill('Paranoid');await page.waitForTimeout(230);await page.locator('[role=option]').first().click();assert.deepEqual(await page.evaluate(()=>testOpened),['Album','Artist','Track']);
 await input.fill('Radio');await page.waitForTimeout(230);await page.locator('.bom-v1-suggestion-all').click();assert.equal(await page.evaluate(()=>testSubmitted),1);
 await input.fill('Radio');await page.waitForTimeout(230);await input.press('Enter');assert.equal(await page.evaluate(()=>testSubmitted),2);
 await input.fill('Radio');await page.waitForTimeout(230);await input.press('Escape');assert.equal(await input.getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>window.testDelay=600);await input.fill('Radio');await page.waitForTimeout(210);await page.evaluate(()=>window.testDelay=0);await input.fill('Paranoid');await page.waitForTimeout(230);assert.match(await page.locator('.bom-v1-suggestions').innerText(),/Paranoid/);await page.waitForTimeout(500);assert.match(await page.locator('.bom-v1-suggestions').innerText(),/Paranoid/);assert.doesNotMatch(await page.locator('.bom-v1-suggestions').innerText(),/Radio 1/);
 await input.fill('Radio');await page.waitForTimeout(230);await input.fill('');await page.waitForTimeout(230);assert.equal(await input.getAttribute('aria-expanded'),'false');
 console.log('PASS debounce, threshold, all three selections, see-all, Enter fallback, Escape, clearing, stale responses');
 const touchContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const touchPage = await touchContext.newPage();
 await touchPage.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="bom-shell-v1"><form class="bom-v1-search" style="margin:20px"><input id="touchSearch"><button>Search</button></form></body>');
 await touchPage.addStyleTag({path:root+'/bom-foundation.css'});
 await touchPage.addScriptTag({path:root+'/bom-autocomplete.js'});
 await touchPage.evaluate(()=>{
  window.touchOpened = '';
  const data=window.BOMAutocomplete.buildCatalogue([{id:1,title:'OK Computer',artist:'Radiohead'}],[],()=> '');
  window.BOMAutocomplete.attach(document.querySelector('input'),document.querySelector('form'),{load:async()=>data,open:item=>window.touchOpened=item.title});
 });
 await touchPage.locator('input').tap();await touchPage.locator('input').fill('Radio');
 await touchPage.locator('[role=option]').first().waitFor();await touchPage.locator('[role=option]').first().tap();
 assert.equal(await touchPage.evaluate(()=>touchOpened),'Radiohead');
 console.log('PASS mobile touch selection');await touchContext.close();

 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
