import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireServiceOrAdmin } from "../_shared/authorization.ts";

const MUSICBRAINZ_BASE =
  "https://musicbrainz.org/ws/2";

const REQUEST_DELAY_MS = 1100;

/*
  Keep each Edge Function invocation deliberately small.
  Three albums usually means only a handful of MusicBrainz calls,
  so the function finishes well before hosted runtime limits.
*/
const ALBUMS_PER_RUN = 3;

const EXCLUDED_SECONDARY_TYPES =
  new Set([
    "Compilation",
    "DJ-mix",
    "Live",
    "Mixtape/Street",
    "Remix",
    "Spokenword",
    "Interview",
    "Audiobook"
  ]);

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function normalise(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normaliseAlbumKey(
  title: unknown,
  artist: unknown
) {
  return [
    normalise(artist),
    normalise(title)
  ].join("|||");
}

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "";

const adminKey =
  getAdminKey();

const contactEmail =
  Deno.env.get(
    "MUSICBRAINZ_CONTACT_EMAIL"
  ) || "bom-catalogue-importer@example.invalid";

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
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

let lastMusicBrainzRequestAt = 0;

async function musicBrainzGet(
  path: string
) {
  const maxAttempts = 5;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const elapsed =
      Date.now() -
      lastMusicBrainzRequestAt;

    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(
        REQUEST_DELAY_MS - elapsed
      );
    }

    lastMusicBrainzRequestAt =
      Date.now();

    let response: Response;

    const controller =
      new AbortController();

    const timeoutId =
      setTimeout(
        () => controller.abort(),
        15000
      );

    try {
      console.log(
        `MusicBrainz request attempt ${attempt}:`,
        path
      );

      response =
        await fetch(
          `${MUSICBRAINZ_BASE}${path}`,
          {
            headers: {
              Accept: "application/json",
              "User-Agent":
                `BankOfMusic/1.0 (${contactEmail})`
            },
            signal:
              controller.signal
          }
        );
    } catch (error) {
      clearTimeout(timeoutId);

      const message =
        String(
          (error as any)?.message ||
          error
        );

      console.warn(
        "MusicBrainz fetch error:",
        path,
        message
      );

      if (attempt === maxAttempts) {
        throw new Error(
          `MusicBrainz request failed for ${path}: ${message}`
        );
      }

      const waitMs =
        1500 *
        Math.pow(2, attempt - 1);

      await sleep(waitMs);
      continue;
    }

    clearTimeout(timeoutId);

    if (response.ok) {
      return response.json();
    }

    const body =
      await response.text();

    const retryable =
      response.status === 429 ||
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504;

    if (
      !retryable ||
      attempt === maxAttempts
    ) {
      throw new Error(
        `MusicBrainz ${response.status}: ` +
        body.slice(0, 300)
      );
    }

    const retryAfterSeconds =
      Number(
        response.headers.get(
          "retry-after"
        ) || 0
      );

    const waitMs =
      retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : 1500 *
          Math.pow(
            2,
            attempt - 1
          );

    await sleep(waitMs);
  }

  throw new Error(
    "MusicBrainz request failed after retries."
  );
}

