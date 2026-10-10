import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
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

function earlyAccessEndpoint({ resendResponse, existingInvitation = null } = {}) {
  let handler;
  let invitationSequence = 0;
  const request = { id: "request-1", email: "invitee@example.test", status: "PENDING" };
  const invitations = existingInvitation ? [{ ...existingInvitation }] : [];
  const logs = [];
  const fetches = [];

  const resolvingChain = apply => {
    const filters = [];
    const chain = {
      eq(column, value) { filters.push([column, value]); return chain; },
      is(column, value) { filters.push([column, value]); return chain; },
      in() { return chain; },
      then(resolve) { resolve(apply(filters)); }
    };
    return chain;
  };
  const matches = (row, filters) => filters.every(([column, value]) => row[column] === value);
  const db = {
    from(table) {
      if (table === "early_access_requests") return {
        select() {
          const filters = [];
          const chain = {
            eq(column, value) { filters.push([column, value]); return chain; },
            async maybeSingle() { return { data: matches(request, filters) ? { ...request } : null, error: null }; }
          };
          return chain;
        },
        update(values) {
          return resolvingChain(filters => {
            if (matches(request, filters)) Object.assign(request, values);
            return { error: null };
          });
        }
      };
      if (table === "early_access_invitations") return {
        insert(values) {
          return { select() { return { async single() {
            if (invitations.some(item => ["PENDING", "SENT"].includes(item.status) && item.email === values.email)) {
              return { data: null, error: { message: "duplicate" } };
            }
            const invitation = { id: `new-invitation-${++invitationSequence}`, status: "PENDING", sent_at: null, accepted_at: null, ...values };
            invitations.push(invitation);
            return { data: { id: invitation.id }, error: null };
          } }; } };
        },
        update(values) {
          return resolvingChain(filters => {
            invitations.filter(item => matches(item, filters)).forEach(item => Object.assign(item, values));
            return { error: null };
          });
        },
        delete() {
          return resolvingChain(filters => {
            for (let index = invitations.length - 1; index >= 0; index -= 1) {
              if (matches(invitations[index], filters)) invitations.splice(index, 1);
            }
            return { error: null };
          });
        }
      };
      throw new Error(`Unexpected table ${table}`);
    }
  };
  const context = {
    btoa, crypto, TextEncoder, Request, Response, Headers, URL,
    console: {
      error(message, details) { logs.push({ level: "error", message, details }); },
      warn(message, details) { logs.push({ level: "warn", message, details }); },
      info(message, details) { logs.push({ level: "info", message, details }); }
    },
    Deno: {
      env: { get: name => ({ SUPABASE_URL: "https://project.invalid", RESEND_API_KEY: "resend-secret", BOM_SITE_URL: "https://thebankofmusic.com" })[name] || "" },
      serve(fn) { handler = fn; }
    },
    createClient: () => db,
    getAdminKey: () => "service-key",
    requireAdminUser: async () => ({ ok: true, kind: "admin", userId: "admin-1" }),
    fetch: async (url, options) => {
      fetches.push({ url: String(url), options });
      return resendResponse ? resendResponse(options) : Response.json({ id: "resend-message-1" });
    }
  };
  const runnable = stripTypeScriptTypes(edge.replace(/^import .*;\r?\n/gm, ""), { mode: "transform" });
  vm.runInNewContext(runnable, context);
  const approve = async () => {
    const response = await handler(new Request("https://project.invalid/functions/v1/early-access", {
      method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", requestId: request.id })
    }));
    return { status: response.status, body: await response.json() };
  };
  return { approve, request, invitations, logs, fetches };
}

test("successful invitation send retains and marks the new invitation", async () => {
  const endpoint = earlyAccessEndpoint();
  const result = await endpoint.approve();

  assert.equal(result.status, 200);
  assert.equal(endpoint.invitations.length, 1);
  assert.equal(endpoint.invitations[0].status, "SENT");
  assert.ok(endpoint.invitations[0].sent_at);
  assert.equal(endpoint.request.status, "APPROVED");
  assert.equal(endpoint.fetches.length, 1);
  assert.equal(endpoint.logs[0].details.resendStatus, 200);
  assert.equal(endpoint.logs[0].details.providerRequestId, "resend-message-1");
});

test("failed Resend send removes only its new invitation, leaves the request pending and permits retry", async () => {
  let fail = true;
  const preExisting = { id: "unrelated-invitation", email: "other@example.test", status: "SENT", sent_at: "2026-10-01T00:00:00Z", accepted_at: null };
  const endpoint = earlyAccessEndpoint({
    existingInvitation: preExisting,
    resendResponse: options => fail
      ? Response.json({ message: `recipient rejected ${JSON.parse(options.body).text} resend-secret`, token: "provider-secret" }, { status: 422, headers: { "x-request-id": "resend-request-1" } })
      : Response.json({ id: "resend-message-2" })
  });
  const failed = await endpoint.approve();

  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "The invitation email could not be sent. No invitation was created; please try again.");
  assert.equal(endpoint.request.status, "PENDING");
  assert.deepEqual(endpoint.invitations.map(item => item.id), ["unrelated-invitation"]);
  assert.equal(endpoint.logs[0].details.resendStatus, 422);
  assert.equal(endpoint.logs[0].details.providerRequestId, "resend-request-1");
  const sentPayload = JSON.parse(endpoint.fetches[0].options.body);
  const invitationToken = new URL(sentPayload.text.match(/https:\/\/\S+/)[0]).searchParams.get("invitation");
  const serializedLogs = JSON.stringify(endpoint.logs);
  assert.ok(invitationToken);
  assert.doesNotMatch(serializedLogs, new RegExp(invitationToken));
  assert.doesNotMatch(serializedLogs, /resend-secret|provider-secret/);

  fail = false;
  const retried = await endpoint.approve();
  assert.equal(retried.status, 200);
  assert.equal(endpoint.invitations.length, 2);
  assert.equal(endpoint.invitations.find(item => item.email === "invitee@example.test")?.status, "SENT");
  assert.equal(endpoint.request.status, "APPROVED");
});

test("a pre-existing invitation is never deleted by an approval attempt", async () => {
  const preExisting = { id: "existing-live-invitation", email: "invitee@example.test", status: "PENDING", sent_at: null, accepted_at: null };
  const endpoint = earlyAccessEndpoint({ existingInvitation: preExisting });
  const result = await endpoint.approve();

  assert.equal(result.status, 409);
  assert.deepEqual(endpoint.invitations, [preExisting]);
  assert.equal(endpoint.fetches.length, 0);
  assert.equal(endpoint.request.status, "PENDING");
});

test("Admin displays a structured Edge Function error with a safe fallback", async () => {
  const window = { document: { getElementById: () => null }, location: { search: "" } };
  vm.runInNewContext(client, { window, URLSearchParams });
  const structured = {
    functions: { invoke: async () => ({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: Response.json({ error: "No invitation was created; please try again." }, { status: 502 }) } }) }
  };
  await assert.rejects(window.BOMEarlyAccess.invoke(structured, { action: "approve" }), /No invitation was created; please try again/);

  const fallback = { functions: { invoke: async () => ({ data: null, error: { message: "Safe generic fallback" } }) } };
  await assert.rejects(window.BOMEarlyAccess.invoke(fallback, { action: "approve" }), /Safe generic fallback/);
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
