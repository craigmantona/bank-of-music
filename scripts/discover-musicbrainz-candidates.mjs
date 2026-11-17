#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { automaticPromotionDesign, buildDiscoveryWindows, csvForCandidates,
  discoverHistoricalCandidates } from "./lib/musicbrainz-discovery.mjs";

if (/^(1|true)$/i.test(process.env.ALBUM_DISCOVERY_KILL_SWITCH || "")) {
  console.warn("::warning title=Album discovery disabled::Kill switch is active.");
  process.exit(0);
}
if (process.argv.includes("--promote") || /^(1|true)$/i.test(process.env.AUTOMATED_QUEUE_PROMOTION_ENABLED || "")) {
  throw new Error("Automatic queue promotion is intentionally disabled pending review.");
}

const startYear = Math.max(1900, Number(process.env.MUSICBRAINZ_DISCOVERY_START_YEAR || 1950));
const maxWindows = Math.min(12, Math.max(1, Number(process.env.MUSICBRAINZ_DISCOVERY_MAX_WINDOWS || 4)));
const pageSize = Math.min(100, Math.max(1, Number(process.env.MUSICBRAINZ_DISCOVERY_PAGE_SIZE || 25)));
const outputBase = resolve(process.env.MUSICBRAINZ_DISCOVERY_OUTPUT || "outputs/musicbrainz-discovery/candidates");
const exclusionsPath = process.env.MUSICBRAINZ_DISCOVERY_EXCLUSIONS;
const exclusions = exclusionsPath ? JSON.parse(await readFile(resolve(exclusionsPath), "utf8")) : {};
const statePath = process.env.MUSICBRAINZ_DISCOVERY_STATE;
const state = statePath ? JSON.parse(await readFile(resolve(statePath), "utf8")) : {};
const identity = process.env.MUSICBRAINZ_CONTACT_EMAIL
  ? `BankOfMusic/1.0 (${process.env.MUSICBRAINZ_CONTACT_EMAIL})`
  : "BankOfMusic/1.0 (https://bank-of-music.pages.dev/)";
let nextRequestAt = 0;
async function get(path) {
  const wait = Math.max(0, nextRequestAt - Date.now());
  if (wait) await new Promise(resolveWait => setTimeout(resolveWait, wait));
  nextRequestAt = Date.now() + 1100;
  const response = await fetch(`https://musicbrainz.org/ws/2${path}`, {
    headers: { Accept: "application/json", "User-Agent": identity }, signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`MusicBrainz discovery failed with ${response.status}`);
  return response.json();
}

const windows = buildDiscoveryWindows({ startYear });
const result = await discoverHistoricalCandidates({ get, windows, state, maxWindows, pageSize, exclusions });
const report = { generated_at: new Date().toISOString(), strategy: "balanced_historical_round_robin",
  start_year: startYear, max_windows: maxWindows, page_size: pageSize,
  mode: "review_only", ...result, automatic_promotion: automaticPromotionDesign(result.accepted) };
await mkdir(dirname(outputBase), { recursive: true });
await writeFile(`${outputBase}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${outputBase}.csv`, csvForCandidates(result.accepted));
await writeFile(`${outputBase}.state.json`, JSON.stringify(result.resume_state, null, 2) + "\n");
console.log(JSON.stringify({ event: "musicbrainz_discovery_complete", accepted: result.accepted.length,
  rejected: result.rejected.length, json: `${outputBase}.json`, csv: `${outputBase}.csv`,
  state: `${outputBase}.state.json` }));
