import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APPROVED_EXACT_MBIDS, applyMusicBrainzEnrichment, applyWikidata, canonicalRecordingSeed,
  classifyCanonicalEligibility, collapseNumberOneRuns, evaluateMusicBrainzCandidates,
  matchCollectionEntries, musicBrainzSearchPath, parseNumberOneWikitext, sourcePagesForRange,
  summariseCanonicalClassification, summariseMatches, summariseMusicBrainzEnrichment, wikidataSparql
} from "../scripts/uk-number-ones-lib.mjs";

const fixture = `==Number-one singles==
{|class="wikitable"
|-class="unsortable"
!scope=row colspan=6|{{anchor|1995}}{{sort|700.1|1995}}
|-
!scope=row|701
| [[Oasis (band)|Oasis]]||"[[Some Might Say]]"
| [[Creation Records|Creation]]||{{dts|format=dmy|1995|4|29}}||align="center"|1
|-
!scope=row|702
| [[Example]]||"[[Return Song]]"
| Label||{{dts|format=dmy|1995|5|6}}||align="center"|2
|-
!scope=row|703
| [[Example]]||"[[Return Song]]"
| Label||{{dts|format=dmy|1995|6|3}}||align="center"|1
|}
===Additional information===`;

test("parses source rows, extracts song article titles and collapses repeat runs", () => {
  const rows = parseNumberOneWikitext(fixture, { startYear: 1995, endYear: 1995, revision: 123 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].article_titles, ["Some Might Say"]);
  assert.equal(rows[0].source_revision, "123");
  assert.equal(rows[1].weeks_at_number_one, 3);
  assert.equal(rows[1].number_one_runs, 2);
  assert.equal(rows[1].first_number_one_date, "1995-05-06");
});

