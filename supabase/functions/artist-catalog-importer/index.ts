import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireServiceOrAdmin } from "../_shared/authorization.ts";
import { CatalogueWorker, CatalogueDeferral, catalogueFetch, musicBrainzIdentity } from "../_shared/catalogue-worker.ts";
import {
  CATALOGUE_QUALIFICATION_VERSION, CATALOGUE_SELECTION_VERSION,
  mapLegacyProgress, qualifyStudioReleaseGroup, selectCanonicalEdition
} from "../_shared/catalogue-selection.ts";

/*
  Three candidates is a ceiling, not a duration guarantee. Discovery pages and
  albums are checkpointed independently within the shared 23-second budget.
*/
const ALBUMS_PER_RUN = 3;
const SHADOW_MODE = Deno.env.get("CATALOGUE_SELECTION_SHADOW_MODE") === "true";

const EXCLUDED_SECONDARY_TYPES =
  new Set([
    "Compilation",
    "Demo",
    "DJ-mix",
    "Live",
    "Mixtape/Street",
    "Remix",
    "Spokenword",
    "Interview",
    "Audiobook"
  ]);

function normalise(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function normaliseAlbumTitle(value: unknown) {
  const source = String(value ?? "").normalize("NFKC").trim();
  const ordinary = normalise(source).replace(/\s+/g, "");
  if (ordinary) return ordinary;
  return source
    ? `symbols:${Array.from(source).map(character => character.codePointAt(0)!.toString(16)).join("-")}`
    : "";
}

function normaliseAlbumKey(
  title: unknown,
  artist: unknown
) {
  return [
    normalise(artist),
    normaliseAlbumTitle(title)
  ].join("|||");
}

function albumTitleFallbackMatches(album: any, payload: any) {
  const wantedTitle = normaliseAlbumTitle(payload.title);
  if (!wantedTitle || normalise(album.artist) !== normalise(payload.artist) ||
      normaliseAlbumTitle(album.title) !== wantedTitle) return false;

  const albumGroupId = album.musicbrainz_release_group_id || "";
  const payloadGroupId = payload.musicbrainz_release_group_id || "";
  if (albumGroupId && payloadGroupId && albumGroupId !== payloadGroupId) return false;

  const albumReleaseId = album.musicbrainz_release_id ||
    (album.external_source === "musicbrainz" ? album.external_id : "") || "";
  const payloadReleaseId = payload.musicbrainz_release_id ||
    (payload.external_source === "musicbrainz" ? payload.external_id : "") || "";
  return !(albumReleaseId && payloadReleaseId && albumReleaseId !== payloadReleaseId);
}

function databaseReleaseDate(value: unknown) {
  const date = String(value || "").trim();
  if (/^\d{4}$/.test(date)) return `${date}-01-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return `${date}-01`;
  if (/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) return date;
  return null;
}

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "";

const adminKey =
  getAdminKey();

const contactEmail =
  Deno.env.get(
    "MUSICBRAINZ_CONTACT_EMAIL"
  );

if (!supabaseUrl || !adminKey) {
  throw new Error(
    "Missing Supabase server credentials."
  );
}

const supabase =
  createClient(
    supabaseUrl,
    adminKey,
    {
      global: { fetch: catalogueFetch },
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

async function resolveArtist(
  artistName: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  const query =
    `artist:"${artistName.replaceAll('"', "")}"`;

  const data =
    await musicBrainzGet(
      `/artist/?query=${encodeURIComponent(query)}` +
      `&fmt=json&limit=25`
    );

  const exact =
    (data.artists || [])
      .filter(
        (artist: any) =>
          normalise(artist.name) ===
          normalise(artistName)
      )
      .filter(
        (artist: any) =>
          !/tribute|cover|karaoke|impersonator/i
            .test(
              `${artist.disambiguation || ""}`
            )
      )
      .sort(
        (a: any, b: any) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

  const match =
    exact[0] ||
    data.artists?.[0];

  if (!match?.id) {
    throw new Error(
      `No MusicBrainz artist found for ${artistName}.`
    );
  }

  return match;
}

async function fetchArtistDetails(
  artistId: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  const data =
    await musicBrainzGet(
      `/artist/${encodeURIComponent(artistId)}?fmt=json`
    );

  return {
    id:
      data.id || artistId,
    name:
      data.name || "",
    country:
      String(
        data.country || ""
      ).toUpperCase(),
    begin:
      data["life-span"]?.begin || "",
    end:
      data["life-span"]?.end || "",
    ended:
      Boolean(
        data["life-span"]?.ended
      )
  };
}

function yearFromDate(
  value: unknown
) {
  const match =
    String(value || "")
      .match(/^(\d{4})/);

  return match
    ? Number(match[1])
    : null;
}

function isReleaseGroupWithinArtistEra(
  group: any,
  artistDetails: any
) {
  const releaseYear =
    yearFromDate(
      group?.["first-release-date"]
    );

  const endYear =
    yearFromDate(
      artistDetails?.end
    );

  /*
    If MusicBrainz says the group ended, allow a two-year grace
    period but reject much later archive/bootleg-style album
    groups that have no useful secondary type.
  */
  if (
    artistDetails?.ended &&
    releaseYear &&
    endYear &&
    releaseYear > endYear + 2
  ) {
    return false;
  }

  return true;
}

function isStudioReleaseGroup(group: any) {
  return group["primary-type"] === "Album" &&
    !(group["secondary-types"] || []).some((type: string) => EXCLUDED_SECONDARY_TYPES.has(type));
}

async function discoverCatalogue(queue: any, worker: CatalogueWorker, checkpoint: any) {
  let state = checkpoint.state;
  const get = (path: string) => worker.musicBrainzGet(path);
  async function save() {
    checkpoint = await worker.rpc("discovery", { revision: checkpoint.revision, state });
    state = checkpoint.state;
  }
  if (state.ready) return state; // Frozen snapshot: never fetch/re-sort it again.
  if (!state.artist_id) {
    worker.ensureBudget();
    state.artist_id = queue.musicbrainz_artist_id || (await resolveArtist(queue.artist_name, get)).id;
    await save();
  }
  if (!state.artist_details) {
    worker.ensureBudget();
    state.artist_details = await fetchArtistDetails(state.artist_id, get);
    await save();
  }
  while (!state.ready) {
    worker.ensureBudget();
    const data = await get(`/release-group?artist=${encodeURIComponent(state.artist_id)}` +
      `&type=album&limit=100&offset=${state.offset}&fmt=json`);
    const page = data["release-groups"] || [];
    const groups = new Map(state.groups.map((g: any) => [g.id, g]));
    const shadowGroups = new Map((state.shadow_groups || []).map((g: any) => [g.id, g]));
    for (const g of page) {
      const frozen = { id: g.id, title: g.title, "primary-type": g["primary-type"],
        "secondary-types": g["secondary-types"] || [], "artist-credit": g["artist-credit"] || [],
        "first-release-date": g["first-release-date"] || "" };
      if (g.id && g["primary-type"] === "Album") shadowGroups.set(g.id, frozen);
      if (g.id && isStudioReleaseGroup(g) && isReleaseGroupWithinArtistEra(g, state.artist_details)) {
        groups.set(g.id, frozen);
      }
    }
    state.groups = [...groups.values()];
    state.shadow_groups = [...shadowGroups.values()];
    state.offset += page.length;
    state.ready = !page.length || state.offset >= Number(data["release-group-count"] || state.offset);
    if (state.ready) {
      // Keep the previous sort and stable insertion order for equal dates.
      state.groups.sort((a: any, b: any) => String(a["first-release-date"] || "9999-99-99")
        .localeCompare(String(b["first-release-date"] || "9999-99-99")));
      state.shadow_groups.sort((a: any, b: any) => String(a["first-release-date"] || "9999-99-99")
        .localeCompare(String(b["first-release-date"] || "9999-99-99")));
    }
    await save(); // Each page is durable, even if the next call is deferred.
  }
  return state;
}

async function chooseOfficialRelease(
  releaseGroupId: string,
  artistCountry: string,
  groupFirstReleaseDate: string,
  musicBrainzGet: (path: string) => Promise<any>
) {
  const data =
    await musicBrainzGet(
      `/release?release-group=${encodeURIComponent(releaseGroupId)}` +
      `&status=official&type=album&limit=100&inc=artist-credits&fmt=json`
    );

  const releases =
    (data.releases || [])
      .filter(
        (release: any) =>
          release?.id
      );

  if (!releases.length) {
    return { release: null, reason: "no_official_releases", considered_releases: releases };
  }

  const homeCountry =
    String(
      artistCountry || ""
    ).toUpperCase();

  const firstDate =
    String(
      groupFirstReleaseDate || ""
    ).trim();

  function dateToUtcMs(
    value: string
  ) {
    const parts =
      String(value || "")
        .split("-")
        .map(Number);

    const year =
      parts[0];

    const month =
      parts[1] || 1;

    const day =
      parts[2] || 1;

    if (!year) {
      return null;
    }

    return Date.UTC(
      year,
      month - 1,
      day
    );
  }

  function releaseIsCloseToGroupStart(
    releaseDate: unknown,
    groupDate: string
  ) {
    const release =
      String(
        releaseDate || ""
      ).trim();

    if (!release || !groupDate) {
      return false;
    }

    const groupParts =
      groupDate.split("-");

    const releaseParts =
      release.split("-");

    /*
      If either MusicBrainz date is incomplete,
      compare only the precision that exists.

      Examples:
      group:   1986-03-24
      release: 1986

      should still be treated as the same
      original release period.
    */

    if (
      groupParts.length === 1 ||
      releaseParts.length === 1
    ) {
      return (
        releaseParts[0] ===
        groupParts[0]
      );
    }

    if (
      groupParts.length === 2 ||
      releaseParts.length === 2
    ) {
      return (
        releaseParts[0] ===
          groupParts[0] &&
        releaseParts[1] ===
          groupParts[1]
      );
    }

    const groupMs =
      dateToUtcMs(groupDate);

    const releaseMs =
      dateToUtcMs(release);

    if (
      groupMs === null ||
      releaseMs === null
    ) {
      return false;
    }

    const days =
      Math.floor(
        (releaseMs - groupMs) /
        86400000
      );

    /*
      Accept normal staggered original releases, but reject
      home-market releases that only appear much later.
    */
    return (
      days >= 0 &&
      days <= 75
    );
  }

  let eligible =
    releases;

  // A staggered home-market launch is different from a regional catalogue
  // resurfacing as a reissue decades later. Require month-or-better dates,
  // evidence of an original-period edition, and an actual home-country
  // edition within one year. XW/XE reissues cannot establish this exception.
  // Use the entire possible date range so incomplete dates cannot stretch
  // the window (notably a year-only date).
  function dateRange(value: unknown): [number, number] | null {
    const match = String(value || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || (day !== null && (day < 1 || day > lastDay))) {
      return null;
    }
    return [Date.UTC(year, month - 1, day ?? 1), Date.UTC(year, month - 1, day ?? lastDay)];
  }

  const groupRange = dateRange(firstDate);
  function withinOriginalWindow(release: any, maxDays: number) {
    const range = dateRange(release.date);
    return Boolean(groupRange && range &&
      range[0] >= groupRange[0] &&
      range[1] - groupRange[0] <= maxDays * 86400000);
  }

  const hasOriginalEdition = releases.some((release: any) =>
    withinOriginalWindow(release, 75)
  );

  if (homeCountry) {
    const homeOrInternational =
      releases.filter(
        (release: any) => {
          const country =
            String(
              release.country || ""
            ).toUpperCase();

          return (
            country === homeCountry ||
            country === "XW" ||
            country === "XE"
          );
        }
      );

    if (!homeOrInternational.length) {
      return { release: null, reason: "no_home_or_international_release", considered_releases: releases };
    }

    if (firstDate) {
      let originalHomeRelease =
        homeOrInternational.filter(
          (release: any) =>
            releaseIsCloseToGroupStart(
              release.date,
              firstDate
            )
        );

      if (!originalHomeRelease.length && hasOriginalEdition) {
        originalHomeRelease = homeOrInternational.filter((release: any) =>
          String(release.country || "").toUpperCase() === homeCountry &&
          withinOriginalWindow(release, 366)
        );
      }

      if (!originalHomeRelease.length) {
        console.log(
          "IMPORTER: rejecting regional/later release group",
          releaseGroupId,
          "group first date:",
          firstDate,
          "home:",
          homeCountry
        );

        return {
          release: null,
          reason: "regional_or_later_release",
          group_first_release_date: firstDate,
          home_country: homeCountry,
          home_release_dates: homeOrInternational.map((release: any) => ({
            country: release.country,
            date: release.date || null
          })),
          considered_releases: releases
        };
      }

      eligible =
        originalHomeRelease;
    } else {
      eligible =
        homeOrInternational;
    }
  }

  const preferredCountries =
    [
      homeCountry,
      "XW",
      "XE",
      "GB",
      "US"
    ].filter(Boolean);

  eligible.sort(
    (a: any, b: any) => {
      const dateCompare =
        String(
          a.date || "9999-99-99"
        ).localeCompare(
          String(
            b.date ||
            "9999-99-99"
          )
        );

      if (dateCompare !== 0) {
        return dateCompare;
      }

      const aCountry =
        preferredCountries.indexOf(
          String(a.country || "")
            .toUpperCase()
        );

      const bCountry =
        preferredCountries.indexOf(
          String(b.country || "")
            .toUpperCase()
        );

      return (
        (aCountry === -1
          ? 99
          : aCountry) -
        (bCountry === -1
          ? 99
          : bCountry)
      );
    }
  );

  return { release: eligible[0], reason: null, considered_releases: releases };
}

async function loadQualificationOverrides() {
  const { data, error } = await supabase.from("artist_catalogue_overrides")
    .select("release_group_id,qualification,canonical_release_id,original_release_date,reason,decision_note,decided_at,decision_source");
  if (error) throw new Error(`Catalogue override lookup failed: ${error.message}`);
  return data || [];
}

function qualificationEvidence(snapshot: any, releases?: any[]) {
  return { artistId: snapshot.artist_id, artistEnded: Boolean(snapshot.artist_details?.ended),
    artistEndDate: snapshot.artist_details?.end || null, releases };
}

function structuredArtistCredit(value: any) {
  if (!Array.isArray(value)) return [];
  return value.filter(credit => credit?.artist?.id).map(credit => ({
    ...credit, artist: { ...credit.artist, id: String(credit.artist.id) }
  }));
}

function enrichedShadowGroup(group: any, releases: any[] = [], preferredReleaseId?: string | null) {
  if (structuredArtistCredit(group?.["artist-credit"]).length) return group;
  const ordered = [...releases].filter(release => structuredArtistCredit(release?.["artist-credit"]).length)
    .sort((a, b) => {
      if (a.id === preferredReleaseId) return -1;
      if (b.id === preferredReleaseId) return 1;
      return String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99")) ||
        String(a.id).localeCompare(String(b.id));
    });
  return ordered.length ? { ...group, "artist-credit": structuredArtistCredit(ordered[0]["artist-credit"]) } : group;
}

async function loadShadowDecisionEvidence(jobId: number) {
  const { data, error } = await supabase.from("artist_catalogue_shadow_decisions")
    .select("release_group_id,qualification,artist_credit")
    .eq("job_id", jobId)
    .eq("qualification_version", CATALOGUE_QUALIFICATION_VERSION)
    .eq("selection_version", CATALOGUE_SELECTION_VERSION);
  if (error) throw new Error(`Shadow decision lookup failed: ${error.message}`);
  return new Map<string, any>((data || []).map((row: any) => [String(row.release_group_id), row]));
}

function shadowQualification(snapshot: any, overrides: any[], decisions = new Map<string, any>()) {
  const qualified: string[] = [];
  const review: string[] = [];
  for (const group of snapshot.shadow_groups || snapshot.groups) {
    // Pre-v1 frozen snapshots omitted types after already passing the legacy
    // Album filter. Preserve that fact while mapping progress by group ID.
    const observed = decisions.get(group.id);
    const enriched = observed?.artist_credit?.length
      ? { ...group, "artist-credit": observed.artist_credit } : group;
    const result = observed ? {
      qualified: observed.qualification === "include", review: observed.qualification === "review"
    } : qualifyStudioReleaseGroup({ "primary-type": "Album",
      "secondary-types": [], ...enriched }, overrides, qualificationEvidence(snapshot));
    if (result.qualified) qualified.push(group.id);
    if (result.review) review.push(group.id);
  }
  return { qualified_release_group_ids: qualified, review_release_group_ids: review };
}

async function recordShadowSnapshot(queue: any, snapshot: any, overrides: any[]) {
  if (!SHADOW_MODE || !snapshot?.ready) return;
  const decisions = await loadShadowDecisionEvidence(queue.id);
  const shadow = shadowQualification(snapshot, overrides, decisions);
  const mapped = mapLegacyProgress(snapshot.groups, queue.next_album_index,
    shadow.qualified_release_group_ids);
  const { error } = await supabase.from("artist_catalogue_shadow_snapshots").upsert({
    job_id: queue.id, qualification_version: CATALOGUE_QUALIFICATION_VERSION,
    qualified_release_group_ids: shadow.qualified_release_group_ids,
    review_release_group_ids: shadow.review_release_group_ids,
    legacy_processed_release_group_ids: mapped.legacy_processed_group_ids,
    proposed_next_index: mapped.next_qualified_index, ready: true, updated_at: new Date().toISOString()
  }, { onConflict: "job_id,qualification_version" });
  if (error) throw new Error(`Shadow snapshot write failed: ${error.message}`);
  for (const group of snapshot.shadow_groups || []) {
    const qualification = qualifyStudioReleaseGroup(group, overrides, qualificationEvidence(snapshot));
    if (qualification.review && !["missing_artist_credit", "missing_release_evidence"]
      .includes(qualification.reason)) {
      await persistReviewCandidate(queue, group, qualification, { release: null, strategy: null }, snapshot);
    }
  }
}

async function persistReviewCandidate(queue: any, group: any, qualification: any,
  proposed: any, snapshot: any) {
  const { error } = await supabase.rpc("upsert_artist_catalogue_review", {
    p_release_group_id: group.id, p_musicbrainz_artist_id: snapshot.artist_id,
    p_artist_name: queue.artist_name, p_release_group_title: group.title,
    p_release_group_original_date: group["first-release-date"] || null,
    p_review_reason: qualification.reason, p_proposed_release_id: proposed.release?.id || null,
    p_proposed_release_date: proposed.release?.date || null,
    p_proposed_release_country: proposed.release?.country || null,
    p_proposed_selection_strategy: proposed.strategy || null
  });
  if (error) throw new Error(`Catalogue review write failed: ${error.message}`);
}

async function recordShadowDecision(queue: any, group: any, overrides: any[],
  legacy: any, releases: any[], snapshot: any) {
  if (!SHADOW_MODE) return;
  group = enrichedShadowGroup(group, releases, legacy.release?.id);
  const qualification = qualifyStudioReleaseGroup({ "primary-type": "Album",
    "secondary-types": [], ...group }, overrides, qualificationEvidence(snapshot, releases));
  const override = qualification.override;
  const proposed = qualification.qualified || qualification.review
    ? selectCanonicalEdition(releases, queue.shadow_artist_country || "", group["first-release-date"], override)
    : { release: null, strategy: null, review: qualification.review };
  const row = {
    job_id: queue.id, release_group_id: group.id,
    qualification_version: CATALOGUE_QUALIFICATION_VERSION,
    selection_version: CATALOGUE_SELECTION_VERSION, release_group_title: group.title,
    original_release_date: override?.original_release_date || group["first-release-date"] || null,
    qualification: qualification.review ? "review" : qualification.qualified ? "include" : "exclude",
    qualification_reason: qualification.reason,
    proposed_release_id: proposed.release?.id || null,
    proposed_release_date: proposed.release?.date || null,
    proposed_release_country: proposed.release?.country || null,
    selection_strategy: proposed.strategy, legacy_release_id: legacy.release?.id || null,
    legacy_reason: legacy.reason || null, artist_credit: structuredArtistCredit(group["artist-credit"]),
    observed_at: new Date().toISOString()
  };
  const { error } = await supabase.from("artist_catalogue_shadow_decisions").upsert(row, {
    onConflict: "job_id,release_group_id,qualification_version,selection_version"
  });
  if (error) throw new Error(`Shadow decision write failed: ${error.message}`);
  if (qualification.review) {
    await persistReviewCandidate(queue, group, qualification, proposed, snapshot);
  }
  console.log("CATALOGUE_SHADOW", JSON.stringify(row));
  return { qualification, proposed, row };
}

function protectedQualificationOverride(groupId: string, overrides: any[]) {
  return overrides.find((override: any) => override.release_group_id === groupId &&
    ["policy", "human"].includes(override.decision_source) &&
    ["include", "exclude", "review"].includes(override.qualification));
}

async function prepareAlbum(
  payload: any,
  worker: CatalogueWorker
) {
  let existingAlbum: any = null;

  if (
    payload.external_source &&
    payload.external_id
  ) {
    worker.ensureBudget(7500);
    const {
      data,
      error
    } = await supabase
      .from("albums")
      .select(
        "id, title, artist, external_source, external_id, musicbrainz_release_id, musicbrainz_release_group_id, cover_art_url, release_date"
      )
      .eq(
        "external_source",
        payload.external_source
      )
      .eq(
        "external_id",
        payload.external_id
      )
      .maybeSingle();

    if (error) {
      throw new Error(
        `External-ID lookup failed for "${payload.title}": ` +
        error.message
      );
    }

    existingAlbum = data || null;
  }

  if (!existingAlbum && payload.musicbrainz_release_group_id) {
    worker.ensureBudget(7500);
    const { data, error } = await supabase.from("albums")
      .select("id, title, artist, external_source, external_id, cover_art_url, release_date")
      .eq("musicbrainz_release_group_id", payload.musicbrainz_release_group_id).maybeSingle();
    if (error) throw new Error(`Release-group lookup failed for "${payload.title}": ${error.message}`);
    existingAlbum = data || null;
  }

  if (!existingAlbum) {
    worker.ensureBudget(7500);
    /*
      Compare a normalised artist + album title rather than relying
      on exact punctuation/capitalisation. This prevents duplicates
      such as straight-vs-curly apostrophes in Sgt. Pepper.
    */
    const {
      data: artistAlbums,
      error
    } = await supabase
      .from("albums")
      .select(
        "id, title, artist, external_source, external_id, musicbrainz_release_id, musicbrainz_release_group_id, cover_art_url, release_date"
      )
      .ilike(
        "artist",
        payload.artist
      );

    if (error) {
      throw new Error(
        `Title/artist lookup failed for "${payload.title}": ` +
        error.message
      );
    }

    existingAlbum =
      (artistAlbums || []).find(
        (album: any) => albumTitleFallbackMatches(album, payload)
      ) || null;
  }

  return { existing_id: existingAlbum?.id ?? null, payload };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }
  // Same budget for manual and scheduled calls; no caller can bypass the lease.
  const worker = new CatalogueWorker(supabase, 23000, musicBrainzIdentity(contactEmail));
  const authorization = await requireServiceOrAdmin(request);
  if (!authorization.ok) return authorization.response;
  let queue: any;
  const skipped: string[] = [];
  const skippedDetails: Record<string, unknown>[] = [];
  let importedThisRun = 0;
  let scannedThisRun = 0;
  let snapshot: any;
  let deferred: CatalogueDeferral | undefined;
  const shadowObservations: any[] = [];
  let qualificationOverrides: any[] = [];
  let reviewPending: any = null;

  try {
    worker.ensureBudget();
    const claimed = await worker.acquire();
    if (claimed.busy) return Response.json({ ok: true, deferred: "worker_busy" });
    if (claimed.idle) return Response.json({ ok: true, message: "No artists waiting." });
    queue = claimed.job;
    try {
      snapshot = await discoverCatalogue(queue, worker, claimed.discovery);
      queue.shadow_artist_country = snapshot.artist_details.country;
      // Final policy/human decisions are an authority boundary even while the
      // general v2 selector remains observational.
      qualificationOverrides = await loadQualificationOverrides();
      while (scannedThisRun < ALBUMS_PER_RUN && queue.next_album_index < snapshot.groups.length) {
        worker.ensureBudget();
        const group = snapshot.groups[queue.next_album_index];
        const legacySelection = await chooseOfficialRelease(group.id,
          snapshot.artist_details.country, group["first-release-date"], path => worker.musicBrainzGet(path));
        const { release, considered_releases: consideredReleases = [], ...diagnostic } = legacySelection;
        const protectedOverride = protectedQualificationOverride(group.id, qualificationOverrides);
        if (protectedOverride) {
          await recordShadowDecision(queue, group, qualificationOverrides,
            legacySelection, consideredReleases, snapshot);
        } else if (SHADOW_MODE) {
          shadowObservations.push({ group, legacySelection, consideredReleases });
        }
        if (protectedOverride?.qualification === "review") {
          const result = await worker.review(queue.next_album_index, group.id);
          queue = result.job;
          reviewPending = {
            release_group_id: result.release_group_id,
            release_group_title: result.release_group_title,
            reason: protectedOverride.reason,
            decision_source: protectedOverride.decision_source
          };
          break;
        }
        let album = null;
        const protectedExclude = protectedOverride?.qualification === "exclude";
        if (release?.id && !protectedExclude) {
          const payload = {
            title: String(release.title || group.title || "").trim(),
            artist: queue.artist_name, external_source: "musicbrainz", external_id: release.id,
            musicbrainz_release_id: release.id, musicbrainz_release_group_id: group.id,
            cover_art_url: `https://coverartarchive.org/release-group/${encodeURIComponent(group.id)}/front-250`,
            release_date: databaseReleaseDate(
              group["first-release-date"] || release.date
            )
          };
          // An album lookup may consume its full seven-second database limit;
          // retain enough time for the fenced album/progress checkpoint.
          worker.ensureBudget(14500);
          album = await prepareAlbum(payload, worker); // Reads only; mutations are fenced in the RPC.
        }
        worker.ensureBudget(3500);
        queue = await worker.rpc("album", {
          index: queue.next_album_index, group_id: group.id, group_title: group.title, album
        });
        scannedThisRun++;
        if (release?.id && !protectedExclude) importedThisRun++;
        else {
          skipped.push(group.title);
          skippedDetails.push({ title: group.title, release_group_id: group.id,
            ...(protectedExclude ? { reason: "qualification_exclude",
              qualification_reason: protectedOverride.reason,
              decision_source: protectedOverride.decision_source } : diagnostic) });
        }
      }
    } catch (error) {
      if (!(error instanceof CatalogueDeferral)) throw error;
      deferred = error;
    }
    if (!reviewPending) queue = await worker.finish(deferred);
    if (SHADOW_MODE && snapshot?.ready) {
      const shadowQueue = { ...queue, shadow_artist_country: snapshot.artist_details.country };
      const comparison = (async () => {
        try {
          const overrides = await loadQualificationOverrides();
          for (const observation of shadowObservations) {
            await recordShadowDecision(shadowQueue, observation.group, overrides,
              observation.legacySelection, observation.consideredReleases, snapshot);
          }
          await recordShadowSnapshot(shadowQueue, snapshot, overrides);
        } catch (error) {
          console.error("CATALOGUE_SHADOW_WRITE_FAILED", String((error as Error).message));
        }
      })();
      const waitUntil = (globalThis as any).EdgeRuntime?.waitUntil;
      if (typeof waitUntil === "function") waitUntil(comparison);
      else await comparison;
    }
    return Response.json({
      ok: true, artist: queue.artist_name, complete: queue.status === "complete",
      discovery_complete: Boolean(snapshot?.ready), deferred: deferred?.reason || null,
      batch_size: scannedThisRun, albums_accepted_this_run: importedThisRun,
      albums_accepted_total: queue.studio_albums_imported,
      candidate_groups: queue.total_studio_albums, groups_scanned: queue.next_album_index,
      groups_remaining: Math.max(0, queue.total_studio_albums - queue.next_album_index),
      albums_skipped_this_run: skipped.length, skipped, skipped_details: skippedDetails,
      imported_this_run: importedThisRun, imported_total: queue.studio_albums_imported,
      total_studio_albums: queue.total_studio_albums, next_album_index: queue.next_album_index,
      review_pending: reviewPending
    });
  } catch (error) {
    let failure = String((error as Error)?.message || error);
    try {
      await worker.finish(error);
      if (error instanceof CatalogueDeferral) {
        return Response.json({ ok: true, deferred: error.reason });
      }
    }
    catch (checkpointError) {
      failure += `; failure checkpoint rejected: ${String((checkpointError as Error).message)}`;
    }
    return Response.json({ ok: false, artist: queue?.artist_name, error: failure }, { status: 500 });
  }
});
