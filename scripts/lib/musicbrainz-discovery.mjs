const EXCLUDED_SECONDARY = new Set([
  "Audiobook", "Compilation", "DJ-mix", "Demo", "Interview", "Live",
  "Mixtape/Street", "Remix", "Soundtrack", "Spokenword"
]);

export function originalPeriod(releaseDate, groupDate, maxDays = 366) {
  const release = Date.parse(String(releaseDate || ""));
  const group = Date.parse(String(groupDate || ""));
  return Number.isFinite(release) && Number.isFinite(group) &&
    release >= group - 31 * 86400000 && release <= group + maxDays * 86400000;
}

export function qualifyDiscoveryCandidate(group, releases, exclusions = {}) {
  const secondary = group?.["secondary-types"] || [];
  if (group?.["primary-type"] !== "Album") return { accepted: false, reason: "not_primary_album" };
  const unwanted = secondary.find(type => EXCLUDED_SECONDARY.has(type));
  if (unwanted) return { accepted: false, reason: `secondary_type:${unwanted}` };
  if (Number(group?.score || 0) < 95) return { accepted: false, reason: "low_search_score" };
  const credits = (group?.["artist-credit"] || []).filter(value => value?.artist?.id);
  if (credits.length !== 1) return { accepted: false, reason: "ambiguous_artist_credit" };
  const artist = credits[0].artist;
  if (/various artists|tribute|karaoke|cover band/i.test(`${artist.name || ""} ${artist.disambiguation || ""}`)) {
    return { accepted: false, reason: "unsafe_artist_identity" };
  }
  if ((exclusions.release_group_ids || []).includes(group.id)) return { accepted: false, reason: "excluded_release_group" };
  if ((exclusions.artist_ids || []).includes(artist.id)) return { accepted: false, reason: "excluded_artist" };
  const official = (releases || []).filter(release => release?.id &&
    (!release.status || release.status === "Official") && release.country &&
    originalPeriod(release.date, group["first-release-date"]));
  if (!official.length) return { accepted: false, reason: "no_original_official_release" };
  official.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  return { accepted: true, artist, release: official[0] };
}

export async function discoverCandidates({
  get, query, maxPages = 2, pageSize = 25, maxCandidates = 50, exclusions = {}, offset = 0
}) {
  const accepted = [], rejected = [];
  const seenGroups = new Set(), seenArtists = new Set();
  let pagesScanned = 0;
  let exhausted = false;
  for (let page = 0; page < maxPages && accepted.length < maxCandidates; page += 1) {
    const result = await get(`/release-group?query=${encodeURIComponent(query)}` +
      `&fmt=json&limit=${pageSize}&offset=${offset + page * pageSize}`);
    pagesScanned += 1;
    const groups = result["release-groups"] || [];
    if (!groups.length) {
      exhausted = true;
      break;
    }
    for (const group of groups) {
      if (!group?.id || seenGroups.has(group.id)) continue;
      seenGroups.add(group.id);
      const releaseResult = await get(`/release?release-group=${encodeURIComponent(group.id)}` +
        `&status=official&type=album&limit=100&fmt=json`);
      const decision = qualifyDiscoveryCandidate(group, releaseResult.releases || [], exclusions);
      if (!decision.accepted) {
        rejected.push({ release_group_id: group.id, title: group.title, reason: decision.reason });
        continue;
      }
      if (seenArtists.has(decision.artist.id)) continue;
      seenArtists.add(decision.artist.id);
      accepted.push({
        musicbrainz_artist_id: decision.artist.id,
        artist_name: decision.artist.name,
        evidence_release_group_id: group.id,
        evidence_release_group_title: group.title,
        evidence_release_id: decision.release.id,
        first_release_date: group["first-release-date"],
        evidence_release_date: decision.release.date,
        evidence_release_country: decision.release.country,
        search_score: Number(group.score),
        proposed_priority: 100,
        proposed_action: "review_for_queue"
      });
      if (accepted.length >= maxCandidates) break;
    }
  }
  return { accepted, rejected, scanned_release_groups: seenGroups.size,
    next_offset: exhausted ? 0 : offset + pagesScanned * pageSize, exhausted };
}

