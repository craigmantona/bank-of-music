import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extract(start, end) {
  const from = app.indexOf(start);
  return app.slice(from, app.indexOf(end, from));
}

function createStartupContext({ session = { user: { id: "user-1" } }, authError = null, loadResults = [] } = {}) {
  const events = [];
  let loadIndex = 0;
  const context = vm.createContext({
    console: { error: (...args) => events.push(["console", ...args]) },
    currentUser: null,
    authMessage: {},
    passwordRecovery: null,
    supabaseClient: { auth: { getSession: async () => ({ data: { session }, error: authError }) } },
    ensureUserProfile: async () => {},
    updateSessionUI: () => events.push(["session-ui", context.currentUser?.id || null]),
    setMessage: (_target, message) => events.push(["message", message]),
    renderStageOneDiscoverLoading: () => events.push(["discover-loading"]),
    renderStageOneDiscoverError: () => events.push(["discover-error"]),
    loadLibrary: async () => {
      const result = loadResults[loadIndex++] ?? { ok: true };
      if (result.error) throw result.error;
    },
    renderLibrary: () => events.push(["library"]),
    renderRecommendations: () => events.push(["recommendations"]),
    renderAdminDashboard: () => events.push(["admin"]),
    renderSelectedItem: async () => events.push(["selected"]),
    handleScrollState: () => events.push(["scroll"])
  });
  vm.runInContext(extract("function getBoundedCatalogueDiagnostic", "async function signUp"), context);
  return { context, events, getLoadCount: () => loadIndex };
}

test("authenticated catalogue failure preserves session and renders only a bounded error", async () => {
  const rawBody = `[{"private-looking":"${"catalogue".repeat(10000)}"}]`;
  const { context, events } = createStartupContext({ loadResults: [{ error: { message: rawBody } }] });

  assert.equal(await context.refreshSessionUI(), false);
  assert.equal(context.currentUser.id, "user-1");
  assert.deepEqual(events.find(event => event[0] === "session-ui"), ["session-ui", "user-1"]);
  assert.ok(events.some(event => event[0] === "discover-error"));
  assert.ok(!events.some(event => JSON.stringify(event).includes(rawBody)));
  assert.ok(!events.some(event => event[0] === "message" && /Session error/.test(event[1])));
});

test("catalogue failure can retry successfully without reauthentication", async () => {
  const { context, events, getLoadCount } = createStartupContext({
    loadResults: [{ error: new Error("temporary failure") }, { ok: true }]
  });

  assert.equal(await context.refreshSessionUI(), false);
  assert.equal(await context.refreshCatalogueUI(), true);
  assert.equal(getLoadCount(), 2);
  assert.equal(context.currentUser.id, "user-1");
  assert.ok(events.some(event => event[0] === "recommendations"));
});

test("genuine session restoration failure retains bounded auth failure behaviour", async () => {
  const rawBody = "token details that must not render".repeat(1000);
  const { context, events, getLoadCount } = createStartupContext({ authError: { message: rawBody } });

  assert.equal(await context.refreshSessionUI(), false);
  assert.equal(context.currentUser, null);
  assert.equal(getLoadCount(), 0);
  assert.ok(events.some(event => event[0] === "message" && event[1] === "Session error. Please try signing in again."));
  assert.ok(!events.some(event => JSON.stringify(event).includes(rawBody)));
});

test("auth-state catalogue rejection is explicitly handled", async () => {
  const events = [];
  let authHandler;
  const context = vm.createContext({
    currentUser: null,
    passwordRecovery: null,
    supabaseClient: { auth: { onAuthStateChange: handler => { authHandler = handler; } } },
    ensureUserProfile: async () => {},
    updateSessionUI: () => events.push("session-ui"),
    refreshCatalogueUI: async () => { throw new Error("render failure"); },
    handleCatalogueLoadFailure: () => { events.push("handled"); return false; }
  });
  vm.runInContext(extract("supabaseClient.auth.onAuthStateChange", "/* ============================================================\n   v29 SOCIAL UPGRADE"), context);

  authHandler("SIGNED_IN", { user: { id: "user-1" } });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(context.currentUser.id, "user-1");
  assert.deepEqual(events, ["session-ui", "handled"]);
});

test("Discover retry starts the safe catalogue refresh path", () => {
  assert.match(app, /refreshDiscover:\s*\(\)\s*=>\s*refreshCatalogueUI\(\)/);
});
