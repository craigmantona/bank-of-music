export const CATALOGUE_QUALIFICATION_VERSION = 2;
export const CATALOGUE_SELECTION_VERSION = 1;

export const EXCLUDED_STUDIO_SECONDARY_TYPES = new Set([
  "Audiobook", "Compilation", "DJ-mix", "Interview", "Live",
  "Mixtape/Street", "Remix", "Soundtrack", "Spokenword"
]);

export type QualificationOverride = {
  release_group_id: string;
  qualification: "include" | "exclude" | "review";
  canonical_release_id?: string | null;
  original_release_date?: string | null;
  reason?: string | null;
  decision_source?: "automatic" | "policy" | "human" | null;
};

export type QualificationEvidence = {
  artistId?: string | null;
  artistEnded?: boolean;
  artistEndDate?: string | null;
  releases?: any[];
};

function overrideFor(id: string, overrides: QualificationOverride[]) {
  return overrides.find(value => value.release_group_id === id &&
    value.decision_source !== "automatic");
}

function decision(qualification: "include" | "exclude" | "review", reason: string,
  override?: QualificationOverride) {
  return { qualification, qualified: qualification === "include",
    review: qualification === "review", reason, override };
}

function artistCreditIds(group: any) {
  return [...new Set((group?.["artist-credit"] || []).map((credit: any) =>
    String(credit?.artist?.id || "")).filter(Boolean))];
}

export function qualifyStudioReleaseGroup(group: any, overrides: QualificationOverride[] = [],
  evidence: QualificationEvidence = {}) {
  const override = overrideFor(String(group?.id || ""), overrides);
  if (override) return decision(override.qualification, `override_${override.qualification}`, override);
  if (group?.["primary-type"] !== "Album") {
    return decision("exclude", "not_primary_album");
  }
  const secondary = group?.["secondary-types"] || [];
  const unwanted = secondary.find((type: string) => EXCLUDED_STUDIO_SECONDARY_TYPES.has(type));
  if (unwanted) return decision("exclude", `secondary_type:${unwanted}`);

  const credits = artistCreditIds(group);
  const artistId = String(evidence.artistId || "");
  if (!credits.length || !artistId) return decision("review", "missing_artist_credit");
  if (!credits.includes(artistId)) return decision("exclude", "incompatible_artist_credit");
  if (credits.length > 1) return decision("review", "ambiguous_artist_credit");

  const groupDate = String(group?.["first-release-date"] || "");
  const groupYear = musicBrainzDateRange(groupDate);
  const endYear = musicBrainzDateRange(evidence.artistEndDate)?.latest;
  if (evidence.artistEnded && groupYear && endYear &&
      new Date(groupYear.earliest).getUTCFullYear() > new Date(endYear).getUTCFullYear() + 2) {
    return decision("review", "outside_artist_era");
  }

  if (!evidence.releases) return decision("review", "missing_release_evidence");
  const usable = evidence.releases.filter(release => release?.id);
  const official = usable.filter(release => !release.status || release.status === "Official");
  if (usable.length && !official.length) return decision("exclude", "all_releases_non_official");
  if (!official.length) return decision("review", "no_official_release");
  const original = official.filter(release => isOriginalPeriod(release.date, groupDate));
  if (!original.length) return decision("review", "no_original_period_official_release");
  if (!original.some(release => release.country && musicBrainzDateRange(release.date))) {
    return decision("review", "incomplete_original_release_metadata");
  }
  return decision("include", "high_confidence_primary_album");
}

type DateRange = { earliest: number; latest: number; precision: number };
export function musicBrainzDateRange(value: unknown): DateRange | null {
  const match = String(value || "").match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : null;
  const day = match[3] ? Number(match[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  const lastMonth = month ?? 12;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  if (day !== null && (day < 1 || day > lastDay)) return null;
  return {
    earliest: Date.UTC(year, (month ?? 1) - 1, day ?? 1),
    latest: Date.UTC(year, lastMonth - 1, day ?? lastDay),
    precision: day ? 3 : month ? 2 : 1
  };
}

export function isOriginalPeriod(releaseDate: unknown, groupDate: unknown, maxDays = 366) {
  const release = musicBrainzDateRange(releaseDate);
  const group = musicBrainzDateRange(groupDate);
  if (!release || !group) return false;
  const allowance = maxDays * 86400000;
  return release.latest >= group.earliest - 31 * 86400000 && release.earliest <= group.latest + allowance;
}

function releaseOrder(a: any, b: any) {
  const date = String(a.date || "9999-99-99").localeCompare(String(b.date || "9999-99-99"));
  if (date) return date;
  const precision = (musicBrainzDateRange(b.date)?.precision || 0) - (musicBrainzDateRange(a.date)?.precision || 0);
  return precision || String(a.id).localeCompare(String(b.id));
}

export function selectCanonicalEdition(
  releases: any[], artistCountry: string, groupDate: string,
  override?: QualificationOverride
) {
  const official = releases.filter(release => release?.id && (!release.status || release.status === "Official"));
  if (override?.canonical_release_id) {
    const selected = official.find(release => release.id === override.canonical_release_id);
    return selected ? { release: selected, strategy: "manual_override", review: false } :
      { release: null, strategy: "manual_override_missing", review: true };
  }
  const original = official.filter(release => isOriginalPeriod(
    release.date, override?.original_release_date || groupDate
  ));
  if (!original.length) return {
    release: null, strategy: "no_original_period_official_release", review: official.length > 0
  };
  const country = String(artistCountry || "").toUpperCase();
  const tiers = [
    ["gb_original_period", (r: any) => String(r.country || "").toUpperCase() === "GB"],
    ["home_original_period", (r: any) => country && String(r.country || "").toUpperCase() === country],
    ["international_original_period", (r: any) => ["XW", "XE"].includes(String(r.country || "").toUpperCase())],
    ["territorial_original_period", (_r: any) => true]
  ] as const;
  for (const [strategy, predicate] of tiers) {
    const choices = original.filter(predicate).sort(releaseOrder);
    if (choices.length) return { release: choices[0], strategy, review: false };
  }
  return { release: null, strategy: "no_official_release", review: false };
}

export function mapLegacyProgress(groups: any[], nextIndex: number, qualifiedIds: string[]) {
  const processed = new Set(groups.slice(0, Math.max(0, nextIndex)).map(group => group.id));
  return {
    legacy_processed_group_ids: [...processed],
    next_qualified_index: qualifiedIds.findIndex(id => !processed.has(id)) === -1
      ? qualifiedIds.length : qualifiedIds.findIndex(id => !processed.has(id))
  };
}
