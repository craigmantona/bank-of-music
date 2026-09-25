// Run with Node 24+: node --test supabase/functions/artist-catalog-importer/release-selection.test.mjs
// Evaluate the real Edge Function with inert runtime/client stubs: no network or DB writes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadEdge as load } from "../../tests/helpers.mjs";
import test from "node:test";

const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const release = (country, date, id = `${country}-${date}`) => ({ id, country, date });
async function choose(releases, first = "1970-11-04", country = "GB") {
  const ctx = load(source);
  return ctx.chooseOfficialRelease("fixture-group", country, first, async () => ({ releases }));
}

test("Bowie: US November 1970 and month-only GB April 1971", async () => {
  const result = await choose([release("US", "1970-11-04"), release("GB", "1971-04")]);
  assert.equal(result.release.id, "GB-1971-04");
});
test("Bowie: precise UK date also qualifies", async () => {
  assert.ok((await choose([release("US", "1970-11-04"), release("GB", "1971-04-08")])).release);
});
test("normal home and international releases still qualify", async () => {
  for (const country of ["GB", "XW", "XE"]) {
    assert.ok((await choose([release(country, "1970-12-01")])).release);
  }
});
test("75-day boundary is preserved for international releases", async () => {
  assert.ok((await choose([release("XW", "1971-01-18")])).release);
  assert.equal((await choose([release("XW", "1971-01-19")])).reason, "regional_or_later_release");
});
test("regional-only catalogues remain rejected", async () => {
  assert.equal((await choose([release("US", "1970-11-04")])).reason, "no_home_or_international_release");
});
test("Beatles/Stones-style original US albums with decades-later home reissues stay rejected", async () => {
  for (const first of ["1964-04-10", "1965-12-04", "1966-06-20"]) {
    const result = await choose([release("US", first), release("GB", "2014-01-20"), release("XW", "2004-11-15")], first);
    assert.equal(result.reason, "regional_or_later_release");
    assert.equal(result.home_country, "GB");
    assert.equal(result.home_release_dates.length, 2);
  }
});
test("delayed international edition alone cannot use the exception", async () => {
  for (const country of ["XE", "XW"]) {
    assert.equal((await choose([release("US", "1970-11-04"), release(country, "1971-04")])).reason, "regional_or_later_release");
  }
});
test("exception requires evidence of an original-period release", async () => {
  assert.equal((await choose([release("GB", "1971-04")])).reason, "regional_or_later_release");
});
test("bounded home-country exception accepts 366 days and rejects 367", async () => {
  assert.ok((await choose([release("US", "1970-11-04"), release("GB", "1971-11-05")])).release);
  assert.equal((await choose([release("US", "1970-11-04"), release("GB", "1971-11-06")])).reason, "regional_or_later_release");
});
test("uncertain dates cannot extend the exception", async () => {
  for (const date of ["1971", "1971-11", "1971-13", "1971-02-30", "", "unknown"]) {
    assert.equal((await choose([release("US", "1970-11-04"), release("GB", date)])).reason, "regional_or_later_release");
  }
});
test("existing same-year partial-date policy remains", async () => {
  assert.ok((await choose([release("GB", "1970")])).release);
});
test("missing country/date retains existing selection behaviour", async () => {
  assert.ok((await choose([release("US", "1970-11-04")], "1970-11-04", "")).release);
  assert.ok((await choose([release("GB", "1971-04")], "")).release);
});
test("empty releases have a diagnostic reason", async () => {
  assert.equal((await choose([])).reason, "no_official_releases");
});
test("artist-era and normalized duplicate keys remain intact", () => {
  const ctx = load(source);
  assert.equal(ctx.isReleaseGroupWithinArtistEra({ "first-release-date": "1973" }, { ended: true, end: "1970" }), false);
  assert.equal(ctx.isReleaseGroupWithinArtistEra({ "first-release-date": "1972" }, { ended: true, end: "1970" }), true);
  assert.equal(ctx.normaliseAlbumKey("Álbum & Title!", "ARTIST"), ctx.normaliseAlbumKey("Album and Title", "Artist"));
});
test("symbol-only and Unicode album keys do not collapse together", () => {
  const ctx = load(source);
  const titles = ["+", "×", "÷", "=", "−", "★", "Ö", "惠特妮·休斯顿纪念特辑"];
  const keys = titles.map(title => ctx.normaliseAlbumKey(title, "Artist"));
  assert.equal(keys.every(key => !key.endsWith("|||")), true);
  assert.equal(new Set(keys).size, keys.length);
});
test("title fallback rejects conflicting MusicBrainz identities", () => {
  const ctx = load(source);
  const album = { title: "+", artist: "Ed Sheeran", external_source: "musicbrainz",
    external_id: "saved-release", musicbrainz_release_group_id: "saved-group" };
  assert.equal(ctx.albumTitleFallbackMatches(album, { title: "+", artist: "Ed Sheeran",
    external_source: "musicbrainz", external_id: "other-release", musicbrainz_release_group_id: "other-group" }), false);
  assert.equal(ctx.albumTitleFallbackMatches(album, { title: "+", artist: "Ed Sheeran" }), true);
  assert.equal(ctx.albumTitleFallbackMatches(album, { title: "×", artist: "Ed Sheeran" }), false);
});
test("importer excludes Demo release groups without broadening normal album filtering", () => {
  const ctx = load(source);
  assert.equal(ctx.isStudioReleaseGroup({ "primary-type": "Album", "secondary-types": ["Demo"] }), false);
  assert.equal(ctx.isStudioReleaseGroup({ "primary-type": "Album", "secondary-types": [] }), true);
});
test("daily wrapper passes through legacy titles and new diagnostics", async () => {
  let handler;
  const payload = { ok: true, skipped: ["Regional album"], skipped_details: [{ title: "Regional album", reason: "regional_or_later_release" }] };
  load(readFileSync(new URL("../daily-artist-import/index.ts", import.meta.url), "utf8"), {
    Deno: { env: { get: () => "test-only" }, serve: (fn) => { handler = fn; } },
    requireCronSecretOrAdmin: async () => ({ ok: true, kind: "admin" }),
    createClient: () => ({ functions: { invoke: async () => ({ data: payload, error: null }) } })
  });
  const response = await handler(new Request("https://example.invalid", { method: "POST", body: "{}" }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).importer, payload);
});
