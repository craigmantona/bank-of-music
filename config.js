window.SUPABASE_URL = "https://xevxjggauscyrvvtmftx.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_MJ-Iele0Fiei77xPx8YjtQ_oM6Lc7WW";
// Public Cloudflare Turnstile Site Key only. Leave empty until CAPTCHA is enabled.
window.TURNSTILE_SITE_KEY = "0x4AAAAAAFEfDlTfnkFhNW80";
window.LASTFM_API_KEY = "c88cf73114dbd066e2a1fd7af3f8296d";
window.SPOTIFY_CLIENT_ID = "a7cb70fbe6a0427f8a2153414a9528d3";

/* Private preview: enable only after the rating pool has been approved. */
window.BOM_HIGHER_LOWER_FEATURE = Object.freeze({
  enabled: false,
  minimumRaters: 3,
  minimumRatingGap: 0.2,
  poolSize: 60
});

window.BOM_QUICKFIRE_FEATURE = Object.freeze({
  enabled: false,
  minimumRaters: 3,
  minimumRatingGap: 0.2,
  poolSize: 60,
  durationSeconds: 60
});

window.BOM_DAILY_CHALLENGE_FEATURE = Object.freeze({
  enabled: false,
  minimumRaters: 3,
  minimumRatingGap: 0.2,
  comparisonCount: 10,
  timeZone: "Europe/London"
});

/* Official 007 launch configuration. Never populate future-film fields from rumour. */
window.BOM_BOND_FEATURE = Object.freeze({
  enabled: true,
  nextBondActor: "Robert Pattinson",
  officialAnnouncementDate: "2026-11-16",
  officialAnnouncementSource: "https://www.007.com/robert-pattinson-is-the-new-james-bond/",
  announcementHeadline: "Robert Pattinson is the new 007",
  launchDayMessageEnabled: true,
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

/* Annual December eligibility with an explicit emergency off switch. */
window.BOM_CHRISTMAS_FEATURE = Object.freeze({
  emergencyDisabled: false,
  timeZone: "Europe/London",
  isEligible(now = new Date()) {
    if (window.BOM_CHRISTMAS_FEATURE?.emergencyDisabled === true) return false;
    return new Intl.DateTimeFormat("en-GB", { month: "2-digit", timeZone: "Europe/London" }).format(now) === "12";
  }
});

/*
 * Christmas Number 1 is a separate, approval-gated annual vote. Keep this
 * false until the database migration, launch grants and a specific year's
 * administrator approvals have all been reviewed and explicitly approved.
 */
window.BOM_CHRISTMAS_NUMBER_ONE_FEATURE = Object.freeze({
  enabled: false,
  timeZone: "Europe/London",
  votingOpens: "1 December at 00:00 UK time",
  votingCloses: "20 December at 23:59 UK time",
  revealDate: "24 December"
});

window.SPOTIFY_REDIRECT_URI =
  "https://thebankofmusic.com/";
