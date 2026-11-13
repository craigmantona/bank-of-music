import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [discover, css, config, html] = await Promise.all([
  read("bom-discover.js"), read("bom-foundation.css"), read("config.js"), read("index.html")
]);

function helpers(flags = {}) {
  const window = {
    BOM_HIGHER_LOWER_FEATURE:{enabled:false},
    BOM_QUICKFIRE_FEATURE:{enabled:false},
    BOM_DAILY_CHALLENGE_FEATURE:{enabled:false},
    addEventListener(){},
    ...flags
  };
  const context={window,document:{addEventListener(){}},Intl,Date,Math,Number,String,Object,Array,Map,Set,Promise,clearTimeout,setTimeout,matchMedia:()=>({matches:true})};
  vm.runInNewContext(discover,context);
  return window.BOMDiscoverHelpers;
}

test("Discover shows a lightweight three-game Coming Soon teaser above Quick Rate", () => {
  const teaser=helpers().gamesTeaser();
  for (const text of [
    "BOM GAMES · COMING SOON", "Think you know your music?",
    "Your ratings. Your knowledge. Your bragging rights.", "Higher or Lower",
    "60-Second Quickfire", "Daily BOM Challenge", "Rate more music. Help unlock the games."
  ]) assert.match(teaser,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(teaser,/data-bom-action="quick-rate"/);
  assert.match(discover,/\$\{gamesTeaser\(model\.authenticated\)\}\$\{model\.authenticated\?carousel\(\):""\}/);
  assert.doesNotMatch(teaser,/game-preview|daily-challenge|higher-lower|simulation|rpc|supabase/i);
});

test("the public teaser renders for guests without offering a protected Quick Rate action", () => {
  const guest=helpers().gamesTeaser(false);
  assert.match(guest,/Think you know your music\?/);
  assert.doesNotMatch(guest,/data-bom-action="quick-rate"/);
  assert.match(discover,/gamesTeaser\(model\.authenticated\)/);
});

test("enabled games leave the teaser automatically and all-enabled hides it", () => {
  const partial=helpers({BOM_QUICKFIRE_FEATURE:{enabled:true}});
  assert.deepEqual(Array.from(partial.comingSoonGames(),game=>game.name),["Higher or Lower","Daily BOM Challenge"]);
  assert.doesNotMatch(partial.gamesTeaser(),/60-Second Quickfire/);
  const launched=helpers({
    BOM_HIGHER_LOWER_FEATURE:{enabled:true},
    BOM_QUICKFIRE_FEATURE:{enabled:true},
    BOM_DAILY_CHALLENGE_FEATURE:{enabled:true}
  });
  assert.equal(launched.gamesTeaser(),"");
});

test("teaser adds no startup data work or eager game downloads", () => {
  const teaserSource=discover.slice(discover.indexOf("const comingSoonGames"),discover.indexOf("const christmasEnabled"));
  assert.doesNotMatch(teaserSource,/BOMPresentationBridge|fetch\(|supabase|loadBOMGameAsset|\.rpc\(/i);
  assert.doesNotMatch(html,/bom-(higher-lower|quickfire|daily-challenge|game-preview)\.js/);
  for (const flag of ["BOM_HIGHER_LOWER_FEATURE","BOM_QUICKFIRE_FEATURE","BOM_DAILY_CHALLENGE_FEATURE"]) {
    assert.match(config,new RegExp(`${flag} = Object\\.freeze\\([\\s\\S]*?enabled: false`));
  }
});

test("teaser styling is responsive, accessible and cache-busted", () => {
  assert.match(css,/\.bom-games-teaser \{/);
  assert.match(css,/--bom-games-lime:#b9ff4b/);
  assert.match(css,/@media \(max-width: 900px\)[\s\S]*\.bom-games-teaser-list \{ grid-template-columns:1fr/);
  assert.match(css,/@media \(max-width: 600px\)[\s\S]*\.bom-games-teaser footer button \{ width:100%/);
  assert.match(html,/bom-foundation\.css\?v=49/);
  assert.match(html,/bom-discover\.js\?v=13/);
  assert.match(helpers().gamesTeaser(),/aria-labelledby="bomGamesTeaserTitle"/);
});
