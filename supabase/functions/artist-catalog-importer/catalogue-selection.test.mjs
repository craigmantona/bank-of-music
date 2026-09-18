import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../_shared/catalogue-selection.ts", import.meta.url), "utf8");
const ctx = { console };
runInNewContext(stripTypeScriptTypes(source.replace(/^export /gm, ""), { mode: "transform" }) +
  "\nObject.assign(globalThis,{qualifyStudioReleaseGroup,selectCanonicalEdition,isOriginalPeriod,mapLegacyProgress});", ctx);
const group = (id, title, secondary = [], credit = "artist") => ({ id, title,
  "primary-type": "Album", "secondary-types": secondary,
  "first-release-date": "1970-01-01", "artist-credit": credit ? [{artist:{id:credit}}] : [] });
const release = (id, country, date) => ({ id, country, date, status: "Official", title: "variant title" });
const evidence = (releases = [release("gb", "GB", "1970-01-01")], extra = {}) =>
  ({ artistId:"artist", releases, ...extra });

test("Bowie: UK-first recovers The Man Who Sold the World", () => {
  const bowie = group("world", "The Man Who Sold the World");
  bowie["first-release-date"] = "1970-11-04";
  assert.equal(ctx.qualifyStudioReleaseGroup(bowie, [], evidence([
    release("us", "US", "1970-11-04"), release("gb", "GB", "1971-04")
  ])).qualification, "include");
  const selected = ctx.selectCanonicalEdition([
    release("us", "US", "1970-11-04"), release("gb", "GB", "1971-04")
  ], "GB", "1970-11-04");
  assert.equal(selected.release.id, "gb"); assert.equal(selected.strategy, "gb_original_period");
});

test("Bowie: late GB reissues do not displace original-period editions", () => {
  for (const [date, late] of [["1987-04-18", "1995-11-13"], ["1997-02-01", "2003-09-15"]]) {
    const selected = ctx.selectCanonicalEdition([
      release("gb-late", "GB", late), release("xe-original", "XE", date)
    ], "GB", date);
    assert.equal(selected.release.id, "xe-original");
    assert.equal(selected.strategy, "international_original_period");
  }
});

test("Fleetwood Mac: normal UK album and US-only original both qualify", () => {
  for (const [id,title,date,country] of [["then-play-on","Then Play On","1969-09","GB"],
    ["mystery","Mystery to Me","1973-01-11","GB"]]) {
    const value = group(id,title); value["first-release-date"] = date;
    assert.equal(ctx.qualifyStudioReleaseGroup(value, [], evidence([release(id,country,date)])).qualification, "include");
  }
  assert.equal(ctx.selectCanonicalEdition([release("then-play-on", "GB", "1969-09")], "GB", "1969-09").release.id, "then-play-on");
  const fallback = ctx.selectCanonicalEdition([release("heroes", "US", "1974-09-13")], "GB", "1974-09-13");
  assert.equal(fallback.release.id, "heroes"); assert.equal(fallback.strategy, "territorial_original_period");
});

test("data-driven override excludes The Biggest Thing Since Colossus", () => {
  const override = [{ release_group_id: "biggest", qualification: "exclude" }];
  assert.equal(ctx.qualifyStudioReleaseGroup(group("biggest", "The Biggest Thing Since Colossus"), override).qualified, false);
});

test("Queen: Soundtrack release groups are excluded", () => {
  assert.equal(ctx.qualifyStudioReleaseGroup(group("flash", "Flash", ["Soundtrack"])).reason, "secondary_type:Soundtrack");
});

test("Radiohead: delayed original-period UK releases remain eligible", () => {
  for (const [original, uk] of [["1994-11-29", "1995-03-13"], ["2000-08-03", "2000-10-02"]]) {
    assert.equal(ctx.selectCanonicalEdition([release("gb", "GB", uk)], "GB", original).release.id, "gb");
  }
});

