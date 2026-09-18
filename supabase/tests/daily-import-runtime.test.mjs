import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadEdge } from "./helpers.mjs";

const source = readFileSync(
  new URL("../functions/daily-artist-import/index.ts", import.meta.url),
  "utf8"
);

function scheduler(error = null, data = null) {
  let handler;
  let invocation;
  const ctx = loadEdge(source, {
    Deno: {
      env: { get: name => name === "SUPABASE_URL" ? "https://project.invalid" : "service-secret" },
      serve: fn => { handler = fn; }
    },
    getAdminKey: () => "service-secret",
    requireCronSecretOrAdmin: async () => ({ ok: true, kind: "scheduler" }),
    createClient: () => ({
      functions: {
        invoke: async (name, options) => {
          invocation = { name, options };
          return { data, error };
        }
      }
    })
  });

  return {
    invocation: () => invocation,
    run: async () => {
      const response = await handler(new Request("https://project.invalid", {
        method: "POST",
        headers: { "x-bom-cron-secret": "cron-secret" },
        body: JSON.stringify({ action: "run" })
      }));
      return { status: response.status, body: await response.json() };
    }
  };
}

test("scheduled invocation explicitly authenticates the importer as service role", async () => {
  const app = scheduler(null, { ok: true, deferred: "worker_busy" });
  const response = await app.run();

  assert.equal(response.status, 200);
  assert.equal(response.body.importer.deferred, "worker_busy");
  assert.equal(app.invocation().name, "artist-catalog-importer");
  assert.equal(app.invocation().options.headers.Authorization, "Bearer service-secret");
  assert.equal(Object.keys(app.invocation().options.body).length, 0);
});

test("scheduled invocation preserves the importer's HTTP error details", async () => {
  const context = Response.json(
    { ok: false, error: "Catalogue acquire failed: exact failure" },
    { status: 500 }
  );
  const app = scheduler({ message: "Edge Function returned a non-2xx status code", context });
  const response = await app.run();

  assert.equal(response.status, 500);
  assert.deepEqual(response.body.downstream, {
    status: 500,
    body: { ok: false, error: "Catalogue acquire failed: exact failure" }
  });
});
