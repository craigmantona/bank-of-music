import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [migration, edge, client, app, html, css, config] = await Promise.all([
  readFile(new URL("../supabase/migrations/20261010083934_early_access_registration.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/early-access/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../bom-early-access.js", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../style.css", import.meta.url), "utf8"),
  readFile(new URL("../supabase/config.toml", import.meta.url), "utf8")
]);

test("existing member login and password recovery remain unrestricted", () => {
  assert.match(app, /auth\.signInWithPassword/);
  assert.doesNotMatch(app.match(/async function logIn\(\)[\s\S]*?async function logOut/)?.[0] || "", /invitation|registrationMode/);
  assert.match(html, /bom-password-recovery\.js/);
});

test("PUBLIC mode remains the migration default and permits ordinary signup", () => {
  assert.match(migration, /insert into public\.registration_settings \(singleton, mode\) values \(true, 'PUBLIC'\)/);
  assert.match(migration, /if v_mode = 'PUBLIC' then return '\{\}'::jsonb/);
});

test("INVITATION ONLY is enforced by a configured before-user-created hook", () => {
  assert.match(config, /\[auth\.hook\.before_user_created\][\s\S]*enabled = true/);
  assert.match(migration, /Registration currently requires a valid invitation/);
  assert.match(migration, /grant execute on function public\.early_access_before_user_created\(jsonb\) to supabase_auth_admin/);
});

test("Early Access requests are normalized, deduplicated and enumeration-safe", () => {
  assert.match(migration, /normalized_email text generated always as \(lower\(btrim\(email\)\)\) stored/);
  assert.match(migration, /early_access_requests_email_unique unique \(normalized_email\)/);
  assert.match(edge, /genericRequestMessage/);
  assert.match(edge, /await db\.from\("early_access_requests"\)\.insert/);
});

test("successful Early Access request shows confirmation and safely resets its form", async () => {
  const listeners = new Map();
  const elements = {
    earlyAccessRequestForm: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      reset() {
        this.resetCount = (this.resetCount || 0) + 1;
        elements.earlyAccessName.value = "";
        elements.earlyAccessEmail.value = "";
      }
    },
    earlyAccessName: { value: "BOM Test" },
    earlyAccessEmail: { value: "test@example.com" },
    earlyAccessRequestMessage: { textContent: "" }
  };
  const calls = [];
  const window = {
    document: { getElementById: id => elements[id] || null },
    location: { search: "" }
  };
  vm.runInNewContext(client, { window, URLSearchParams });
  const supabase = {
    from() { return { select() { return { maybeSingle: async () => ({ data: { mode: "INVITATION_ONLY" } }) }; } }; },
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        await Promise.resolve();
        return { data: { ok: true, message: "Request received." }, error: null };
      }
    }
  };
  await window.BOMEarlyAccess.init(supabase);
  const event = { preventDefault() {}, currentTarget: elements.earlyAccessRequestForm };
  const submission = listeners.get("submit")(event);
  event.currentTarget = null;
  await submission;

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "early-access");
  assert.equal(calls[0].options.body.action, "request_access");
  assert.equal(calls[0].options.body.name, "BOM Test");
  assert.equal(calls[0].options.body.email, "test@example.com");
  assert.equal(elements.earlyAccessRequestMessage.textContent, "Request received.");
  assert.equal(elements.earlyAccessRequestForm.resetCount, 1);
  assert.equal(elements.earlyAccessName.value, "");
  assert.equal(elements.earlyAccessEmail.value, "");
});

test("admin approval and direct invitations use the same trusted server operation", () => {
  assert.match(edge, /requireAdminUser\(request\)/);
  assert.match(edge, /action === "invite" \|\| action === "approve"/);
  assert.match(client, /data-ea-approve/);
  assert.match(client, /directInvitationForm/);
});

test("invitation tokens are random, hashed, email-bound, expiring and single-use", () => {
  assert.match(edge, /getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(edge, /token_hash: await sha256\(token\)/);
  assert.match(migration, /token_hash = encode\(digest\(v_token, 'sha256'\), 'hex'\)/);
  assert.match(migration, /normalized_email = v_email/);
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(migration, /accepted_at is null/);
});

test("expired, revoked, wrong-email and replayed invitations are rejected", () => {
  assert.match(migration, /revoked_at is null/);
  assert.match(migration, /status in \('PENDING', 'SENT'\)/);
  assert.match(migration, /This invitation is invalid or has expired/);
  assert.match(edge, /action === "revoke"/);
});

test("non-admin users cannot approve or manufacture invitations", () => {
  const publicBranch = edge.slice(0, edge.indexOf("const authorization = await requireAdminUser"));
  assert.doesNotMatch(publicBranch, /action === "approve"|action === "invite"/);
  assert.match(migration, /revoke all on public\.registration_settings, public\.early_access_requests,[\s\S]*public\.early_access_invitations from anon, authenticated/);
});

test("Founding Members are backfilled and assigned only during Early Access", () => {
  assert.match(migration, /insert into public\.profiles \(id, created_at, is_founding_member\)[\s\S]*left join public\.profiles profiles[\s\S]*where profiles\.id is null/);
  assert.match(migration, /update public\.profiles set is_founding_member = true/);
  assert.match(migration, /when settings\.mode = 'INVITATION_ONLY' then true/);
  assert.match(migration, /else exists \([\s\S]*invitation\.accepted_user_id = new\.id/);
  assert.match(migration, /where singleton is true for update/);
  assert.match(edge, /db\.rpc\("admin_set_registration_mode"/);
});

test("later PUBLIC registrations do not automatically become Founding Members", () => {
  assert.match(migration, /is_founding_member boolean not null default false/);
  assert.match(migration, /else exists/);
  assert.doesNotMatch(app.match(/async function signUp\(\)[\s\S]*?async function logIn/)?.[0] || "", /is_founding_member\s*:/);
});

test("vinyl badge is reusable, accessible and rendered only from founding status", () => {
  assert.match(client, /function badge\(isFoundingMember\)/);
  assert.match(client, /aria-label="Founding Member"/);
  assert.match(css, /repeating-radial-gradient/);
  assert.match(app, /badge\(currentProfile\?\.is_founding_member\)/);
  assert.match(app, /badge\(profile\.is_founding_member\)/);
});