test("Stereophonics: no-GB releases use deterministic international and territorial fallbacks", () => {
  assert.equal(ctx.selectCanonicalEdition([release("jp", "JP", "2005-03-09")], "GB", "2005-03-09").strategy, "territorial_original_period");
  assert.equal(ctx.selectCanonicalEdition([release("xw", "XW", "2025-04-25")], "GB", "2025-04-25").strategy, "international_original_period");
});

test("Taylor Swift: re-recording remains reviewable and US is preferred without GB", () => {
  const override = [{ release_group_id: "tv", qualification: "review" }];
  const decision = ctx.qualifyStudioReleaseGroup(group("tv", "Fearless (Taylor’s Version)"), override);
  assert.equal(decision.review, true); assert.equal(decision.qualified, false);
  const selected = ctx.selectCanonicalEdition([
    release("ca", "CA", "2006-10-24"), release("us", "US", "2006-10-24")
  ], "US", "2006-10-24");
  assert.equal(selected.release.id, "us"); assert.equal(selected.strategy, "home_original_period");
});

test("Toy: a later first-official-publication requires review or an explicit override", () => {
  const automatic = ctx.selectCanonicalEdition([release("toy", "XE", "2022-01-07")], "GB", "2011-03-20");
  assert.equal(automatic.release, null); assert.equal(automatic.review, true);
  const manual = ctx.selectCanonicalEdition([release("toy", "XE", "2022-01-07")], "GB", "2011-03-20",
    { release_group_id: "toy", qualification: "include", canonical_release_id: "toy", original_release_date: "2022-01-07" });
  assert.equal(manual.release.id, "toy"); assert.equal(manual.strategy, "manual_override");
});

test("title patterns have no authority when structured evidence is sufficient", () => {
  for (const title of ["Album Demos", "BBC Broadcast", "The Alternate Album"]) {
    const result = ctx.qualifyStudioReleaseGroup(group(title, title), [], evidence());
    assert.equal(result.qualification, "include");
  }
});

test("three-state structured qualification is conservative", () => {
  assert.equal(ctx.qualifyStudioReleaseGroup(group("core", "Core"), [], evidence()).qualification, "include");
  assert.equal(ctx.qualifyStudioReleaseGroup(group("missing", "Peter and the Wolf", [], null), [], evidence()).qualification, "review");
  assert.equal(ctx.qualifyStudioReleaseGroup(group("mixed", "Collaboration", [], "artist"), [],
    evidence()).qualification, "include");
  const mixed = group("mixed", "Collaboration"); mixed["artist-credit"].push({artist:{id:"other"}});
  assert.equal(ctx.qualifyStudioReleaseGroup(mixed, [], evidence()).qualification, "review");
  assert.equal(ctx.qualifyStudioReleaseGroup(group("other", "Other", [], "other"), [], evidence()).qualification, "exclude");
  assert.equal(ctx.qualifyStudioReleaseGroup(group("unofficial", "Unofficial"), [],
    evidence([{id:"boot",country:"GB",date:"1970-01-01",status:"Bootleg"}])).qualification, "exclude");
  assert.equal(ctx.qualifyStudioReleaseGroup(group("late", "Zoom 1979"), [],
    evidence([release("late", "GB", "1994")], {artistEnded:true,artistEndDate:"1991"})).qualification, "review");
});

test("normal Oasis and Radiohead albums include with official original-period evidence", () => {
  for (const [id,title,date] of [["oasis","Definitely Maybe","1994-08-30"],
    ["radiohead","The Bends","1995-03-13"]]) {
    const value = group(id,title); value["first-release-date"] = date;
    assert.equal(ctx.qualifyStudioReleaseGroup(value, [], evidence([release(id,"GB",date)])).qualification, "include");
  }
});

