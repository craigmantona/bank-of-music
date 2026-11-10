window.SUPABASE_URL = "https://xevxjggauscyrvvtmftx.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_MJ-Iele0Fiei77xPx8YjtQ_oM6Lc7WW";
// Public Cloudflare Turnstile Site Key only. Leave empty until CAPTCHA is enabled.
window.TURNSTILE_SITE_KEY = "0x4AAAAAAFEfDlTfnkFhNW80";
window.LASTFM_API_KEY = "c88cf73114dbd066e2a1fd7af3f8296d";
window.SPOTIFY_CLIENT_ID = "a7cb70fbe6a0427f8a2153414a9528d3";

/* Disabled until an approved 007 launch. Never populate these from rumour. */
window.BOM_BOND_FEATURE = Object.freeze({
  enabled: false,
  nextBondActor: "",
  officialAnnouncementDate: "",
  officialAnnouncementSource: "",
  announcementHeadline: "",
  launchDayMessageEnabled: false,
  launchDayMessage: "A new 007 has been announced. Now rate the music that made Bond legendary.",
  bond26: Object.freeze({
    filmTitle: "",
    releaseYear: null,
    themeTitle: "",
    originalPerformer: "",
    catalogueTrackId: null,
    canonicalRecordingId: "",
    spotifyId: "",
    verifiedSource: ""
  })
});

/* Disabled until an explicitly approved December launch. */
window.BOM_CHRISTMAS_FEATURE = Object.freeze({
  enabled: false,
  timeZone: "Europe/London"
});

window.SPOTIFY_REDIRECT_URI =
  "https://thebankofmusic.com/";
