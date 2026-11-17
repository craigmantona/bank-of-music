import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/daily-album-discovery.yml", import.meta.url);

test("scheduled album workflow is independently disabled by default", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /^    if: \$\{\{ vars\.AUTOMATED_ALBUM_IMPORT_ENABLED == 'true' \}\}$/m);
  assert.match(workflow, /AUTOMATED_ALBUM_IMPORT_ENABLED: \$\{\{ vars\.AUTOMATED_ALBUM_IMPORT_ENABLED \}\}/);
  assert.doesNotMatch(workflow,
    /^    if: .*ALBUM_DISCOVERY_KILL_SWITCH/m,
    "the production job gate must not depend on the discovery kill switch");
});

test("manual production imports require explicit confirmation", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /confirm_production_import:[\s\S]+default: false/);
  assert.match(workflow,
    /if: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.dry_run == true \|\| inputs\.confirm_production_import == true \}\}/);
});

test("pilot workflow is capped at five and requires an explicit release-group allowlist", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /default: "5"/);
  assert.match(workflow, /ALBUM_IMPORT_TARGET: \$\{\{ inputs\.target \|\| '5' \}\}/);
  assert.match(workflow, /ALBUM_IMPORT_APPROVED_RELEASE_GROUP_IDS: \$\{\{ vars\.ALBUM_IMPORT_APPROVED_RELEASE_GROUP_IDS \}\}/);
});

test("import entry point exits before credentials or network when automation is disabled", () => {
  const script = fileURLToPath(new URL("../scripts/automated-album-import.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {}
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Album import automation disabled/);
  assert.doesNotMatch(result.stderr, /SUPABASE_URL/);
});
