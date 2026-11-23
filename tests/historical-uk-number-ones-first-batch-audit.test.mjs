import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audit = JSON.parse(await readFile(
  new URL("../supabase/operations/historical-uk-number-ones-first-batch-audit-20261123.json", import.meta.url),
  "utf8"
));

const sum = values => values.reduce((total, value) => total + Number(value), 0);
const byChartId = new Map(audit.proposed_batch.map(entry => [entry.chart_entry.id, entry]));

test("first-batch audit is explicitly proposed and reconciles the frozen baseline", () => {
  assert.equal(audit.status, "proposed_not_executed");
  assert.equal(Object.hasOwn(audit, "executed_at"), false);
  assert.equal(audit.captured_at, "2026-11-23T13:13:49.685207Z");
  assert.deepEqual(audit.baseline, {
    total_chart_entries: 1298,
    resolved_chart_entries: 415,
    unresolved_chart_entries: 883
  });
  assert.deepEqual(audit.identity_classification, {
    verified_existing_link: 3,
    verified_catalogue_import: 1,
    ambiguous_or_insufficient_version_evidence: 879
  });
  assert.equal(sum(Object.values(audit.identity_classification)), audit.baseline.unresolved_chart_entries);
});

test("production integrity freezes the catalogue and all 1,746 existing ratings", () => {
  assert.deepEqual(audit.production_integrity, {
    catalogue: {
      albums: 1730,
      songs: 16161,
      canonical_recordings: 17095,
      duplicate_canonical_recording_mbids: 0
    },
    song_ratings: {
      rows: 1746,
      canonical_rows: 976,
      legacy_rows: 770,
      sum: 13446,
      invalid_rows: 0
    },
    provisional_chart_entry_ratings: {
      rows: 5,
      sum: 43
    }
  });
  assert.equal(
    audit.production_integrity.song_ratings.canonical_rows
      + audit.production_integrity.song_ratings.legacy_rows,
    audit.production_integrity.song_ratings.rows
  );
});

test("rating exposure accounts for overlap without double-counting entries", () => {
  const exposure = audit.rating_exposure;
  assert.equal(exposure.placeholder_canonical_rated.entries, 89);
  assert.equal(exposure.placeholder_canonical_rated.rows, 89);
  assert.equal(exposure.provisional_chart_entry_rated.entries, 5);
  assert.equal(exposure.provisional_chart_entry_rated.rows, 5);
  assert.equal(exposure.entries_present_in_both_rating_stores, 2);
  assert.equal(
    exposure.placeholder_canonical_rated.entries
      + exposure.provisional_chart_entry_rated.entries
      - exposure.entries_present_in_both_rating_stores,
    exposure.rating_bearing_entries
  );
  assert.equal(exposure.unrated_entries + exposure.rating_bearing_entries, audit.baseline.unresolved_chart_entries);
});

test("raw lead counts reconcile before and after the proposed batch", () => {
  assert.deepEqual(audit.raw_leads.before_batch, {
    unique_normalized_mbid_identities: 9,
    multiple_normalized_mbid_identities: 1,
    no_normalized_mbid_lead: 873
  });
  assert.equal(sum(Object.values(audit.raw_leads.before_batch)), audit.baseline.unresolved_chart_entries);
  assert.deepEqual(audit.raw_leads.remaining_after_proposed_batch, {
    unverified_unique_normalized_mbid_leads: 6,
    multiple_normalized_mbid_identities: 1,
    no_normalized_mbid_lead: 872
  });
  assert.equal(
    sum(Object.values(audit.raw_leads.remaining_after_proposed_batch)),
    audit.proposed_result.remaining_unresolved_chart_entries
  );
});

