const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const COLLECTION_KEY = "uk-number-ones";
export const SOURCE_PAGE = "List_of_UK_singles_chart_number_ones_of_the_1990s";
export const SOURCE_URL = `https://en.wikipedia.org/wiki/${SOURCE_PAGE}`;

export const APPROVED_EXACT_MBIDS = Object.freeze([
  { artist: "Bombalurina", title: "Itsy Bitsy Teenie Weenie Yellow Polka Dot Bikini", mbid: "6ed2bc7c-05b6-4d5e-8622-5d6b18438e4b" },
  { artist: "Ace of Base", title: "All That She Wants", mbid: "d36508eb-ec76-41b8-aa10-a5286e883f2c" },
  { artist: "Teletubbies", title: "Teletubbies Say ‘Eh-oh!’", mbid: "19f944e6-de67-48ce-8c87-f3cc3f61d2a7" }
]);

export function sourcePagesForRange(startYear, endYear) {
  const pages = [];
  for (let decade = Math.floor(startYear / 10) * 10; decade <= endYear; decade += 10) {
    pages.push(`List_of_UK_singles_chart_number_ones_of_the_${decade}s`);
  }
  return pages;
}

export function normalise(value) {
  return String(value ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&(?:amp|nbsp);/g, " and ")
    .replace(/\b(?:featuring|feat\.?|ft\.?)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}

function stripMarkup(value) {
  return String(value || "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^/>]*\/>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{sortname\|([^|{}]+)\|([^|{}]+)(?:\|[^{}]+)?\}\}/gi, "$1 $2")
    .replace(/\{\{sort\|[^|{}]+\|([\s\S]*?)\}\}/gi, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/[†‡]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim()
    .replace(/^['"]+|['"]+$/g, "");
}

function linkedArticles(value) {
  const withoutReferences = String(value || "").split(/<ref\b|\{\{#tag:ref\|/i)[0];
  return [...withoutReferences.matchAll(/\[\[([^\]#|]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)]
    .map(match => match[1].trim())
    .filter(title => title && !/^(?:File|Category|List of|PWL|CBS|EMI|Epic|Virgin|Polydor|Capitol|Arista|Parlophone|Sire|Atlantic|Columbia|RCA|Warner|Island|Mercury|Sony|MCA|Universal|Motown|A&M|Chrysalis|Decca|Geffen|Jive|London|Factory|Creation|Positiva|Telstar|XL Recordings|Mute Records|Record label)/i.test(title));
}

function sourceKey(year, number, artist, title) {
  return `${year}:${number || "unknown"}:${normalise(artist)}:${normalise(title)}`;
}

export function parseNumberOneWikitext(wikitext, { startYear = 1990, endYear = 1999, revision = "", sourceUrl = SOURCE_URL } = {}) {
  const section = String(wikitext)
    .split(/^==\s*Number-one singles\s*==\s*$/mi)[1]
    ?.split(/^==[^=].*==\s*$/m)[0] || "";
  let year = null;
  const rows = [];
  for (const block of section.split(/^\|-/m)) {
    const yearMatch = block.match(/\{\{anchor\|(19\d{2}|20\d{2})\}\}/);
    if (yearMatch) { year = Number(yearMatch[1]); continue; }
    if (!year || year < startYear || year > endYear) continue;
    const number = block.match(/!scope=row[^\n]*\|\s*(\d+)\s*\n/)?.[1];
    const date = block.match(/\{\{dts\|format=dmy\|(\d{4})\|(\d{1,2})\|(\d{1,2})\}\}/i);
    const weeks = block.match(/\|\|align="center"\|\s*(\d+)/i)?.[1];
    if (!number || !date || !weeks) continue;
    const lines = block.split("\n").filter(line => line.startsWith("|") && !line.startsWith("|-"));
    const artistTitle = lines.find(line => line.includes("||") && !line.includes("{{dts"));
    if (!artistTitle) continue;
    const [artistCell, ...titleParts] = artistTitle.replace(/^\|\s*/, "").split("||");
    const titleCell = titleParts.join("||");
    const artist = stripMarkup(artistCell);
    const title = stripMarkup(titleCell);
    const articles = [...new Set(linkedArticles(titleCell))];
    if (!articles.length) {
      const sortTarget = titleCell.match(/\{\{sortname\|[^|{}]+\|[^|{}]+\|([^|{}]+)(?:\|[^{}]+)?\}\}/i)?.[1];
      articles.push(stripMarkup(sortTarget || title));
    }
    const firstDate = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
    rows.push({
      collection_key: COLLECTION_KEY,
      chart_year: year,
      source_entry_key: sourceKey(year, number, artist, title),
      source_name: "wikimedia",
      source_url: sourceUrl,
      source_revision: String(revision || ""),
      source_number: Number(number), artist, title,
      article_titles: articles,
      first_number_one_date: firstDate,
      weeks_at_number_one: Number(weeks), number_one_runs: 1
    });
  }
  return collapseNumberOneRuns(rows);
}

export function collapseNumberOneRuns(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.chart_year}:${normalise(row.artist)}:${normalise(row.title)}`;
    const current = grouped.get(key);
    if (!current) { grouped.set(key, { ...row }); continue; }
    current.first_number_one_date = [current.first_number_one_date, row.first_number_one_date].sort()[0];
    current.weeks_at_number_one += Number(row.weeks_at_number_one || 0);
    current.number_one_runs += 1;
    current.article_titles = [...new Set([...current.article_titles, ...row.article_titles])];
  }
  return [...grouped.values()].sort((a, b) => a.first_number_one_date.localeCompare(b.first_number_one_date));
}

export function wikidataSparql(articleTitles) {
  const values = [...new Set(articleTitles)].map(title =>
    `<${new URL(`/wiki/${title.replaceAll(" ", "_")}`, "https://en.wikipedia.org").href}>`
  ).join(" ");
  return `SELECT ?article ?item ?itemLabel ?mbid ?isrc ?spotify WHERE {\n  VALUES ?article { ${values} }\n  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.\n  OPTIONAL { ?item wdt:P4404 ?mbid. }\n  OPTIONAL { ?item wdt:P1243 ?isrc. }\n  OPTIONAL { ?item wdt:P2207 ?spotify. }\n  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }\n}`;
}

export function applyWikidata(rows, bindings) {
  const byTitle = new Map();
  for (const binding of bindings || []) {
    const article = decodeURIComponent(String(binding.article?.value || "").split("/wiki/").pop() || "").replaceAll("_", " ");
    const values = byTitle.get(article) || [];
    values.push({ qid: String(binding.item?.value || "").split("/").pop(), mbid: binding.mbid?.value || "", isrc: binding.isrc?.value || "", spotify: binding.spotify?.value || "" });
    byTitle.set(article, values);
  }
  return rows.map(row => {
    const values = row.article_titles.flatMap(title => byTitle.get(title) || []);
    const qids = [...new Set(values.map(value => value.qid).filter(Boolean))];
    const mbids = [...new Set(values.map(value => value.mbid.toLowerCase()).filter(value => MBID.test(value)))];
    const isrcs = [...new Set(values.map(value => value.isrc).filter(Boolean))];
    const spotifyIds = [...new Set(values.map(value => value.spotify).filter(Boolean))];
    return { ...row, wikidata_qid: qids.length === 1 ? qids[0] : null, musicbrainz_recording_ids: mbids, isrcs, spotify_track_ids: spotifyIds };
  });
}

export function matchCollectionEntries(entries, songs) {
  const available = (songs || []).filter(song => song?.id && !song.is_deleted);
  return entries.map(entry => {
    const mbids = entry.musicbrainz_recording_ids || [];
    const direct = available.filter(song => song.external_source === "musicbrainz" && mbids.includes(String(song.external_id || "").toLowerCase()));
    const directIdentities = new Set(direct.map(song => String(song.external_id).toLowerCase()));
    let status = "unresolved", method = null, matchNotes = null, song = null;
    if (mbids.length > 1) { status = "ambiguous"; matchNotes = "Wikidata supplies multiple MusicBrainz recording IDs."; }
    else if (directIdentities.size === 1) { status = "direct_mbid"; method = "wikidata_p4404"; song = [...direct].sort((a, b) => Number(a.id) - Number(b.id))[0]; }
    else if (directIdentities.size > 1) { status = "ambiguous"; matchNotes = "P4404 resolves to multiple canonical recording identities."; }
    else if (entry.article_titles.length > 1) { status = "ambiguous"; matchNotes = "Source row represents multiple linked recordings or sides."; }
    else {
      const spotifyIds = entry.spotify_track_ids || [];
      const identifierMatches = spotifyIds.length === 1
        ? available.filter(candidate => String(candidate.spotify_track_id || "") === spotifyIds[0])
        : [];
      if (new Set(identifierMatches.map(candidate => candidate.id)).size === 1) {
        status = "identifier";
        method = "wikidata_spotify_track_id";
        song = identifierMatches[0];
      } else if (identifierMatches.length > 1) {
        status = "ambiguous";
        matchNotes = "Spotify track ID matches multiple catalogue occurrences.";
      }
      const fallback = available.filter(candidate => normalise(candidate.title) === normalise(entry.title) && normalise(candidate.artist) === normalise(entry.artist));
      const identities = new Set(fallback.map(candidate => candidate.external_source === "musicbrainz" && MBID.test(candidate.external_id || "") ? `mbid:${String(candidate.external_id).toLowerCase()}` : `song:${candidate.id}`));
      if (!song && status !== "ambiguous" && identities.size === 1) { status = "title_artist"; method = "unique_normalised_title_artist"; song = fallback.sort((a, b) => Number(a.id) - Number(b.id))[0]; }
      else if (!song && identities.size > 1) { status = "ambiguous"; matchNotes = "Artist/title matches multiple canonical recordings."; }
      else if (!song && status !== "ambiguous" && mbids.length === 1) matchNotes = "P4404 is not present in the BOM catalogue.";
    }
    return {
      collection_key: entry.collection_key, chart_year: entry.chart_year, source_entry_key: entry.source_entry_key,
      source_name: entry.source_name, source_url: entry.source_url, source_revision: entry.source_revision,
      wikidata_qid: entry.wikidata_qid, title: entry.title, artist: entry.artist,
      first_number_one_date: entry.first_number_one_date, weeks_at_number_one: entry.weeks_at_number_one,
      number_one_runs: entry.number_one_runs, musicbrainz_recording_id: mbids.length === 1 ? mbids[0] : null,
      isrc: entry.isrcs?.length === 1 ? entry.isrcs[0] : null,
      spotify_track_id: entry.spotify_track_ids?.length === 1 ? entry.spotify_track_ids[0] : null,
      song_id: song?.id || null, canonical_song_id: song?.canonical_song_id || null,
      match_status: status, match_method: method, match_notes: matchNotes,
      source_metadata: { source_number: entry.source_number, article_titles: entry.article_titles, musicbrainz_recording_ids: mbids, isrcs: entry.isrcs || [], spotify_track_ids: entry.spotify_track_ids || [] }
    };
  });
}

export function canonicalRecordingSeed(row) {
  if (!row || row.match_status === "ambiguous") return null;
  const articleTitles = row.source_metadata?.article_titles || [];
  if (articleTitles.length > 1) return null;
  return {
    title: row.title,
    artist: row.artist,
    musicbrainz_recording_id: row.musicbrainz_recording_id || null,
    wikidata_qid: row.wikidata_qid || null,
    preferred_spotify_track_id: row.spotify_track_id || null,
    origin_key: `quick-rate:${row.collection_key}:${row.source_entry_key}`,
    source_metadata: {
      source_name: row.source_name,
      source_url: row.source_url,
      source_revision: row.source_revision,
      collection_key: row.collection_key,
      chart_year: row.chart_year,
      first_number_one_date: row.first_number_one_date,
      weeks_at_number_one: row.weeks_at_number_one,
      number_one_runs: row.number_one_runs,
      match_status: row.match_status,
      match_method: row.match_method,
      isrc: row.isrc || null
    }
  };
}

function approvedExactMbid(row) {
  return APPROVED_EXACT_MBIDS.find(candidate =>
    normalise(candidate.artist) === normalise(row.artist) &&
    normalise(candidate.title) === normalise(row.title)
  )?.mbid || null;
}

export function classifyCanonicalEligibility(rows, canonicalRecordings = []) {
  const canonicalByMbid = new Map((canonicalRecordings || [])
    .filter(row => MBID.test(row.musicbrainz_recording_id || ""))
    .map(row => [String(row.musicbrainz_recording_id).toLowerCase(), row]));
  return (rows || []).map(row => {
    const articleTitles = row.source_metadata?.article_titles || [];
    const combined = articleTitles.length > 1 || /["”]\s*\/\s*["“]/.test(row.title || "");
    const ep = /\(\s*EP\s*\)/i.test(row.title || "");
    const multiRecording = /\b(?:medley|mega\s*mix|megamix)\b/i.test(row.title || "");
    const exactMbid = approvedExactMbid(row) || row.musicbrainz_recording_id || null;
    const exactCanonical = exactMbid ? canonicalByMbid.get(exactMbid.toLowerCase()) : null;

    if (combined || ep || multiRecording) {
      return { ...row, classification: "C",
        classification_reason: combined ? "combined_or_double_a_side" : ep ? "ep_multi_recording" : "medley_or_megamix",
        approved_musicbrainz_recording_id: exactMbid };
    }
    if (row.match_status === "ambiguous") {
      return { ...row, classification: "C", classification_reason: "ambiguous_existing_canonical_candidates",
        approved_musicbrainz_recording_id: exactMbid };
    }
    if (exactCanonical) {
      return { ...row, canonical_song_id: exactCanonical.id, classification: "A",
        classification_reason: "exact_known_mbid", approved_musicbrainz_recording_id: exactMbid };
    }
    if (row.canonical_song_id && ["direct_mbid", "identifier"].includes(row.match_status)) {
      return { ...row, classification: "A",
        classification_reason: `existing_${row.match_method || row.match_status}`,
        approved_musicbrainz_recording_id: exactMbid };
    }
    if (row.match_status === "title_artist") {
      return { ...row, classification: "C", classification_reason: "title_artist_only_requires_review",
        approved_musicbrainz_recording_id: exactMbid };
    }
    return { ...row, classification: "B",
      classification_reason: exactMbid ? "safe_new_canonical_with_exact_mbid" : "safe_new_bom_native_canonical",
      approved_musicbrainz_recording_id: exactMbid };
  });
}

export function summariseCanonicalClassification(rows) {
  const category = value => rows.filter(row => row.classification === value);
  const combined = rows.filter(row => row.classification_reason === "combined_or_double_a_side");
  const eps = rows.filter(row => row.classification_reason === "ep_multi_recording");
  const otherAmbiguous = category("C").filter(row => !combined.includes(row) && !eps.includes(row));
  const rateable = category("A").length + category("B").length;
  return {
    total_source_entries: rows.length,
    category_a_existing_canonical: category("A").length,
    category_b_new_bom_canonical: category("B").length,
    category_c_review: category("C").length,
    known_exact_mbid_entries: rows.filter(row => MBID.test(row.approved_musicbrainz_recording_id || "")).length,
    entries_with_wikidata_qid: rows.filter(row => row.wikidata_qid).length,
    entries_with_isrc: rows.filter(row => (row.source_metadata?.isrcs || []).length > 0).length,
    entries_with_source_spotify_id: rows.filter(row => (row.source_metadata?.spotify_track_ids || []).length > 0).length,
    combined_or_double_a_side: combined.length,
    ep_or_multi_recording: eps.length,
    other_ambiguous: otherAmbiguous.length,
    carry_over_from_previous_year: rows.filter(row =>
      Number(String(row.first_number_one_date).slice(0, 4)) < Number(row.chart_year)
    ).length,
    immediately_rateable: rateable,
    immediately_rateable_percentage: rows.length ? Number((rateable * 100 / rows.length).toFixed(1)) : 0,
    non_rateable: category("C").length,
    rateable_without_exact_mbid: rows.filter(row => ["A", "B"].includes(row.classification) && !row.approved_musicbrainz_recording_id).length
  };
}

export function summariseMatches(rows) {
  const count = status => rows.filter(row => row.match_status === status).length;
  return {
    unique_entries: rows.length,
    direct_mbid: count("direct_mbid"), identifier: count("identifier"), title_artist: count("title_artist"),
    mbid_not_in_catalogue: rows.filter(row => row.musicbrainz_recording_id && row.match_status === "unresolved").length,
    unresolved: count("unresolved"), ambiguous: count("ambiguous")
  };
}

const VERSION_WARNING = /\b(?:live|remix|mix|edit|radio|remaster|re-record|rerecord|acoustic|instrumental|karaoke|demo|medley|session|version)\b/i;

function recordingArtist(recording) {
  return (recording?.["artist-credit"] || []).map(credit =>
    `${credit?.name || credit?.artist?.name || ""}${credit?.joinphrase || ""}`
  ).join("").trim();
}

function recordingReleaseYears(recording) {
  const values = [recording?.["first-release-date"], ...(recording?.releases || []).map(release => release.date)];
  return [...new Set(values.map(value => Number(String(value || "").slice(0, 4))).filter(year => Number.isInteger(year) && year >= 1000))];
}

export function musicBrainzSearchPath(entry) {
  const quote = value => String(value || "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  const query = `recording:"${quote(entry.title)}" AND artist:"${quote(entry.artist)}"`;
  return `/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=15`;
}

export function evaluateMusicBrainzCandidates(entry, response) {
  const wantedTitle = normalise(entry.title);
  const wantedArtist = normalise(entry.artist);
  const wantedIsrcs = new Set((entry.source_metadata?.isrcs || (entry.isrc ? [entry.isrc] : [])).map(value => String(value).replace(/[^A-Z0-9]/gi, "").toUpperCase()));
  const candidates = (response?.recordings || []).map(recording => {
    const artist = recordingArtist(recording);
    const titleExact = normalise(recording.title) === wantedTitle;
    const artistExact = normalise(artist) === wantedArtist;
    const warning = VERSION_WARNING.test(`${recording.title || ""} ${recording.disambiguation || ""}`);
    const isrcs = (recording.isrcs || []).map(value => String(value).replace(/[^A-Z0-9]/gi, "").toUpperCase());
    const isrcExact = isrcs.some(isrc => wantedIsrcs.has(isrc));
    const years = recordingReleaseYears(recording);
    const nearChartYear = years.some(year => Math.abs(year - Number(entry.chart_year)) <= 1);
    return { id: recording.id, title: recording.title, artist, score: Number(recording.score || 0), disambiguation: recording.disambiguation || "", isrcs, years, titleExact, artistExact, isrcExact, nearChartYear, warning };
  }).filter(candidate => MBID.test(candidate.id || "") && candidate.titleExact && candidate.artistExact && !candidate.warning);

  const byId = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()]
    .sort((left, right) => right.score - left.score || Number(right.isrcExact) - Number(left.isrcExact));
  const exactIsrc = byId.filter(candidate => candidate.isrcExact);
  if (exactIsrc.length === 1) return { confidence: "high", reason: "exact_isrc_artist_title", candidate: exactIsrc[0], candidates: byId };
  if (exactIsrc.length > 1) return { confidence: "ambiguous", reason: "isrc_matches_multiple_recordings", candidate: null, candidates: exactIsrc };
  if (!byId.length) return { confidence: "none", reason: "no_exact_safe_candidate", candidate: null, candidates: [] };

  const top = byId[0], second = byId[1];
  if (/^(?:various artists?|unknown)$/i.test(String(entry.artist || "").trim())) {
    return { confidence: "probable", reason: "ensemble_credit_requires_review", candidate: top, candidates: byId };
  }
  if (top.score === 100 && top.nearChartYear && (!second || second.score <= 90)) {
    return { confidence: "high", reason: "exact_artist_title_strong_release_date", candidate: top, candidates: byId };
  }
  if (byId.length === 1 || !second || top.score - second.score >= 8) {
    return { confidence: "probable", reason: top.nearChartYear ? "strong_artist_title_candidate" : "exact_artist_title_without_strong_date", candidate: top, candidates: byId };
  }
  return { confidence: "ambiguous", reason: "ambiguous_musicbrainz_candidates", candidate: null, candidates: byId };
}

export function applyMusicBrainzEnrichment(rows, responsesByKey, songs) {
  const catalogueMbids = new Set((songs || []).filter(song => song.external_source === "musicbrainz").map(song => String(song.external_id || "").toLowerCase()));
  return rows.map(row => {
    if (row.match_status !== "unresolved") return row;
    const key = `${normalise(row.artist)}|||${normalise(row.title)}`;
    const evaluation = evaluateMusicBrainzCandidates(row, responsesByKey[key]);
    const mbid = evaluation.confidence === "high" ? evaluation.candidate?.id?.toLowerCase() || null : null;
    return {
      ...row,
      musicbrainz_enrichment: {
        confidence: evaluation.confidence,
        reason: evaluation.reason,
        candidate_mbid: evaluation.candidate?.id || null,
        candidate_title: evaluation.candidate?.title || null,
        candidate_artist: evaluation.candidate?.artist || null,
        candidate_score: evaluation.candidate?.score ?? null,
        candidate_release_years: evaluation.candidate?.years || [],
        candidate_count: evaluation.candidates.length,
        already_in_bom: mbid ? catalogueMbids.has(mbid) : false
      }
    };
  });
}

export function summariseMusicBrainzEnrichment(rows) {
  const attempted = rows.filter(row => row.match_status === "unresolved" && row.musicbrainz_enrichment);
  const high = attempted.filter(row => row.musicbrainz_enrichment.confidence === "high");
  return {
    attempted: attempted.length,
    high_confidence: high.length,
    probable: attempted.filter(row => row.musicbrainz_enrichment.confidence === "probable").length,
    still_unresolved: attempted.filter(row => row.musicbrainz_enrichment.confidence === "none").length,
    ambiguous: attempted.filter(row => row.musicbrainz_enrichment.confidence === "ambiguous").length,
    high_confidence_in_bom: high.filter(row => row.musicbrainz_enrichment.already_in_bom).length,
    high_confidence_absent_from_bom: high.filter(row => !row.musicbrainz_enrichment.already_in_bom).length
  };
}