export function buildDiscoveryWindows({
  startYear = 1950, endYear = new Date().getUTCFullYear(), recentDays = 30,
  now = new Date()
} = {}) {
  const firstDecade = Math.floor(startYear / 10) * 10;
  const lastDecade = Math.floor(endYear / 10) * 10;
  if (!Number.isInteger(firstDecade) || !Number.isInteger(lastDecade) || firstDecade > lastDecade) {
    throw new Error("Invalid historical discovery year range");
  }
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - recentDays * 86400000).toISOString().slice(0, 10);
  const windows = [{ id: "recent", label: `Recent ${from} to ${to}`,
    query: `primarytype:album AND firstreleasedate:[${from} TO ${to}]` }];
  for (let decade = firstDecade; decade <= lastDecade; decade += 10) {
    const upper = Math.min(decade + 9, endYear);
    windows.push({ id: `decade-${decade}`, label: `${decade}-${upper}`,
      query: `primarytype:album AND firstreleasedate:[${decade}-01-01 TO ${upper}-12-31]` });
  }
  return windows;
}

export async function discoverHistoricalCandidates({
  get, windows, state = {}, maxWindows = 4, pageSize = 25, maxCandidates = 50,
  exclusions = {}, maxRememberedIds = 5000
}) {
  if (!Array.isArray(windows) || windows.length === 0) throw new Error("Discovery windows are required");
  const requestedWindowLimit = Number(maxWindows);
  const windowLimit = Math.min(windows.length,
    Number.isFinite(requestedWindowLimit) ? Math.max(1, Math.floor(requestedWindowLimit)) : 1);
  const start = Math.max(0, windows.findIndex(window => window.id === state.next_window_id));
  const offsets = { ...(state.offsets || {}) };
  const rememberedGroups = new Set([...(state.seen_release_group_ids || []),
    ...(exclusions.release_group_ids || [])]);
  const rememberedArtists = new Set([...(state.seen_artist_ids || []), ...(exclusions.artist_ids || [])]);
  const accepted = [], rejected = [], scannedWindows = [];
  let processedWindows = 0;

  for (let index = 0; index < windowLimit && accepted.length < maxCandidates; index += 1) {
    const window = windows[(start + index) % windows.length];
    const result = await discoverCandidates({ get, query: window.query, maxPages: 1, pageSize,
      maxCandidates: maxCandidates - accepted.length, offset: Number(offsets[window.id] || 0),
      exclusions: { ...exclusions, release_group_ids: [...rememberedGroups],
        artist_ids: [...rememberedArtists] } });
    offsets[window.id] = result.next_offset;
    processedWindows += 1;
    scannedWindows.push({ id: window.id, label: window.label,
      offset: Number(offsets[window.id] || 0), exhausted: result.exhausted,
      scanned_release_groups: result.scanned_release_groups });
    for (const row of result.accepted) {
      if (rememberedGroups.has(row.evidence_release_group_id) || rememberedArtists.has(row.musicbrainz_artist_id)) continue;
      rememberedGroups.add(row.evidence_release_group_id);
      rememberedArtists.add(row.musicbrainz_artist_id);
      accepted.push({ ...row, discovery_window_id: window.id, discovery_window_label: window.label });
    }
    for (const row of result.rejected) {
      rememberedGroups.add(row.release_group_id);
      rejected.push({ ...row, discovery_window_id: window.id });
    }
  }

  const nextWindow = windows[(start + processedWindows) % windows.length];
  return {
    accepted, rejected, scanned_windows: scannedWindows,
    resume_state: {
      version: 1,
      next_window_id: nextWindow.id,
      offsets,
      seen_release_group_ids: [...rememberedGroups].slice(-maxRememberedIds),
      seen_artist_ids: [...rememberedArtists].slice(-maxRememberedIds)
    }
  };
}

export function csvForCandidates(rows) {
  const columns = ["musicbrainz_artist_id","artist_name","evidence_release_group_id",
    "evidence_release_group_title","evidence_release_id","first_release_date",
    "evidence_release_date","evidence_release_country","discovery_window_id",
    "discovery_window_label","search_score","proposed_priority","proposed_action"];
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map(row => columns.map(column => escape(row[column])).join(","))].join("\n") + "\n";
}

export function automaticPromotionDesign(rows) {
  return {
    enabled: false,
    kill_switch: "ALBUM_DISCOVERY_KILL_SWITCH",
    enable_flag: "AUTOMATED_QUEUE_PROMOTION_ENABLED",
    requirements: ["human-reviewed artifact", "score>=95", "one artist credit",
      "official original-period release", "not excluded", "idempotent artist MBID"],
    proposed_rows: rows.map(row => ({ artist_name: row.artist_name,
      musicbrainz_artist_id: row.musicbrainz_artist_id, priority: row.proposed_priority }))
  };
}
