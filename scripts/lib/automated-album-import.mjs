export const MIB = 1024 * 1024;

export function storageDecision(bytes, warnMb = 350, pauseMb = 400) {
  const megabytes = bytes / MIB;
  return {
    megabytes,
    warning: megabytes >= warnMb,
    paused: megabytes >= pauseMb,
    reason: megabytes >= pauseMb ? "storage_limit" : null
  };
}

export function remainingTarget(importedToday, target) {
  return Math.max(0, target - importedToday);
}

export async function runDailyImport({
  target = 50,
  maxCalls = 150,
  dryRun = false,
  status,
  invoke,
  log = console
}) {
  let snapshot = await status();
  const initial = Number(snapshot.albums_imported_today || 0);
  let calls = 0;
  let warningEmitted = false;

  function inspectStorage() {
    const storage = storageDecision(Number(snapshot.database_size_bytes || 0));
    if (storage.warning && !warningEmitted) {
      log.warn(`Database storage warning: ${storage.megabytes.toFixed(1)} MB`);
      warningEmitted = true;
    }
    return storage;
  }

  // Monitoring is unconditional: a completed daily target must not hide a
  // warning or hard stop from operators.
  let storage = inspectStorage();
  if (storage.paused) {
    return { status: "paused", reason: storage.reason, calls, initial, snapshot };
  }
  if (dryRun) return { status: "dry_run", calls, initial, snapshot };

  while (remainingTarget(Number(snapshot.albums_imported_today || 0), target) > 0) {
    storage = inspectStorage();
    if (storage.paused) {
      return { status: "paused", reason: storage.reason, calls, initial, snapshot };
    }
    if (calls >= maxCalls) {
      return { status: "incomplete", reason: "max_calls", calls, initial, snapshot };
    }

    const result = await invoke();
    calls += 1;
    log.info(JSON.stringify({ event: "importer_call", call: calls, result }));
    if (!result?.ok) throw new Error(result?.error || "Importer returned a failure");
    if (result.review_pending) {
      log.warn(`Candidate paused for review: ${result.review_pending.release_group_id}`);
    }
    snapshot = await status();
    if (result.message === "No artists waiting." &&
        remainingTarget(Number(snapshot.albums_imported_today || 0), target) > 0) {
      return { status: "incomplete", reason: "queue_empty", calls, initial, snapshot };
    }
  }

  return { status: "complete", calls, initial, snapshot };
}
