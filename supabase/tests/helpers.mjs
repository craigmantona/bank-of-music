import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

export function loadEdge(source, extra = {}) {
  const context = {
    console: { log() {}, warn() {}, error() {} }, crypto, URL,
    Deno: { env: { get: () => "test-only" }, serve() {} },
    createClient: () => ({}), getAdminKey: () => "test-only",
    Response, Request, Headers, setTimeout, clearTimeout, AbortController, AbortSignal,
    fetch: () => { throw Error("Network access prohibited in regression tests"); },
    ...extra
  };
  const shared = readFileSync(new URL("../functions/_shared/catalogue-worker.ts", import.meta.url), "utf8");
  runInNewContext(stripTypeScriptTypes(shared.replace(/^export /gm, ""), { mode: "transform" }) +
    "\nObject.assign(globalThis, { CatalogueWorker, CatalogueDeferral, CatalogueDatabaseError, musicBrainzIdentity });", context);
  const selection = readFileSync(new URL("../functions/_shared/catalogue-selection.ts", import.meta.url), "utf8");
  runInNewContext(stripTypeScriptTypes(selection.replace(/^export /gm, ""), { mode: "transform" }) +
    "\nObject.assign(globalThis, { CATALOGUE_QUALIFICATION_VERSION, CATALOGUE_SELECTION_VERSION, mapLegacyProgress, qualifyStudioReleaseGroup, selectCanonicalEdition });", context);
  runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm, "")), context);
  return context;
}

export const importerSource = readFileSync(new URL("../functions/artist-catalog-importer/index.ts", import.meta.url), "utf8");
