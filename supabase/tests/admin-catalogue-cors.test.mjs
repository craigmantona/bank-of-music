import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadEdge } from "./helpers.mjs";

const source = readFileSync(
  new URL("../functions/admin-catalogue/index.ts", import.meta.url),
  "utf8"
);

function loadHandler() {
  let handler;
  loadEdge(source.replace(/^export /gm, ""), {
    Deno: {
      env: { get: () => "test-only" },
      serve: value => { handler = value; }
    },
    getAdminKey: () => "service-key",
    createClient: () => ({})
  });
  return handler;
}

test("Admin Catalogue permits the canonical production origin", async () => {
  const response = await loadHandler()(new Request(
    "https://project.invalid/functions/v1/admin-catalogue",
    { method: "OPTIONS", headers: { Origin: "https://thebankofmusic.com" } }
  ));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://thebankofmusic.com");
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("Admin Catalogue does not reflect an unapproved origin", async () => {
  const response = await loadHandler()(new Request(
    "https://project.invalid/functions/v1/admin-catalogue",
    { method: "OPTIONS", headers: { Origin: "https://unapproved.example" } }
  ));

  assert.equal(response.status, 204);
  assert.notEqual(response.headers.get("Access-Control-Allow-Origin"), "https://unapproved.example");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://bank-of-music.pages.dev");
});