async function resolveArtist(
  artistName: string
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
  artistId: string
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

async function fetchStudioReleaseGroups(
  artistId: string
) {
  const allGroups: any[] = [];
  let offset = 0;

  while (true) {
    const data =
      await musicBrainzGet(
        `/release-group?artist=${encodeURIComponent(artistId)}` +
        `&type=album&limit=100&offset=${offset}&fmt=json`
      );

    const groups =
      data["release-groups"] || [];

    allGroups.push(...groups);

    offset += groups.length;

    if (
      groups.length === 0 ||
      offset >=
        Number(
          data["release-group-count"] ||
          allGroups.length
        )
    ) {
      break;
    }
  }

  const studio =
    allGroups.filter(
      (group: any) => {
        if (
          group["primary-type"] !==
          "Album"
        ) {
          return false;
        }

        const secondary =
          group["secondary-types"] || [];

        return !secondary.some(
          (type: string) =>
            EXCLUDED_SECONDARY_TYPES.has(
              type
            )
        );
      }
    );

  const byId =
    new Map<string, any>();

  for (const group of studio) {
    if (group?.id) {
      byId.set(group.id, group);
    }
  }

  return [...byId.values()]
    .sort(
      (a: any, b: any) =>
        String(
          a["first-release-date"] ||
          "9999-99-99"
        ).localeCompare(
          String(
            b["first-release-date"] ||
            "9999-99-99"
          )
        )
    );
}

async function chooseOfficialRelease(
  releaseGroupId: string,
  artistCountry = "",
  groupFirstReleaseDate = ""
) {
  const data =
    await musicBrainzGet(
      `/release?release-group=${encodeURIComponent(releaseGroupId)}` +
      `&status=official&type=album&limit=100&fmt=json`
    );

  const releases =
    (data.releases || [])
      .filter(
        (release: any) =>
          release?.id
      );

  if (!releases.length) {
    return null;
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
      return null;
    }

    if (firstDate) {
      const originalHomeRelease =
        homeOrInternational.filter(
          (release: any) =>
            releaseIsCloseToGroupStart(
              release.date,
              firstDate
            )
        );

      if (!originalHomeRelease.length) {
        console.log(
          "IMPORTER: rejecting regional/later release group",
          releaseGroupId,
          "group first date:",
          firstDate,
          "home:",
          homeCountry
        );

        return null;
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

  return eligible[0] || null;
}

async function upsertAlbum(
  payload: any
) {
  let existingAlbum: any = null;

  if (
    payload.external_source &&
    payload.external_id
  ) {
    const {
      data,
      error
    } = await supabase
      .from("albums")
      .select(
        "id, title, artist, external_source, external_id, cover_art_url, release_date"
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

  if (!existingAlbum) {
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
        "id, title, artist, external_source, external_id, cover_art_url, release_date"
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

    const wantedKey =
      normaliseAlbumKey(
        payload.title,
        payload.artist
      );

    existingAlbum =
      (artistAlbums || []).find(
        (album: any) =>
          normaliseAlbumKey(
            album.title,
            album.artist
          ) === wantedKey
      ) || null;
  }

  if (existingAlbum?.id) {
    const updatePayload = {
      external_source:
        existingAlbum.external_source ||
        payload.external_source,

      external_id:
        existingAlbum.external_id ||
        payload.external_id,

      cover_art_url:
        existingAlbum.cover_art_url ||
        payload.cover_art_url,

      release_date:
        existingAlbum.release_date ||
        payload.release_date
    };

    const { error } =
      await supabase
        .from("albums")
        .update(updatePayload)
        .eq("id", existingAlbum.id);

    if (error) {
      throw new Error(
        `Album "${payload.title}" update failed: ` +
        error.message
      );
    }

    return;
  }

  const { error } =
    await supabase
      .from("albums")
      .insert([payload]);

  if (error) {
    const duplicate =
      error.code === "23505" ||
      /duplicate key value violates unique constraint/i
        .test(error.message || "");

    if (duplicate) {
      return;
    }

    throw new Error(
      `Album "${payload.title}" insert failed: ` +
      error.message
    );
  }
}

async function markFailed(
  queueId: number,
  artistName: string,
  error: unknown
) {
  const message =
    String(
      (error as any)?.message ||
      error ||
      "Unknown importer error"
    ).slice(0, 1500);

  await supabase
    .from("artist_import_queue")
    .update({
      status: "failed",
      last_error: message,
      last_heartbeat_at:
        new Date().toISOString(),
      updated_at:
        new Date().toISOString()
    })
    .eq("id", queueId);

  await supabase
    .from("artist_catalog")
    .upsert(
      {
        artist_name: artistName,
        catalog_complete: false,
        last_error: message,
        updated_at:
          new Date().toISOString()
      },
      {
        onConflict: "artist_name"
      }
    );
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  const authorization = await requireServiceOrAdmin(request);
  if (!authorization.ok) return authorization.response;

  console.log("IMPORTER: claiming next artist");

  const {
    data: claimed,
    error: claimError
  } = await supabase.rpc(
    "claim_next_artist_import"
  );

  console.log(
    "IMPORTER: claim returned",
    JSON.stringify({
      hasData: Boolean(claimed),
      error:
        claimError?.message || null
    })
  );

  if (claimError) {
    return Response.json(
      {
        ok: false,
        error: claimError.message
      },
      { status: 500 }
    );
  }

  const queue =
    Array.isArray(claimed)
      ? claimed[0]
      : claimed;

  if (!queue?.id) {
    return Response.json({
      ok: true,
      message: "No artists waiting."
    });
  }

  const artistName =
    queue.artist_name;

  try {
    let artistId =
      queue.musicbrainz_artist_id || "";

    if (!artistId) {
      const artist =
        await resolveArtist(
          artistName
        );

      artistId =
        artist.id;
    }

    console.log(
      "IMPORTER: fetching artist details",
      artistName,
      artistId
    );

    const artistDetails =
      await fetchArtistDetails(
        artistId
      );

    console.log(
      "IMPORTER: artist details loaded",
      JSON.stringify(artistDetails)
    );

    console.log(
      "IMPORTER: fetching album release groups",
      artistName
    );

    const fetchedGroups =
      await fetchStudioReleaseGroups(
        artistId
      );

    console.log(
      "IMPORTER: raw release groups",
      fetchedGroups.length
    );

    const groups =
      fetchedGroups
        .filter(
          (group: any) =>
            isReleaseGroupWithinArtistEra(
              group,
              artistDetails
            )
        );

    const candidateTotal =
      groups.length;

    console.log(
      "IMPORTER: filtered candidate groups",
      candidateTotal
    );

    const startIndex =
      Math.max(
        0,
        Number(
          queue.next_album_index || 0
        )
      );

    const endIndex =
      Math.min(
        startIndex + ALBUMS_PER_RUN,
        candidateTotal
      );

    const batch =
      groups.slice(
        startIndex,
        endIndex
      );

    let importedThisRun = 0;
    const skipped: string[] = [];

    for (const group of batch) {
      console.log(
        "IMPORTER: processing group",
        group.title,
        group.id
      );

      const release =
        await chooseOfficialRelease(
          group.id,
          artistDetails.country,
          group["first-release-date"] || ""
        );

      if (!release?.id) {
        skipped.push(
          group.title
        );
        continue;
      }

      const payload = {
        title:
          String(
            release.title ||
            group.title ||
            ""
          ).trim(),

        artist:
          artistName,

        external_source:
          "musicbrainz",

        external_id:
          release.id,

        cover_art_url:
          `https://coverartarchive.org/release-group/` +
          `${encodeURIComponent(group.id)}/front-250`,

        release_date:
          group["first-release-date"] ||
          release.date ||
          null
      };

      console.log(
        "IMPORTER: selected release",
        payload.title,
        payload.external_id
      );

      await upsertAlbum(payload);

      importedThisRun += 1;

      console.log(
        "IMPORTER: album stored",
        payload.title
      );
    }

    const nextIndex =
      endIndex;

    const previouslyImported =
      Number(
        queue.studio_albums_imported ||
        0
      );

    const importedTotal =
      previouslyImported +
      importedThisRun;

    const complete =
      nextIndex >= candidateTotal;

    const now =
      new Date().toISOString();

    if (complete) {
      await supabase
        .from("artist_catalog")
        .upsert(
          {
            artist_name:
              artistName,
            musicbrainz_artist_id:
              artistId,
            studio_album_count:
              importedTotal,
            catalog_complete:
              true,
            last_synced_at:
              now,
            last_error:
              null,
            updated_at:
              now
          },
          {
            onConflict:
              "artist_name"
          }
        );

      await supabase
        .from("artist_import_queue")
        .update({
          musicbrainz_artist_id:
            artistId,
          status:
            "complete",
          studio_albums_imported:
            importedTotal,
          next_album_index:
            candidateTotal,
          total_studio_albums:
            candidateTotal,
          completed_at:
            now,
          last_heartbeat_at:
            now,
          updated_at:
            now,
          last_error:
            null
        })
        .eq(
          "id",
          queue.id
        );
    } else {
      /*
        Put the same artist back to pending so the next invocation
        claims it again and continues from next_album_index.
      */
      await supabase
        .from("artist_import_queue")
        .update({
          musicbrainz_artist_id:
            artistId,
          status:
            "pending",
          studio_albums_imported:
            importedTotal,
          next_album_index:
            nextIndex,
          total_studio_albums:
            candidateTotal,
          last_heartbeat_at:
            now,
          updated_at:
            now,
          last_error:
            null
        })
        .eq(
          "id",
          queue.id
        );
    }

    return Response.json({
      ok: true,
      artist:
        artistName,
      complete,

      batch_size:
        batch.length,

      albums_accepted_this_run:
        importedThisRun,

      albums_accepted_total:
        importedTotal,

      candidate_groups:
        candidateTotal,

      groups_scanned:
        nextIndex,

      groups_remaining:
        Math.max(
          0,
          candidateTotal -
          nextIndex
        ),

      albums_skipped_this_run:
        skipped.length,

      skipped,

      /*
        Kept for backwards compatibility with the current queue
        schema/UI while we transition to the clearer names above.
      */
      imported_this_run:
        importedThisRun,

      imported_total:
        importedTotal,

      total_studio_albums:
        candidateTotal,

      next_album_index:
        complete
          ? candidateTotal
          : nextIndex
    });
  } catch (error) {
    await markFailed(
      queue.id,
      artistName,
      error
    );

    return Response.json(
      {
        ok: false,
        artist:
          artistName,
        error:
          String(
            (error as any)?.message ||
            error
          )
      },
      { status: 500 }
    );
  }
});
