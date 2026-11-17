#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { automaticPromotionDesign, csvForCandidates, discoverCandidates } from "./lib/musicbrainz-discovery.mjs";

if (/^(1|true)$/i.test(process.env.ALBUM_DISCOVERY_KILL_SWITCH || "")) {
  console.warn("::warning title=Album discovery disabled::Kill switch is active.");
  process.exit(0);
}
if (process.argv.includes("--promote") || /^(1|true)$/i.test(process.env.AUTOMATED_QUEUE_PROMOTION_ENABLED || "")) {
  throw new Error("Automatic queue promotion is intentionally disabled pending review.");
}

const today = new Date();
const from = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
const to = today.toISOString().slice(0, 10);
const query = process.env.MUSICBRAINZ_DISCOVERY_QUERY ||
  `primarytype:album AND firstreleasedate:[${from} TO ${to}]`;
const maxPages = Math.min(5, Math.max(1, Number(process.env.MUSICBRAINZ_DISCOVERY_MAX_PAGES || 2)));
const outputBase = resolve(process.env.MUSICBRAINZ_DISCOVERY_OUTPUT || "outputs/musicbrainz-discovery/candidates");
const exclusionsPath = process.env.MUSICBRAINZ_DISCOVERY_EXCLUSIONS;
const exclusions = exclusionsPath ? JSON.parse(await readFile(resolve(exclusionsPath), "utf8")) : {};
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

const result = await discoverCandidates({ get, query, maxPages, exclusions });
const report = { generated_at: new Date().toISOString(), query, max_pages: maxPages,
  mode: "review_only", ...result, automatic_promotion: automaticPromotionDesign(result.accepted) };
await mkdir(dirname(outputBase), { recursive: true });
await writeFile(`${outputBase}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${outputBase}.csv`, csvForCandidates(result.accepted));
console.log(JSON.stringify({ event: "musicbrainz_discovery_complete", accepted: result.accepted.length,
  rejected: result.rejected.length, json: `${outputBase}.json`, csv: `${outputBase}.csv` }));