test("parses decade pages whose section headings contain Wikimedia spacing", () => {
  const spaced = fixture
    .replace("==Number-one singles==", "== Number-one singles ==")
    .replace("===Additional information===", "==By artist==");
  const rows = parseNumberOneWikitext(spaced, { startYear: 1995, endYear: 1995 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Some Might Say");
});

test("selects Wikimedia decade pages from a configurable year range", () => {
  assert.deepEqual(sourcePagesForRange(1970, 1979), ["List_of_UK_singles_chart_number_ones_of_the_1970s"]);
  assert.deepEqual(sourcePagesForRange(1990, 1999), ["List_of_UK_singles_chart_number_ones_of_the_1990s"]);
  assert.deepEqual(sourcePagesForRange(2000, 2009), ["List_of_UK_singles_chart_number_ones_of_the_2000s"]);
  assert.deepEqual(sourcePagesForRange(1952, 2026), ["List_of_UK_singles_chart_number_ones_of_the_1950s", "List_of_UK_singles_chart_number_ones_of_the_1960s", "List_of_UK_singles_chart_number_ones_of_the_1970s", "List_of_UK_singles_chart_number_ones_of_the_1980s", "List_of_UK_singles_chart_number_ones_of_the_1990s", "List_of_UK_singles_chart_number_ones_of_the_2000s", "List_of_UK_singles_chart_number_ones_of_the_2010s", "List_of_UK_singles_chart_number_ones_of_the_2020s"]);
});

test("keeps a prior-decade carry-over in its occupied chart year with the historical first date", () => {
  const carryOver = fixture
    .replaceAll("1995", "1970")
    .replace("{{dts|format=dmy|1970|4|29}}", "{{dts|format=dmy|1969|12|20}}");
  const rows = parseNumberOneWikitext(carryOver, { startYear: 1970, endYear: 1970, revision: 1354857328 });
  const classified = classifyCanonicalEligibility(rows.map(row => ({
    ...row,
    match_status: "unresolved",
    source_metadata: { article_titles: row.article_titles, isrcs: [], spotify_track_ids: [] }
  })), []);
  assert.equal(classified[0].chart_year, 1970);
  assert.equal(classified[0].first_number_one_date, "1969-12-20");
  assert.equal(summariseCanonicalClassification(classified).carry_over_from_previous_year, 1);
});

test("parses sort-wrapped historical chart numbers and collapses their re-entries", () => {
  const historical = `==Number-one singles==
{|class="wikitable"
|-class="unsortable"
!scope=row colspan=6|{{anchor|1960}}{{sort|093.1|1960}}
|-
!scope=row style="text-align:center;"|{{sort|094|94}}
| [[Emile Ford|Emile Ford and the Checkmates]]|| "[[What Do You Want to Make Those Eyes at Me For?]]"
| Pye||{{dts|format=dmy|1959|12|18}}||align="center"|6
|-
!scope=row style="text-align:center;"|{{sort|094.1|re}}
| [[Emile Ford|Emile Ford and the Checkmates]]|| "[[What Do You Want to Make Those Eyes at Me For?]]"
| Pye||{{dts|format=dmy|1960|1|8}}||align="center"|1
|}
==By artist==`;
  const rows = parseNumberOneWikitext(historical, { startYear: 1960, endYear: 1960, revision: 1377220697 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_number, 94);
  assert.equal(rows[0].first_number_one_date, "1959-12-18");
  assert.equal(rows[0].weeks_at_number_one, 7);
  assert.equal(rows[0].number_one_runs, 2);
});

test("parses 2010s vertical cells, capitalized templates and re-entry rows", () => {
  const vertical = `==Number-one singles==
{|class="wikitable"
|-class=unsortable
!scope=row colspan=7|{{Anchor|2010}}{{Sort|1117.1|2010}}
|-
!scope=row|1118
|{{Sortname|Joe|McElderry}}
|"[[The Climb (song)#Joe McElderry version|The Climb]]"
|Syco
|{{dts|format=dmy|2010|01|02}}
|align=center|1
|-
!scope=row|re
|[[Lady Gaga]]
|"[[Bad Romance]]"
|Interscope
|{{dts|format=dmy|2010|01|09}}
| style="text-align:center;"|1
|}
==By artist==`;
  const rows = parseNumberOneWikitext(vertical, { startYear: 2010, endYear: 2010, revision: 1356457366 });
  assert.deepEqual(rows.map(row => [row.artist, row.title, row.first_number_one_date]), [
    ["Joe McElderry", "The Climb", "2010-01-02"],
    ["Lady Gaga", "Bad Romance", "2010-01-09"]
  ]);
});

test("parses the 1952 chart start and styled historical weeks without pre-chart years", () => {
  const historical = `==Number-one singles==
{|class="wikitable"
|-class="unsortable"
!scope=row colspan=6|{{anchor|1952}}{{sort|00.1|1952}}
|-
!scope=row|{{sort|01|1}}
| {{sortname|Al|Martino}} || "[[Here in My Heart]]"
|Capitol || {{dts|format=dmy|1952|11|14}}||align="center"|9
|-class="unsortable"
!scope=row colspan=6|{{anchor|1959}}{{sort|78.1|1959}}
|-
!scope=row|94
| [[Emile Ford|Emile Ford and the Checkmates]] || "[[What Do You Want to Make Those Eyes at Me For?]]"
|Pye || {{dts|format=dmy|1959|12|18}}||align="center" bgcolor="lightgreen"|<span style="display:none">5.5</span>{{0|<sup>[nb 8]</sup>}}6<ref name="JointDec59" group="nb"/>
|}
==By artist==`;
  const rows = parseNumberOneWikitext(historical, { startYear: 1952, endYear: 1959 });
  assert.deepEqual(rows.map(row => [row.chart_year, row.artist, row.first_number_one_date, row.weeks_at_number_one]), [
    [1952, "Al Martino", "1952-11-14", 9],
    [1959, "Emile Ford and the Checkmates", "1959-12-18", 6]
  ]);
  assert.equal(rows.some(row => row.chart_year < 1952), false);
});

test("reuses only the explicitly approved 1959 boundary canonical", () => {
  const canonicalId = "a55e5149-7949-42d9-b503-8dc51754f912";
  const [classified] = classifyCanonicalEligibility([{
    source_entry_key: "1959:94:emile ford and the checkmates:what do you want to make those eyes at me for",
    artist: "Emile Ford and the Checkmates",
    title: "What Do You Want to Make Those Eyes at Me For?",
    match_status: "unresolved",
    source_metadata: { article_titles: ["What Do You Want to Make Those Eyes at Me For?"] }
  }], [{ id: canonicalId, title: "What Do You Want to Make Those Eyes at Me For?", artist: "Emile Ford and the Checkmates" }]);
  assert.equal(classified.classification, "A");
  assert.equal(classified.classification_reason, "approved_boundary_canonical_reuse");
  assert.equal(classified.canonical_song_id, canonicalId);
});

test("preserves the true 2019 date for the first 2020 chart period", () => {
  const current = `==Number-one singles==
{|class="wikitable"
|-class="unsortable"
!scope=row colspan=6|{{anchor|2020}}{{sort|1360.1|2020}}
|-
!scope=row|1361
| [[Ellie Goulding]] || "[[River (Joni Mitchell song)#Ellie Goulding version|River]]"
|Polydor || {{dts|format=dmy|2020|1|2}}||align="center"|1
|}
==By artist==`;
  const [row] = parseNumberOneWikitext(current, { startYear: 2020, endYear: 2026 });
  assert.equal(row.chart_year, 2020);
  assert.equal(row.first_number_one_date, "2019-12-27");
});

test("uses only a unique exact Wikidata QID as an existing canonical identity", () => {
  const base = { source_entry_key: "2026:1:test artist:test song", artist: "Test Artist", title: "Test Song",
    wikidata_qid: "Q123", match_status: "title_artist", source_metadata: { article_titles: ["Test Song"] } };
  const [matched] = classifyCanonicalEligibility([base], [{ id: "canonical-1", wikidata_qid: "Q123" }]);
  assert.equal(matched.classification, "A");
  assert.equal(matched.classification_reason, "existing_exact_wikidata_qid");
  const [ambiguous] = classifyCanonicalEligibility([base], [
    { id: "canonical-1", wikidata_qid: "Q123" }, { id: "canonical-2", wikidata_qid: "Q123" }
  ]);
  assert.equal(ambiguous.classification, "C");
  assert.equal(ambiguous.classification_reason, "ambiguous_existing_wikidata_qid_candidates");
});

test("an exact prior source origin supports safe incremental reruns", () => {
  const row = { collection_key: "uk-number-ones", source_entry_key: "2026:1459:taylor swift:patient zero",
    artist: "Taylor Swift", title: "Patient Zero", match_status: "unresolved",
    source_metadata: { article_titles: ["Patient Zero (song)"] } };
  const [classified] = classifyCanonicalEligibility([row], [{
    id: "canonical-1", origin_key: "quick-rate:uk-number-ones:2026:1459:taylor swift:patient zero"
  }]);
  assert.equal(classified.classification, "A");
  assert.equal(classified.classification_reason, "existing_exact_source_origin");
  assert.equal(classified.canonical_song_id, "canonical-1");
});

test("builds one batched Wikidata query and applies QID/P4404 enrichment", () => {
  const rows = parseNumberOneWikitext(fixture, { startYear: 1995, endYear: 1995 });
  const query = wikidataSparql(rows.flatMap(row => row.article_titles));
  assert.match(query, /VALUES \?article/);
  assert.match(query, /wdt:P4404/);
  assert.match(query, /wdt:P1243/);
  assert.match(query, /wdt:P2207/);
  const enriched = applyWikidata(rows, [{
    article: { value: "https://en.wikipedia.org/wiki/Some_Might_Say" },
    item: { value: "http://www.wikidata.org/entity/Q123" },
    mbid: { value: "cae8bbec-c2ff-4972-9218-8f90acb07b1b" },
    isrc: { value: "GB-AAA-95-00001" }
  }]);
  assert.equal(enriched[0].wikidata_qid, "Q123");
  assert.deepEqual(enriched[0].musicbrainz_recording_ids, ["cae8bbec-c2ff-4972-9218-8f90acb07b1b"]);
});

test("matches exact P4404 first and uses only a unique title/artist fallback", () => {
  const base = parseNumberOneWikitext(fixture, { startYear: 1995, endYear: 1995 });
  const mbid = "cae8bbec-c2ff-4972-9218-8f90acb07b1b";
  const entries = [
    { ...base[0], musicbrainz_recording_ids: [mbid], isrcs: [], spotify_track_ids: [], wikidata_qid: "Q1" },
    { ...base[1], artist: "Unique Artist", title: "Unique Song", article_titles: ["Unique Song"], musicbrainz_recording_ids: [], isrcs: [], spotify_track_ids: [] }
  ];
  const songs = [
    { id: 11, title: "Some Might Say", artist: "Oasis", external_source: "musicbrainz", external_id: mbid },
    { id: 12, title: "Unique Song", artist: "Unique Artist" }
  ];
  const matched = matchCollectionEntries(entries, songs);
  assert.equal(matched[0].match_status, "direct_mbid");
  assert.equal(matched[0].song_id, 11);
  assert.equal(matched[1].match_status, "title_artist");
  assert.equal(matched[1].song_id, 12);
});

test("uses an existing unique Spotify identifier without searching Spotify", () => {
  const entry = { collection_key: "uk-number-ones", chart_year: 1995, source_entry_key: "spotify", source_name: "wikimedia", source_url: "x", source_revision: "1", first_number_one_date: "1995-01-01", weeks_at_number_one: 1, number_one_runs: 1, artist: "Different credit", title: "Different title", article_titles: ["Song"], musicbrainz_recording_ids: [], isrcs: [], spotify_track_ids: ["spotify123"] };
  const [matched] = matchCollectionEntries([entry], [{ id: 9, artist: "Artist", title: "Song", spotify_track_id: "spotify123" }]);
  assert.equal(matched.match_status, "identifier");
  assert.equal(matched.match_method, "wikidata_spotify_track_id");
  assert.equal(matched.song_id, 9);
});

test("MusicBrainz search is one encoded recording query per artist/title", () => {
  const path = musicBrainzSearchPath({ artist: 'Artist "Name"', title: "Song" });
  assert.match(path, /^\/recording\/\?query=/);
  assert.match(decodeURIComponent(path), /recording:"Song" AND artist:"Artist Name"/);
  assert.match(path, /limit=15$/);
});

test("MusicBrainz candidate confidence requires exact identity and strong evidence", () => {
  const entry = { artist: "Oasis", title: "Some Might Say", chart_year: 1995, source_metadata: { isrcs: ["GB-AAA-95-00001"] } };
  const candidate = (overrides = {}) => ({ id: "cae8bbec-c2ff-4972-9218-8f90acb07b1b", title: "Some Might Say", score: 100, "artist-credit": [{ name: "Oasis" }], "first-release-date": "1995-04-24", releases: [{ date: "1995-04-24", title: "Some Might Say" }], isrcs: [], ...overrides });
  assert.equal(evaluateMusicBrainzCandidates(entry, { recordings: [candidate({ isrcs: ["GBAAA9500001"] })] }).reason, "exact_isrc_artist_title");
  assert.equal(evaluateMusicBrainzCandidates({ ...entry, source_metadata: { isrcs: [] } }, { recordings: [candidate()] }).reason, "exact_artist_title_strong_release_date");
  assert.equal(evaluateMusicBrainzCandidates({ ...entry, source_metadata: { isrcs: [] } }, { recordings: [candidate({ "first-release-date": "2005", releases: [] })] }).confidence, "probable");
  assert.equal(evaluateMusicBrainzCandidates(entry, { recordings: [candidate({ disambiguation: "live version", isrcs: ["GBAAA9500001"] })] }).confidence, "none");
  assert.equal(evaluateMusicBrainzCandidates(entry, { recordings: [candidate({ title: "Some Might Say (remix)", isrcs: ["GBAAA9500001"] })] }).confidence, "none");
  assert.equal(evaluateMusicBrainzCandidates({ ...entry, artist: "Various Artists", source_metadata: { isrcs: [] } }, { recordings: [candidate({ "artist-credit": [{ name: "Various Artists" }] })] }).reason, "ensemble_credit_requires_review");
});

test("close exact MusicBrainz candidates remain ambiguous and are never auto-selected", () => {
  const entry = { artist: "Artist", title: "Song", chart_year: 1995, source_metadata: { isrcs: [] } };
  const recording = (id, score) => ({ id, title: "Song", score, "artist-credit": [{ name: "Artist" }], "first-release-date": "1980", releases: [] });
  const result = evaluateMusicBrainzCandidates(entry, { recordings: [
    recording("cae8bbec-c2ff-4972-9218-8f90acb07b1b", 100),
    recording("11111111-1111-4111-8111-111111111111", 96)
  ] });
  assert.equal(result.confidence, "ambiguous");
  assert.equal(result.candidate, null);
});

test("high-confidence MusicBrainz enrichment reports existing and missing BOM identities without creating songs", () => {
  const base = { collection_key: "uk-number-ones", chart_year: 1995, source_entry_key: "x", source_name: "wikimedia", source_url: "x", source_revision: "1", artist: "Artist", title: "Song", match_status: "unresolved", source_metadata: { isrcs: [] } };
  const response = { recordings: [{ id: "cae8bbec-c2ff-4972-9218-8f90acb07b1b", title: "Song", score: 100, "artist-credit": [{ name: "Artist" }], "first-release-date": "1995", releases: [{ date: "1995" }] }] };
  const rows = applyMusicBrainzEnrichment([
    base,
    { ...base, source_entry_key: "y", artist: "Other", title: "Other Song" }
  ], {
    "artist|||song": response,
    "other|||other song": { recordings: [{ ...response.recordings[0], id: "11111111-1111-4111-8111-111111111111", title: "Other Song", "artist-credit": [{ name: "Other" }] }] }
  }, [{ id: 9, external_source: "musicbrainz", external_id: "cae8bbec-c2ff-4972-9218-8f90acb07b1b" }]);
  assert.equal(rows[0].musicbrainz_enrichment.already_in_bom, true);
  assert.equal(rows[1].musicbrainz_enrichment.already_in_bom, false);
  assert.equal(rows[0].song_id, undefined);
  assert.deepEqual(summariseMusicBrainzEnrichment(rows), { attempted: 2, high_confidence: 2, probable: 0, still_unresolved: 0, ambiguous: 0, high_confidence_in_bom: 1, high_confidence_absent_from_bom: 1 });
});

test("retains unresolved P4404 and refuses ambiguous fallback or double A-side matches", () => {
  const common = { collection_key: "uk-number-ones", chart_year: 1995, source_entry_key: "x", source_name: "wikimedia", source_url: "x", source_revision: "1", first_number_one_date: "1995-01-01", weeks_at_number_one: 1, number_one_runs: 1, isrcs: [], spotify_track_ids: [] };
  const missing = { ...common, artist: "Missing", title: "Song", article_titles: ["Song"], musicbrainz_recording_ids: ["cae8bbec-c2ff-4972-9218-8f90acb07b1b"] };
  const duplicate = { ...common, source_entry_key: "y", artist: "Artist", title: "Song", article_titles: ["Song"], musicbrainz_recording_ids: [] };
  const doubleSide = { ...common, source_entry_key: "z", artist: "Artist", title: "A / B", article_titles: ["A", "B"], musicbrainz_recording_ids: [] };
  const matched = matchCollectionEntries([missing, duplicate, doubleSide], [
    { id: 1, artist: "Artist", title: "Song" },
    { id: 2, artist: "Artist", title: "Song" }
  ]);
  assert.equal(matched[0].match_status, "unresolved");
  assert.equal(matched[0].musicbrainz_recording_id, missing.musicbrainz_recording_ids[0]);
  assert.equal(matched[1].match_status, "ambiguous");
  assert.equal(matched[2].match_status, "ambiguous");
  assert.deepEqual(summariseMatches(matched), { unique_entries: 3, direct_mbid: 0, identifier: 0, title_artist: 0, mbid_not_in_catalogue: 1, unresolved: 1, ambiguous: 2 });
});

test("straightforward collection evidence can seed a BOM recording while double A-sides stay review-only", () => {
  const base = {
    collection_key: "uk-number-ones", source_entry_key: "1995:1:artist:song",
    source_name: "wikimedia", source_url: "https://example.test", source_revision: "1",
    artist: "Artist", title: "Song", wikidata_qid: "Q123", spotify_track_id: null,
    musicbrainz_recording_id: null, match_status: "unresolved", match_method: null,
    source_metadata: { article_titles: ["Song"], isrcs: [] }
  };
  const seed = canonicalRecordingSeed(base);
  assert.equal(seed.origin_key, "quick-rate:uk-number-ones:1995:1:artist:song");
  assert.equal(seed.wikidata_qid, "Q123");
  assert.equal(seed.musicbrainz_recording_id, null);
  assert.equal(canonicalRecordingSeed({ ...base, match_status: "ambiguous", source_metadata: { article_titles: ["A", "B"] } }), null);
});

test("canonical classification reuses accepted identities, seeds clear singles and reviews multi-recording rows", () => {
  const canonicalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const rows = [
    { artist: "Existing", title: "Single", canonical_song_id: canonicalId, match_status: "identifier", match_method: "wikidata_spotify_track_id", source_metadata: { article_titles: ["Single"], isrcs: [], spotify_track_ids: [] } },
    { artist: "Bombalurina", title: "Itsy Bitsy Teenie Weenie Yellow Polka Dot Bikini", match_status: "unresolved", source_metadata: { article_titles: ["Itsy Bitsy Teenie Weenie Yellow Polka Dot Bikini"], isrcs: [], spotify_track_ids: [] } },
    { artist: "Erasure", title: "Abba-esque (EP)", match_status: "unresolved", source_metadata: { article_titles: ["Abba-esque"], isrcs: [], spotify_track_ids: [] } },
    { artist: "Dunblane", title: "Knockin' on Heaven's Door\" / \"Throw These Guns Away", match_status: "unresolved", source_metadata: { article_titles: ["Knockin' on Heaven's Door"], isrcs: [], spotify_track_ids: [] } }
  ];
  const classified = classifyCanonicalEligibility(rows, []);
  assert.deepEqual(classified.map(row => row.classification), ["A", "B", "C", "C"]);
  assert.equal(classified[1].approved_musicbrainz_recording_id, APPROVED_EXACT_MBIDS[0].mbid);
  assert.deepEqual(summariseCanonicalClassification(classified), {
    total_source_entries: 4, category_a_existing_canonical: 1, category_b_new_bom_canonical: 1,
    category_c_review: 2, known_exact_mbid_entries: 1, entries_with_wikidata_qid: 0,
    entries_with_isrc: 0, entries_with_source_spotify_id: 0, combined_or_double_a_side: 1,
    ep_or_multi_recording: 1, other_ambiguous: 0, carry_over_from_previous_year: 0,
    immediately_rateable: 2, immediately_rateable_percentage: 50, non_rateable: 2,
    rateable_without_exact_mbid: 1
  });
});

test("title/artist alone never merges an existing canonical recording", () => {
  const [row] = classifyCanonicalEligibility([{
    artist: "Artist", title: "Song", canonical_song_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    match_status: "title_artist", source_metadata: { article_titles: ["Song"], isrcs: [], spotify_track_ids: [] }
  }]);
  assert.equal(row.classification, "C");
  assert.equal(row.classification_reason, "title_artist_only_requires_review");
});

test("production import pins the reviewed revision and persists only approved A/B classifications", async () => {
  const importer = await readFile(new URL("../scripts/import-uk-number-ones.mjs", import.meta.url), "utf8");
  assert.match(importer, /sourceRevision \? `oldid=/);
  assert.match(importer, /classified\.filter\(row => \["A", "B"\]\.includes\(row\.classification\)\)/);
  assert.doesNotMatch(importer, /classified\.filter\(row => \["A", "B", "C"\]/);
  assert.match(importer, /seed\.wikidata_qid \? `qid:/);
  assert.match(importer, /row\.wikidata_qid && byQid\.get\(row\.wikidata_qid\)/);
  assert.match(importer, /on_conflict=collection_key,chart_year,source_entry_key/);
});

test("a pinned partial current year imports only represented chart periods", () => {
  const partial = `==Number-one singles==
{|class="wikitable"
|-class="unsortable"
!scope=row colspan=6|{{anchor|2026}}{{sort|1459.1|2026}}
|-
!scope=row|1460
| [[Jamie Miller (singer)|Jamie Miller]] || "[[Babydoll (Jamie Miller song)|Babydoll]]"
|Republic || {{dts|format=dmy|2026|10|29}}||align="center"|1
|}
==By artist==`;
  const rows = parseNumberOneWikitext(partial, { startYear: 2020, endYear: 2026, revision: 1381558626 });
  assert.deepEqual(rows.map(row => [row.chart_year, row.first_number_one_date, row.source_revision]), [
    [2026, "2026-10-29", "1381558626"]
  ]);
});

test("normalization and source keys are stable for duplicate-safe reruns", () => {
  const first = parseNumberOneWikitext(fixture, { startYear: 1995, endYear: 1995, revision: 123 });
  const second = parseNumberOneWikitext(fixture, { startYear: 1995, endYear: 1995, revision: 124 });
  assert.deepEqual(first.map(row => row.source_entry_key), second.map(row => row.source_entry_key));
  assert.equal(collapseNumberOneRuns([...first, ...second]).length, first.length);
});

test("migration is additive, read-only to clients, RLS protected and service-write only", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261022120000_quick_rate_collection_tracks.sql", import.meta.url), "utf8");
  assert.match(sql, /create table public\.quick_rate_collection_tracks/i);
  assert.match(sql, /song_id bigint references public\.songs\(id\) on delete set null/i);
  assert.match(sql, /unique \(collection_key, chart_year, source_entry_key\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant select on table public\.quick_rate_collection_tracks to anon, authenticated/i);
  assert.match(sql, /grant all on table public\.quick_rate_collection_tracks to service_role/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all)[^;]*to (?:anon|authenticated)/i);
});

test("Quick Rate exposes UK No.1s separately without replacing the existing sample", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const discover = await readFile(new URL("../bom-discover.js", import.meta.url), "utf8");
  assert.match(app, /const QUICK_RATE_UK_SINGLES/);
  assert.match(app, /data-quick-collection="uk-singles"/);
  assert.match(app, /data-quick-collection="uk-number-ones"/);
  assert.match(app, /Source: Wikimedia \/ Wikidata/);
  assert.match(app, /fetchQuickRateRows\("quick_rate_collection_tracks"/);
  assert.match(app, /\.range\(offset, offset \+ 999\)/);
  assert.match(app, /filter\(row => row\.collection_key === "uk-number-ones"\)/);
  assert.match(app, /map\(row => Number\(row\.chart_year\)\)/);
  assert.doesNotMatch(app, /Array\.from\(\{ length: 10 \}, \(_, index\) => 1999 - index\)/);
  assert.match(app, /data-quick-listen/);
  assert.match(app, /window\.handleQuickRateListen/);
  assert.doesNotMatch(app.slice(app.indexOf("async function openQuickRate"), app.indexOf("window.handleQuickRateClick")), /resolveQuickRateSpotifyTrack|listenToQuickRateTrack/);
  assert.match(discover, /UK singles by year/);
});
