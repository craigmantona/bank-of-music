import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [config, app, html, client, css, migration, futureGrants, rollback] = await Promise.all([
  read("config.js"), read("app.js"), read("index.html"), read("bom-christmas-number-one.js"),
  read("bom-christmas-number-one.css"), read("supabase/migrations/20261119120000_bom_christmas_number_one.sql"),
  read("supabase/operations/future-public-launch/20261119123000_bom_christmas_number_one_public_permissions.sql"),
  read("supabase/operations/20261119_bom_christmas_number_one_rollback.sql")
]);

function clientHelpers() {
  const context = { window: { setInterval() { return 1; }, clearInterval() {} }, Date, Intl, Object, Array, String, Number, Math };
  vm.runInNewContext(client, context);
  return context.window.BOMChristmasNumberOneUI;
}

test("the new vote is default-off and has no public navigation or automatic December activation", () => {
  assert.match(config, /BOM_CHRISTMAS_NUMBER_ONE_FEATURE = Object\.freeze/);
  assert.match(config, /BOM_CHRISTMAS_NUMBER_ONE_FEATURE[\s\S]*?enabled: false/);
  assert.match(config, /votingCloses: "20 December at 23:59 UK time"/);
  assert.doesNotMatch(html, /data-bom-action="christmas-number-one"|Christmas Number 1<\/button>/);
  assert.match(html, /christmasNumberOneAdminPreview[^>]+data-admin-only="true"/);
  assert.match(app, /if \(!currentUser \|\| !isAdmin\) throw new Error\("Christmas Number 1 preview requires an administrator account\."\)/);
  assert.match(app, /BOM_CHRISTMAS_NUMBER_ONE_FEATURE\?\.enabled !== true/);
  assert.match(app, /state\?\.phase === "disabled" \|\| state\?\.votingApproved !== true/);
  assert.match(app, /script\.src = "bom-christmas-number-one\.js\?v=2"/);
  assert.match(app, /style\.href = "bom-christmas-number-one\.css\?v=2"/);
  assert.equal(/<script[^>]+bom-christmas-number-one\.js/.test(html), false);
});

test("the UK deadline, Christmas Eve reveal and countdown are exact", () => {
  const ui = clientHelpers();
  const schedule = { opensAt: "2026-12-01T00:00:00Z", closesAt: "2026-12-21T00:00:00Z", revealsAt: "2026-12-24T00:00:00Z" };
  assert.equal(ui.countdownLabel(schedule, new Date("2026-11-30T23:59:59Z")), "Voting opens in 0d 0h 0m 1s");
  assert.equal(ui.countdownLabel(schedule, new Date("2026-12-20T23:59:59Z")), "Voting closes in 0d 0h 0m 1s");
  assert.equal(ui.countdownLabel(schedule, new Date("2026-12-21T00:00:00Z")), "Reveal in 3d 0h 0m 0s");
  assert.equal(ui.countdownLabel(schedule, new Date("2026-12-24T00:00:00Z")), "Christmas Eve reveal time reached");
  assert.match(migration, /make_timestamptz\(p_year, 12, 21, 0, 0, 0, 'Europe\/London'\)/);
  assert.match(migration, /'lastVotingMinute', make_timestamptz\(p_year, 12, 20, 23, 59, 0, 'Europe\/London'\)/);
  assert.match(migration, /'revealsAt', make_timestamptz\(p_year, 12, 24, 0, 0, 0, 'Europe\/London'\)/);
});

test("admin preview voting is isolated and official RPCs remain permission-gated", () => {
  assert.match(migration, /create table public\.christmas_number_one_votes/);
  assert.match(migration, /create table public\.christmas_number_one_preview_votes/);
  assert.match(migration, /primary key \(year, user_id\)/);
  assert.match(migration, /officialVotesAffected', false/);
  assert.match(migration, /private\.require_bom_admin\(\)/);
  assert.match(app, /const previewResults = scenario !== "official"/);
  assert.match(client, /Official results \(read-only\)/);
  assert.match(client, /Live official votes · admin only/);
  for (const signature of [
    "cast_bom_christmas_number_one_vote\\(smallint, uuid\\)",
    "get_bom_christmas_number_one_state\\(smallint\\)",
    "get_bom_christmas_number_one_archive\\(\\)"
  ]) assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`));
  assert.match(futureGrants, /FUTURE PUBLIC LAUNCH ONLY/);
  assert.match(futureGrants, /grant execute on function public\.cast_bom_christmas_number_one_vote/);
  assert.doesNotMatch(migration, /grant execute on function public\.cast_bom_christmas_number_one_vote/);
});

test("the UI provides search, changeable saved selection, listening links and admin-only standings", () => {
  for (const pattern of [/Search the curated 100/, /Only the latest selection counts/, /Confirm preview vote/, /Saved preview selection/, /Listen on Spotify/, /ADMIN ONLY · HIDDEN FROM MEMBERS/, /Preview turnout/]) assert.match(client, pattern);
  assert.match(client, /saveChristmasNumberOneAdminPreviewVote/);
  assert.match(client, /Result view/);
  assert.match(client, /Simulated first-place tie/);
  assert.match(client, /installPublicEntry/);
  assert.match(client, /openPublic/);
  assert.match(client, /data-cno-public-open/);
  assert.match(client, /data-cno-public-confirm/);
  assert.match(client, /Lower-rank vote ties use title A–Z ordering/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /min-height:55px/);
  assert.match(css, /\.bom-cno-admin \.sr-only/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test("winner reveal blocks unresolved first-place ties and renders a transparent top 10", () => {
  const ui = clientHelpers();
  const tie = ui.renderReveal({ year: 2026, publicationBlocked: true, leaderTie: [
    { title: "Song A", artist: "Artist A", votes: 20 }, { title: "Song B", artist: "Artist B", votes: 20 }
  ] }, { preview: true });
  assert.match(tie, /First place is tied/);
  assert.match(tie, /documented tie resolution/);
  assert.match(tie, /Publication blocked server-side/);
  const winner = ui.renderReveal({ year: 2026, publicationBlocked: false, winner: { title: "Song A", artist: "Artist A", votes: 20, tieResolved: true }, ranking: [
    { title: "Song A", artist: "Artist A", votes: 20, isTied: true }, { title: "Song B", artist: "Artist B", votes: 20, isTied: true }
  ] });
  assert.match(winner, /CHRISTMAS NUMBER 1 2026/);
  assert.match(winner, /documented first-place tie resolution/);
  assert.match(winner, /tied; ordered title A–Z/);
  assert.match(client, /Annual winners archive/);
  assert.match(client, /Unapproved years never appear here/);
});

test("schema enforcement is separate from 0–10 ratings and records every approval", () => {
  assert.doesNotMatch(migration, /\b(insert into|update|delete from) public\.song_ratings\b/i);
  assert.doesNotMatch(migration, /\b(insert into|update|delete from) public\.ratings\b/i);
  assert.match(migration, /references public\.christmas_number_one_candidates/);
  assert.match(migration, /Choose a song from the curated Christmas 100/);
  assert.match(migration, /create table public\.christmas_number_one_admin_audit/);
  assert.match(migration, /length\(trim\(tie_resolution_note\)\) >= 20/);
  assert.match(migration, /Resolve and document the first-place tie before approving the reveal/);
  assert.match(migration, /result_snapshot = v_results/);
  assert.match(migration, /published Christmas Number 1 archive is permanent/);
  assert.match(rollback, /REVIEWED ROLLBACK PLAN — DO NOT APPLY AUTOMATICALLY/);
  assert.match(rollback, /export the five Christmas Number 1 tables/);
});
