import assert from "node:assert/strict";
import test from "node:test";
import { MIB, remainingTarget, runDailyImport, storageDecision } from "../scripts/lib/automated-album-import.mjs";

test("storage thresholds warn at 350 MB and pause at 400 MB", () => {
  assert.deepEqual(storageDecision(349 * MIB), { megabytes: 349, warning: false, paused: false, reason: null });
  assert.equal(storageDecision(350 * MIB).warning, true);
  assert.equal(storageDecision(399 * MIB).paused, false);
  assert.deepEqual(storageDecision(400 * MIB), { megabytes: 400, warning: true, paused: true, reason: "storage_limit" });
});

test("remaining target never becomes negative", () => {
  assert.equal(remainingTarget(12, 50), 38);
  assert.equal(remainingTarget(51, 50), 0);
});

test("controller stops at the daily target", async () => {
  let imported = 47;
  let calls = 0;
  const result = await runDailyImport({
    target: 50,
    status: async () => ({ albums_imported_today: imported, database_size_bytes: 100 * MIB }),
    invoke: async () => { calls += 1; imported += 1; return { ok: true }; },
    log: { info() {}, warn() {} }
  });
  assert.equal(result.status, "complete");
  assert.equal(calls, 3);
});

test("controller pauses before invoking when storage is at the hard limit", async () => {
  let calls = 0;
  const result = await runDailyImport({
    status: async () => ({ albums_imported_today: 0, database_size_bytes: 400 * MIB }),
    invoke: async () => { calls += 1; return { ok: true }; },
    log: { info() {}, warn() {} }
  });
  assert.equal(result.status, "paused");
  assert.equal(calls, 0);
});

test("dry run checks safety without importing", async () => {
  let calls = 0;
  const result = await runDailyImport({ dryRun: true,
    status: async () => ({ albums_imported_today: 4, database_size_bytes: 200 * MIB }),
    invoke: async () => { calls += 1; }, log: { info() {}, warn() {} } });
  assert.equal(result.status, "dry_run");
  assert.equal(calls, 0);
});

test("storage is checked and pauses even after the daily target is met", async () => {
  let calls = 0;
  const result = await runDailyImport({ target: 50,
    status: async () => ({ albums_imported_today: 50, database_size_bytes: 400 * MIB }),
    invoke: async () => { calls += 1; }, log: { info() {}, warn() {} } });
  assert.equal(result.status, "paused");
  assert.equal(calls, 0);
});

test("queue exhaustion is explicit and never spins", async () => {
  let calls = 0;
  const result = await runDailyImport({
    status: async () => ({ albums_imported_today: 2, database_size_bytes: 100 * MIB }),
    invoke: async () => { calls += 1; return { ok: true, message: "No artists waiting." }; },
    log: { info() {}, warn() {} }
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.reason, "queue_empty");
  assert.equal(calls, 1);
});

test("daily progress uses automation-attributed count, not external imports", async () => {
  let automated = 49;
  let external = 100;
  const result = await runDailyImport({ target: 50,
    status: async () => ({ albums_imported_today: automated, external_imports_today: external,
      database_size_bytes: 100 * MIB }),
    invoke: async () => { external += 5; automated += 1; return { ok: true }; },
    log: { info() {}, warn() {} } });
  assert.equal(result.status,"complete");
  assert.equal(result.calls,1);
});

test("concurrent busy response does not count as an import and status is rechecked", async () => {
  let checks=0, calls=0;
  const result=await runDailyImport({target:1,
    status:async()=>({albums_imported_today:checks++ ? 1 : 0,database_size_bytes:100*MIB}),
    invoke:async()=>{calls+=1;return {ok:true,deferred:"worker_busy"};},
    log:{info(){},warn(){}}});
  assert.equal(result.status,"complete"); assert.equal(calls,1);
});
