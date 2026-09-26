import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../bom-password-recovery.js", import.meta.url), "utf8");

function element() {
  const classes = new Set(["hidden"]);
  const listeners = new Map();
  return {
    value: "",
    textContent: "",
    disabled: false,
    focused: false,
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      toggle(value, force) {
        if (force === undefined ? !classes.has(value) : force) classes.add(value);
        else classes.delete(value);
      },
      contains: value => classes.has(value)
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    focus() { this.focused = true; },
    listeners
  };
}

function setup({ href = "https://bom.example/", updateUser } = {}) {
  const ids = Object.fromEntries([
    "passwordRecoveryCard", "passwordRecoveryForm", "newPassword", "confirmNewPassword",
    "setNewPasswordBtn", "passwordRecoveryContinueBtn", "passwordRecoveryMessage"
  ].map(id => [id, element()]));
  const stored = new Map();
  let exitCount = 0;
  const url = new URL(href);
  const window = {
    location: { href: url.href, pathname: url.pathname, search: url.search, hash: url.hash },
    history: { replaceState(_state, _title, next) { window.replacedUrl = next; } },
    sessionStorage: {
      getItem: key => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: key => stored.delete(key)
    },
    setTimeout: callback => callback()
  };
  window.window = window;
  const document = {
    getElementById: id => ids[id],
    body: element()
  };
  const context = vm.createContext({ URL, URLSearchParams, window });
  vm.runInContext(source, context);
  const calls = [];
  const controller = window.BOMPasswordRecovery.create({
    auth: { updateUser: async payload => { calls.push(payload); return updateUser?.(payload) ?? { error: null }; } },
    document,
    window,
    onExit: () => { exitCount += 1; }
  });
  return { controller, ids, stored, calls, document, window, get exitCount() { return exitCount; } };
}

test("normal login remains an ordinary authenticated session", () => {
  const app = setup();
  assert.equal(app.controller.handleAuthEvent("SIGNED_IN", { user: { id: "normal-user" } }), false);
  assert.equal(app.controller.isActive(), false);
  assert.equal(app.document.body.classList.contains("bom-password-recovery-active"), false);
});

test("PASSWORD_RECOVERY opens reset UI and takes precedence over authenticated navigation", () => {
  const app = setup();
  assert.equal(app.controller.handleAuthEvent("PASSWORD_RECOVERY", { user: { id: "recovering-user" } }), true);
  assert.equal(app.controller.isActive(), true);
  assert.equal(app.ids.passwordRecoveryCard.classList.contains("hidden"), false);
  assert.equal(app.document.body.classList.contains("bom-password-recovery-active"), true);
  assert.equal(app.controller.handleAuthEvent("TOKEN_REFRESHED", { user: { id: "recovering-user" } }), true);
});

test("Supabase recovery hash and stored user preserve recovery mode on re-entry", () => {
  const initial = setup({ href: "https://bom.example/#access_token=token&type=recovery" });
  assert.equal(initial.controller.isActive(), true);
  assert.equal(initial.controller.reconcileSession({ user: { id: "recovering-user" } }), true);
  assert.equal(initial.stored.get("bom_password_recovery_user_id"), "recovering-user");
});

test("invalid and mismatched passwords are rejected locally", async () => {
  const app = setup();
  app.controller.activate({ user: { id: "user" } });
  app.ids.newPassword.value = "short";
  app.ids.confirmNewPassword.value = "short";
  await app.controller.submit();
  assert.match(app.ids.passwordRecoveryMessage.textContent, /at least 6/);
  app.ids.newPassword.value = "valid-one";
  app.ids.confirmNewPassword.value = "valid-two";
  await app.controller.submit();
  assert.match(app.ids.passwordRecoveryMessage.textContent, /do not match/);
  assert.equal(app.calls.length, 0);
});

test("successful reset updates through Supabase and exits only after Continue", async () => {
  const app = setup();
  app.controller.activate({ user: { id: "user" } });
  app.ids.newPassword.value = "new-password";
  app.ids.confirmNewPassword.value = "new-password";
  await app.controller.submit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].password, "new-password");
  assert.match(app.ids.passwordRecoveryMessage.textContent, /updated successfully/);
  assert.equal(app.controller.isActive(), true);
  assert.equal(app.ids.passwordRecoveryContinueBtn.classList.contains("hidden"), false);
  app.controller.continueToApp();
  assert.equal(app.controller.isActive(), false);
  assert.equal(app.exitCount, 1);
});

test("Supabase reset failure is shown safely and recovery remains active", async () => {
  const app = setup({ updateUser: async () => ({ error: { message: "Recovery session expired" } }) });
  app.controller.activate({ user: { id: "user" } });
  app.ids.newPassword.value = "new-password";
  app.ids.confirmNewPassword.value = "new-password";
  await app.controller.submit();
  assert.equal(app.ids.passwordRecoveryMessage.textContent, "Recovery session expired");
  assert.equal(app.ids.passwordRecoveryMessage.classList.contains("error"), true);
  assert.equal(app.controller.isActive(), true);
});