test("Radiohead core studio albums include when frozen evidence contains the exact artist credit", () => {
  for (const [index,title] of ["Pablo Honey","The Bends","OK Computer","Kid A","Amnesiac",
    "Hail to the Thief","In Rainbows","The King of Limbs","A Moon Shaped Pool"].entries()) {
    const value = group(`radiohead-${index}`, title);
    value["first-release-date"] = `${1993 + index}-01-01`;
    assert.equal(ctx.qualifyStudioReleaseGroup(value, [], evidence([
      release(`release-${index}`, "GB", value["first-release-date"])
    ])).qualification, "include", title);
  }
});

test("Taylor Swift ordinary studio albums include while re-recordings remain policy review", () => {
  const ordinary = ["Taylor Swift","Fearless","Speak Now","Red","1989","reputation","Lover","folklore","evermore"];
  for (const [index,title] of ordinary.entries()) {
    const value = group(`taylor-${index}`, title);
    value["first-release-date"] = `${2006 + index}-01-01`;
    assert.equal(ctx.qualifyStudioReleaseGroup(value, [], {
      artistId:"artist", releases:[release(`release-${index}`, "US", value["first-release-date"])]
    }).qualification, "include", title);
  }
  const policy = [{release_group_id:"taylor-version",qualification:"review",decision_source:"policy"}];
  assert.equal(ctx.qualifyStudioReleaseGroup(group("taylor-version","Fearless (Taylor’s Version)"),
    policy,evidence()).qualification,"review");
});

test("automatic review evidence is re-evaluated but policy and human decisions remain authoritative", () => {
  const value = group("candidate", "Core album");
  const automatic = [{release_group_id:"candidate",qualification:"review",decision_source:"automatic"}];
  const included=ctx.qualifyStudioReleaseGroup(value, automatic, evidence());
  assert.equal(included.qualification,"include");
  assert.equal(included.reason,"high_confidence_primary_album");
  assert.equal(ctx.qualifyStudioReleaseGroup({...value,"artist-credit":[{artist:{id:"other"}}]},
    automatic,evidence()).qualification,"exclude");
  for (const decision_source of ["policy","human"]) {
    assert.equal(ctx.qualifyStudioReleaseGroup(value,
      [{release_group_id:"candidate",qualification:"review",decision_source}],evidence()).reason,
      "override_review");
  }
  assert.equal(ctx.qualifyStudioReleaseGroup(value,
    [{release_group_id:"candidate",qualification:"include",decision_source:"human"}],evidence()).reason,
    "override_include");
  assert.equal(ctx.qualifyStudioReleaseGroup(value,
    [{release_group_id:"candidate",qualification:"exclude",decision_source:"human"}],evidence()).reason,
    "override_exclude");
});

test("A Kind of Magic is held by a versioned review override", () => {
  const override = [{release_group_id:"kind",qualification:"review"}];
  assert.equal(ctx.qualifyStudioReleaseGroup(group("kind","A Kind of Magic"), override, evidence()).qualification, "review");
});

test("include permits canonical selection while review and exclude stop import authority", () => {
  const core = ctx.qualifyStudioReleaseGroup(group("core","Core"), [], evidence());
  const review = ctx.qualifyStudioReleaseGroup(group("review","Review", [], null), [], evidence());
  const excluded = ctx.qualifyStudioReleaseGroup(group("live","Live", ["Live"]), [], evidence());
  assert.equal(Boolean(core.qualified && ctx.selectCanonicalEdition(evidence().releases,"GB","1970-01-01").release), true);
  assert.equal(review.qualified, false);
  assert.equal(excluded.qualified, false);
});

test("legacy progress maps by release-group ID instead of reusing its numeric index", () => {
  const mapped = ctx.mapLegacyProgress([{id:"a"},{id:"removed"},{id:"b"}], 2, ["a","b","c"]);
  assert.deepEqual([...mapped.legacy_processed_group_ids], ["a","removed"]);
  assert.equal(mapped.next_qualified_index, 1);
});
