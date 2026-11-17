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
  get, query, maxPages = 2, pageSize = 25, maxCandidates = 50, exclusions = {}
}) {
  const accepted = [], rejected = [];
  const seenGroups = new Set(), seenArtists = new Set();
  for (let page = 0; page < maxPages && accepted.length < maxCandidates; page += 1) {
    const result = await get(`/release-group?query=${encodeURIComponent(query)}` +
      `&fmt=json&limit=${pageSize}&offset=${page * pageSize}`);
    const groups = result["release-groups"] || [];
    if (!groups.length) break;
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
  return { accepted, rejected, scanned_release_groups: seenGroups.size };
}

export function csvForCandidates(rows) {
  const columns = ["musicbrainz_artist_id","artist_name","evidence_release_group_id",
    "evidence_release_group_title","evidence_release_id","first_release_date",
    "evidence_release_date","evidence_release_country","search_score","proposed_priority","proposed_action"];
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