test("batch identities are unique and the unrated candidates are recent-first", () => {
  assert.equal(audit.proposed_batch.length, 4);
  assert.deepEqual(audit.proposed_batch.map(entry => entry.batch_order), [1, 2, 3, 4]);
  assert.deepEqual(audit.proposed_batch.map(entry => entry.chart_entry.id), [2498, 2456, 1975, 486]);
  assert.deepEqual(audit.selection_policy.batch_chart_ids, [2498, 2456, 1975, 486]);
  const batchClassCounts = audit.proposed_batch.reduce((counts, entry) => {
    counts[entry.classification] = (counts[entry.classification] || 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(batchClassCounts, { verified_catalogue_import: 1, verified_existing_link: 3 });

  for (const values of [
    audit.proposed_batch.map(entry => entry.chart_entry.id),
    audit.proposed_batch.map(entry => entry.chart_entry.source_entry_key),
    audit.proposed_batch.map(entry => entry.chart_entry.placeholder_canonical_id),
    audit.proposed_batch.map(entry => entry.target.recording_id),
    audit.proposed_batch.map(entry => entry.release_evidence.release_id),
    audit.proposed_batch.map(entry => entry.release_evidence.release_group_id)
  ]) assert.equal(new Set(values).size, audit.proposed_batch.length);

  const recent = audit.proposed_batch.slice(0, 3);
  assert.deepEqual(recent.map(entry => entry.chart_entry.chart_year), [2025, 2021, 2015]);
  assert.ok(recent.every(entry => entry.priority_reason === "recent_first"));
  assert.ok(recent.every(entry => entry.rating_state.state === "unrated"));

  const pilot = audit.proposed_batch[3];
  assert.equal(pilot.chart_entry.id, 486);
  assert.equal(pilot.priority_reason, "explicit_rated_pilot");
  assert.equal(pilot.rating_state.state, "copyable_rated_placeholder");
  assert.equal(pilot.rating_state.copyable_rows, 1);
  assert.equal(pilot.rating_state.requires_rating_preserving_reconciliation, true);
});

test("the four reviewed identities and source releases remain frozen", () => {
  const expected = {
    2498: {
      classification: "verified_catalogue_import",
      source_entry_key: "2025:1434:lola young:messy",
      title: "Messy",
      artist: "Lola Young",
      placeholder: "5aff2430-94b5-41be-9775-c228e67b2afb",
      canonical: "5aff2430-94b5-41be-9775-c228e67b2afb",
      song: null,
      recording: "0ae5ee0e-084e-458b-87ba-76cef24cfff3",
      album: null,
      release: "48351084-aeb6-4a12-a8e7-eb166df6f47f",
      group: "1f428f20-2d3b-4535-a11d-85d28aa37203",
      position: 5,
      duration: 284066,
      official: "https://www.officialcharts.com/songs/lola-young-messy/"
    },
    2456: {
      classification: "verified_existing_link",
      source_entry_key: "2021:1382:little mix:sweet melody",
      title: "Sweet Melody",
      artist: "Little Mix",
      placeholder: "832ec4da-357a-4d99-94c0-a28b904a3b86",
      canonical: "a98ca8b6-da4d-462d-ac3f-2e08da73f93b",
      song: 20308,
      recording: "ece5f285-c5c4-4080-a28d-70409fb802fe",
      album: 1875,
      release: "3907c437-a144-433b-aff7-b172d45a2f3c",
      group: "1a06adad-a1f9-4c1f-8a99-8ad2ea5be289",
      position: 3,
      duration: 213693,
      official: "https://www.officialcharts.com/songs/little-mix-sweet-melody/"
    },
    1975: {
      classification: "verified_existing_link",
      source_entry_key: "2015:1298:charlie puth meghan trainor:marvin gaye",
      title: "Marvin Gaye",
      artist: "Charlie Puth featuring Meghan Trainor",
      placeholder: "8387dca0-8cb2-40d2-a72b-ddf0c3da66d5",
      canonical: "694b6994-1780-4f45-bca5-e29e5b62c289",
      song: 19302,
      recording: "b6ce4adc-5aa2-41d1-8e60-5e4c5bdff371",
      album: 1486,
      release: "6091a9cd-a772-47b9-8082-727facacc97b",
      group: "3c82ff29-b9f1-4348-b20e-11d24d295845",
      position: 3,
      duration: 190453,
      official: "https://www.officialcharts.com/songs/charlie-puth-ft-meghan-trainor-marvin-gaye/"
    },
    486: {
      classification: "verified_existing_link",
      source_entry_key: "1986:573:madonna:papa don t preach",
      title: "Papa Don't Preach",
      artist: "Madonna",
      placeholder: "a4a08d9e-2a24-4afb-adee-a2d196141b5b",
      canonical: "2a602676-3db2-44c2-9446-d2068410953c",
      song: 20169,
      recording: "cc63a878-8663-41ea-884e-873625b6af68",
      album: 1570,
      release: "63180ccf-ac86-40ab-bcef-40b3df8dc385",
      group: "eb9c3e50-cfa9-3502-af63-41d39c4c3fa6",
      position: 1,
      duration: 269000,
      official: "https://www.officialcharts.com/songs/madonna-papa-dont-preach/"
    }
  };

  for (const [chartId, frozen] of Object.entries(expected)) {
    const entry = byChartId.get(Number(chartId));
    assert.ok(entry, `missing chart entry ${chartId}`);
    assert.equal(entry.classification, frozen.classification);
    assert.equal(entry.chart_entry.source_entry_key, frozen.source_entry_key);
    assert.equal(entry.chart_entry.title, frozen.title);
    assert.equal(entry.chart_entry.artist, frozen.artist);
    assert.equal(entry.chart_entry.placeholder_canonical_id, frozen.placeholder);
    assert.equal(entry.target.canonical_id, frozen.canonical);
    assert.equal(entry.target.song_id, frozen.song);
    assert.equal(entry.target.recording_id, frozen.recording);
    assert.equal(entry.target.album_id, frozen.album);
    assert.equal(entry.release_evidence.release_id, frozen.release);
    assert.equal(entry.release_evidence.release_group_id, frozen.group);
    assert.equal(entry.release_evidence.track_position, frozen.position);
    assert.equal(entry.release_evidence.duration_ms, frozen.duration);
    assert.equal(entry.sources.official_charts, frozen.official);
  }

  const messy = byChartId.get(2498);
  assert.equal(messy.target.stored_title, "Messy");
  assert.equal(messy.target.stored_artist, "Lola Young");
  assert.equal(messy.target.album.title, "This Wasn’t Meant for You Anyway");
  assert.equal(messy.target.album.country, "XW");
  assert.equal(messy.target.album.release_date, "2024-06-21");
  assert.equal(messy.release_evidence.isrc, "GBUM72401610");

  const sweet = byChartId.get(2456);
  assert.equal(sweet.target.stored_title, "Sweet Melody");
  assert.equal(sweet.target.stored_artist, "Little Mix");
  assert.equal(sweet.release_evidence.isrc, "GBHMU2000062");

  const marvin = byChartId.get(1975);
  assert.equal(marvin.target.stored_title, "Marvin Gaye");
  assert.equal(marvin.target.stored_artist, "Charlie PuthMeghan Trainor");
  assert.match(marvin.target.metadata_note, /malformed.*does not silently rewrite/i);
  assert.equal(marvin.release_evidence.isrc, "USAT21500254");

  const papa = byChartId.get(486);
  assert.equal(papa.target.stored_title, "Papa Don’t Preach");
  assert.equal(papa.target.stored_artist, "Madonna");
  assert.deepEqual(papa.chart_version_evidence, {
    release_id: "b03043fe-52e6-49b9-90da-8e1ea15d78cd",
    status: "Official",
    country: "GB",
    release_date: "1986-06-16",
    catalogue_number: "W 8636",
    track_position: 1,
    duration_ms: 267000,
    recording_id: "cc63a878-8663-41ea-884e-873625b6af68"
  });
  assert.equal(
    papa.sources.musicbrainz_chart_single_release,
    "https://musicbrainz.org/release/b03043fe-52e6-49b9-90da-8e1ea15d78cd"
  );
});

test("every selected entry carries matching Official Charts and MusicBrainz URLs", () => {
  for (const entry of audit.proposed_batch) {
    assert.match(entry.sources.official_charts, /^https:\/\/www\.officialcharts\.com\/songs\/.+\/$/);
    assert.equal(entry.sources.musicbrainz_recording, `https://musicbrainz.org/recording/${entry.target.recording_id}`);
    assert.equal(entry.sources.musicbrainz_release, `https://musicbrainz.org/release/${entry.release_evidence.release_id}`);
    assert.equal(entry.sources.musicbrainz_release_group, `https://musicbrainz.org/release-group/${entry.release_evidence.release_group_id}`);
  }
});

test("expected catalogue deltas and remaining arithmetic are exact", () => {
  assert.deepEqual(audit.expected_deltas, {
    albums: 1,
    songs: 1,
    canonical_recordings: 0,
    historical_chart_links: 4
  });
  assert.equal(audit.proposed_result.resolved_delta, audit.proposed_batch.length);
  assert.equal(
    audit.proposed_result.resolved_chart_entries,
    audit.baseline.resolved_chart_entries + audit.proposed_result.resolved_delta
  );
  assert.equal(
    audit.proposed_result.remaining_unresolved_chart_entries,
    audit.baseline.unresolved_chart_entries - audit.proposed_result.resolved_delta
  );
  assert.equal(
    audit.proposed_result.resolved_chart_entries + audit.proposed_result.remaining_unresolved_chart_entries,
    audit.baseline.total_chart_entries
  );
});
