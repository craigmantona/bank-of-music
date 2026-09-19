// Offline browser regression: production app/assets, fixture auth/data and MusicBrainz.
// BOM_PLAYWRIGHT can point to an existing Playwright installation.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BOM_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = http.createServer(async (req,res) => {
  try { const file = new URL(req.url,'http://localhost').pathname; const path=root+(file==='/'?'index.html':file.slice(1));
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/octet-stream');res.end(await readFile(path));
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true});
try {
 for (const mobile of [false,true]) {
  const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile});
  const page = await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const detail = { id:'release-1',title:'External Album',date:'2001-03-04','artist-credit':[{name:'An Artist'}],'release-group':{id:'group-1','primary-type':'Album'},media:[{'track-count':2,tracks:[{title:'First Song',recording:{id:'recording-1'},position:1},{title:'Second Song',recording:{id:'recording-2'},position:2}]}] };
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    if(url.hostname==='unpkg.com')return route.fulfill({contentType:'text/javascript',body:await readFile(root+'tests/fixtures/search-autosave-supabase.js','utf8')});
    if(url.hostname==='musicbrainz.org'){
      if(url.pathname==='/ws/2/release/')return route.fulfill({json:{releases:[{...detail,country:'GB',status:'Official',media:undefined}]}});
      if(url.pathname==='/ws/2/release/release-1')return route.fulfill({json:detail});
      return route.fulfill({json:{artists:[],recordings:[],'release-groups':[]}});
    }
    // Covers/provider lookups are irrelevant to persistence and stay offline.
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.BOMSearchUI&&window.searchSaveFixture);
  assert.doesNotMatch(await page.locator('#authMessage').innerText(),/Session error/);
  const input=page.locator('#bomV1Search');
  await input.fill('e');await page.waitForTimeout(250);assert.equal(await input.getAttribute('aria-expanded'),'false');
  await input.fill('External');
  const all=page.locator('.bom-v1-suggestion-all');await all.waitFor();
  if(mobile)await all.tap();else await all.click();
  const result=page.locator('.select-result-btn[data-group="albums"]').first();await result.waitFor();
  assert.equal(await page.evaluate(()=>searchSaveFixture.writes.length),0,'merely searching must not save');
  if(mobile)await result.tap();else await result.click();
  await page.waitForFunction(()=>document.querySelector('#selectedItemDetail').dataset.bomAlbumSource==='production');
  assert.equal(await page.locator('#importSelectedAlbumBtn').count(),0);
  assert.equal(await page.locator('.bom-v1-album-personal [data-bom-album-rating]').count(),1);
  assert.ok(await page.locator('#selectedItemDetail [data-song-id]').count()>=2);
  const first=await page.evaluate(()=>structuredClone(searchSaveFixture));
  assert.equal(first.db.albums.length,1);assert.equal(first.db.songs.length,2);assert.equal(first.writes.length,3);
  assert.equal(first.db.albums[0].musicbrainz_release_group_id,'group-1');
  assert.match(await page.locator('.bom-v1-album-personal').innerText(),/Rate|Not rated/);
  // The newly saved album now appears in unchanged predictive search; repeated
  // selections reuse that same catalogue record without any additional writes.
  for(let i=0;i<2;i++){
    await input.fill('External');const option=page.locator('.bom-v1-suggestion').filter({has:page.locator('small',{hasText:'Album'})}).first();await option.waitFor();
    if(mobile)await option.tap();else await option.click();
    await page.waitForFunction(()=>document.querySelector('#selectedItemDetail').dataset.bomAlbumSource==='production');
  }
  assert.equal(await page.evaluate(()=>searchSaveFixture.writes.length),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${mobile?'mobile touch':'desktop'}: autocomplete → See all → external result auto-save; metadata/tracks/rating controls; repeated catalogue selection`);
  await context.close();
  // A separate fresh session proves a failed release cannot create an album.
  const failedPage=await browser.newPage();
  await failedPage.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    if(url.hostname==='unpkg.com')return route.fulfill({contentType:'text/javascript',body:await readFile(root+'tests/fixtures/search-autosave-supabase.js','utf8')});
    if(url.hostname==='musicbrainz.org')return route.fulfill(url.pathname==='/ws/2/release/'?{json:{releases:[{...detail,country:'GB',status:'Official'}]}}:url.pathname==='/ws/2/release/release-1'?{status:503,json:{error:'unavailable'}}:{json:{artists:[],recordings:[]}});
    return route.abort();
  });
  await failedPage.goto(`http://127.0.0.1:${server.address().port}/`);await failedPage.waitForFunction(()=>window.BOMSearchUI);
  await failedPage.locator('#bomV1Search').fill('External');await failedPage.locator('.bom-v1-suggestion-all').click();
  await failedPage.locator('.select-result-btn[data-group="albums"]').first().click();await failedPage.waitForSelector('.bom-v1-album-error');
  assert.equal(await failedPage.evaluate(()=>searchSaveFixture.writes.length),0);console.log('PASS failed external resolution: no album/track writes');await failedPage.close();
 }
}finally{await browser.close();server.close();}
