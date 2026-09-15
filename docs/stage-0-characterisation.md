# BOM Stage 0 characterisation

Captured before the Stage 1 shell became the default. The new shell remains opt-in.

## Behaviour contracts retained

| Area | Current production behaviour | Stage 1 contract |
| --- | --- | --- |
| Authentication | Supabase email/password sign-up and sign-in; profile is ensured after session restoration | Existing form, auth calls and session listener remain unchanged |
| Logout | Calls `supabaseClient.auth.signOut()`, reloads public library state and rerenders existing sections | New ProfileMenu delegates to the existing `logOut()` function |
| Password reset | Calls `resetPasswordForEmail()` with the current application URL | Existing form and handler remain unchanged |
| Profile/account | Session button opens the account dropdown; profile modal reloads profile/library data | New ProfileMenu delegates to the existing profile function; legacy menu remains available in legacy mode |
| Admin gating | `profiles.is_admin` controls all `[data-admin-only]` elements and the admin section | New menu reads the same derived `isAdmin` state; no authorization decision is made in the presentation layer |
| Spotify callback | Inline callback capture runs before `app.js`; app validates state, exchanges the code and opens `settingsSection` | Callback capture and Spotify functions are unchanged |
| Spotify sync | Existing connect, disconnect, matching, playlist and progress handlers live in `app.js` | New menu delegates to `showSpotify()`, which opens the existing section and refreshes the existing connection UI |
| Album ratings | Upsert on `(user_id, album_id)`, then update the in-memory cache and existing renderers | No mutation or renderer changed |
| Track ratings | Upsert on `(user_id, song_id)`, including existing duplicate-record propagation | No mutation or renderer changed |
| Reviews | Read album reviews and profiles; upsert one review per user/album | No query, mutation or renderer changed |
| Deep links | Existing album/song/profile/share query parameters are processed after session initialization | `ui=stage1` is additive; existing query parameters are retained |

## Baseline request and rendering characteristics

On a logged-out startup, the existing `refreshSessionUI()` path performs:

1. One auth session request.
2. One albums request.
3. One or more paged songs requests in blocks of 1,000.
4. One request for every public album-rating row.
5. One request for every public track-rating row.
6. One followed-artists request.
7. Spotify connection initialization, normally satisfied from local token state when disconnected.

The legacy document requests its HTML, legacy stylesheet, Supabase client, configuration, application script and logo. The Stage 1 flag adds one stylesheet, one script and three preloaded local font files. With no `ui=stage1` flag, those five Stage 1 asset requests are not made.

The local cold-load observation matched that structure: six application/static requests for legacy mode before the browser's optional favicon request, and eleven in Stage 1 mode. Cached reloads returned `304` for unchanged assets. Cross-origin Supabase request totals vary with the number of 1,000-row song pages and authentication state; the deterministic minimum application data path is the session check plus five catalogue/rating/follow queries.

Obvious baseline costs:

- Full catalogue and public rating tables are loaded before most existing views are derived in memory.
- The songs loader adds one request for every 1,000 rows.
- Search makes three concurrent MusicBrainz requests only after submission.
- Charts make two Supabase view requests only when opened.
- Saved album details can render from local data; unsaved albums may add MusicBrainz and cover-art requests.
- Reviews load separately when an album is opened.
- Existing artwork URLs do not consistently provide responsive variants.

Stage 1 deliberately does not change these behaviours. Its runtime work is a small header render, one `MutationObserver` on the session label and event delegation to existing functions.

## Normalized view-model shapes for later stages

```js
ArtistViewModel = {
  id: String | null,
  name: String,
  imageUrl: String | null,
  country: String | null,
  area: String | null,
  activeFrom: String | null,
  activeTo: String | null,
  followed: Boolean,
  albums: AlbumSummary[],
  highestRatedTracks: TrackSummary[]
}

AlbumViewModel = {
  id: Number | null,
  externalId: String | null,
  releaseGroupId: String | null,
  title: String,
  artist: ArtistSummary,
  artworkUrl: String | null,
  releaseDate: String | null,
  originalReleaseDate: String | null,
  trackCount: Number | null,
  durationMs: Number | null,
  communityRating: RatingSummary,
  personalRating: Number | null,
  tracks: TrackViewModel[],
  reviews: ReviewViewModel[]
}

TrackViewModel = {
  id: Number | null,
  externalId: String | null,
  canonicalId: String | null,
  position: Number | null,
  title: String,
  artist: ArtistSummary,
  album: AlbumSummary | null,
  durationMs: Number | null,
  communityRating: RatingSummary,
  personalRating: Number | null
}

RatingSummary = {
  average: Number | null,
  count: Number
}
```

Missing or unavailable values remain `null`; presentation code must not create catalogue rows to fill them.

## Coexistence and rollback

- Legacy presentation: `/` or any existing deep link without `ui=stage1`.
- Stage 1 shell: append `ui=stage1`, preserving all other parameters.
- Rollback: remove the flag. The legacy header and navigation reappear without reloading different application logic.
- Full code rollback: remove the Stage 1 loader and bridge, then delete `bom-foundation.css` and `bom-foundation.js`.

No schema, Supabase policy, catalogue function, qualification rule, queue or migration is changed by Stage 0 or Stage 1.
