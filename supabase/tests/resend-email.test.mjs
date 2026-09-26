import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadEdge } from "./helpers.mjs";

const source = readFileSync(
  new URL("../functions/send-test-email/index.ts", import.meta.url),
  "utf8"
);

function testEndpoint({
  authorization = { ok: true, kind: "admin", userId: "admin-user-id" },
  email = "admin@example.test",
  resendApiKey = "resend-secret",
  resendResponse = () => Response.json({ id: "email-id" })
} = {}) {
  let handler;
  const requests = [];

  const context = loadEdge(source, {
    TextEncoder,
    Deno: {
      env: {
        get: name => ({
          SUPABASE_URL: "https://project.invalid",
          SUPABASE_SERVICE_ROLE_KEY: "service-key",
          RESEND_API_KEY: resendApiKey
        })[name] || ""
      },
      serve: fn => { handler = fn; }
    },
    getAdminKey: () => "service-key",
    requireAdminUser: async () => authorization,
    createClient: () => ({
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email } },
            error: null
          })
        }
      }
    }),
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      return resendResponse();
    }
  });

  async function run(body = { action: "send_test" }, method = "POST") {
    const response = await handler(new Request(
      "https://project.invalid/functions/v1/send-test-email",
      {
        method,
        headers: {
          Authorization: "Bearer user-session",
          "Content-Type": "application/json"
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {})
      }
    ));
    return { response, body: await response.json() };
  }

  return { context, requests, run };
}

test("test email is admin-only and rejects unsupported methods", async () => {
  const unauthorized = testEndpoint({
    authorization: {
      ok: false,
      response: Response.json({ ok: false, error: "Administrator access required." }, { status: 403 })
    }
  });
  const forbidden = await unauthorized.run();
  assert.equal(forbidden.response.status, 403);
  assert.equal(unauthorized.requests.length, 0);

  const endpoint = testEndpoint();
  const methodNotAllowed = await endpoint.run(undefined, "GET");
  assert.equal(methodNotAllowed.response.status, 405);
  assert.equal(methodNotAllowed.response.headers.get("Allow"), "POST");
  assert.equal(endpoint.requests.length, 0);
});

test("request shape cannot select recipients or email content", async () => {
  const endpoint = testEndpoint();
  const result = await endpoint.run({
    action: "send_test",
    to: "other@example.test"
  });

  assert.equal(result.response.status, 422);
  assert.equal(endpoint.requests.length, 0);
});

test("successful test sends fixed content to the authenticated admin email", async () => {
  const endpoint = testEndpoint();
  const result = await endpoint.run();

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, id: "email-id" });
  assert.equal(endpoint.requests.length, 1);
  assert.equal(endpoint.requests[0].url, "https://api.resend.com/emails");
  assert.equal(endpoint.requests[0].options.headers.Authorization, "Bearer resend-secret");
  assert.match(endpoint.requests[0].options.headers["Idempotency-Key"], /^bom-test-[a-f0-9]{24}-\d+$/);

  const payload = JSON.parse(endpoint.requests[0].options.body);
  assert.deepEqual(payload.to, ["admin@example.test"]);
  assert.equal(payload.from, "Bank of Music <hello@thebankofmusic.com>");
  assert.equal(payload.subject, "Bank of Music email test");
  assert.match(payload.text, /transactional email connection is working/);
  assert.match(payload.html, /transactional email connection is working/);
});

test("missing configuration and invalid admin email fail without contacting Resend", async () => {
  const unconfigured = testEndpoint({ resendApiKey: "" });
  const missingSecret = await unconfigured.run();
  assert.equal(missingSecret.response.status, 503);
  assert.equal(unconfigured.requests.length, 0);

  const invalidRecipient = testEndpoint({ email: "not-an-email" });
  const invalidEmail = await invalidRecipient.run();
  assert.equal(invalidEmail.response.status, 422);
  assert.equal(invalidRecipient.requests.length, 0);
});

test("Resend errors are returned as generic gateway failures", async () => {
  const endpoint = testEndpoint({
    resendResponse: () => Response.json(
      { message: "provider detail that must not be exposed" },
      { status: 422, headers: { "x-request-id": "request-id" } }
    )
  });
  const result = await endpoint.run();

  assert.equal(result.response.status, 502);
  assert.deepEqual(result.body, {
    ok: false,
    error: "Email provider rejected the request."
  });
});

test("function registration keeps JWT verification enabled", () => {
  const config = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.send-test-email\]\s+verify_jwt = true/);
});
