export const ARTIST_ENRICHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ArtistEnrichment = {
  artist_id: string;
  artist_detail: Record<string, unknown>;
  release_groups: unknown[];
  fetched_at: string;
};

type Dependencies = {
  read: (artistId: string) => Promise<ArtistEnrichment | null>;
  refresh: (artistId: string) => Promise<ArtistEnrichment>;
  schedule: (task: Promise<unknown>) => void;
  now?: () => number;
};

function valid(entry: ArtistEnrichment | null) {
  return Boolean(entry && entry.artist_detail && Array.isArray(entry.release_groups) &&
    Number.isFinite(Date.parse(entry.fetched_at)));
}

export async function resolveArtistEnrichment(artistId: string, dependencies: Dependencies) {
  const cached = await dependencies.read(artistId);
  if (valid(cached)) {
    const age = (dependencies.now?.() ?? Date.now()) - Date.parse(cached!.fetched_at);
    if (age <= ARTIST_ENRICHMENT_TTL_MS) {
      return { ok: true, cache_status: "fresh", enrichment: cached };
    }
    dependencies.schedule(dependencies.refresh(artistId).catch(() => null));
    return { ok: true, cache_status: "stale", enrichment: cached };
  }

  try {
    const enrichment = await dependencies.refresh(artistId);
    return { ok: true, cache_status: "miss", enrichment };
  } catch {
    return { ok: false, cache_status: "miss", enrichment: null };
  }
}
