import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const output = path.join(root, "public");
const limit = 25 * 1024 * 1024;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : [target];
  }));
  return nested.flat();
}

test("Cloudflare Pages publishes only the allowlisted static website", async () => {
  const files = await filesBelow(output);
  const relative = files.map(file => path.relative(output, file)).sort();
  for (const forbidden of ["supabase", "scripts", "tests", "prototype", "outputs", ".git", ".env"]) {
    assert.equal(relative.some(file => file === forbidden || file.startsWith(`${forbidden}/`)), false, `${forbidden} leaked into public output`);
  }
  assert(relative.includes("index.html"));
  assert(relative.includes("app.js"));
  assert(relative.includes("config.js"));
  assert(relative.includes("bom-discover.js"));
  assert(relative.includes("bom-foundation.css"));
  assert(relative.includes("historical-uk-number-ones-cover-art.json"));
  assert(relative.includes("artist-easter-eggs.js"));
  assert(relative.includes("assets/bom-header-logo.png"));
  assert(relative.includes("assets/david-bowie-lightning.png"));
  assert(relative.includes("assets/rolling-stones-easter-egg.png"));
  assert(relative.includes("assets/fonts/manrope-regular.ttf"));
  for (const file of files) assert((await stat(file)).size < limit, `${path.relative(output, file)} exceeds 25 MiB`);
});

test("the generated publication matches the approved source assets", async () => {
  const files = await filesBelow(output);
  for (const published of files) {
    const relative = path.relative(output, published);
    assert.deepEqual(await readFile(published), await readFile(path.join(root, relative)), `${relative} is stale`);
  }
  assert.match(await readFile(path.join(output, "index.html"), "utf8"), /bom-foundation\.css\?v=48&autocomplete=1/);
});
