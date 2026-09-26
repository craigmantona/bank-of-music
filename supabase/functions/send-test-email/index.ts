import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAdminKey,
  requireAdminUser
} from "../_shared/authorization.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SENDER = "Bank of Music <hello@thebankofmusic.com>";
const TEST_ACTION = "send_test";
const TEST_SUBJECT = "Bank of Music email test";
const TEST_TEXT = "Your Bank of Music transactional email connection is working.";
const TEST_HTML = "<p>Your Bank of Music transactional email connection is working.</p>";

function jsonResponse(body: Record<string, unknown>, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const adminKey = getAdminKey();

  if (!supabaseUrl || !adminKey) {
    throw new Error("Missing Supabase server credentials.");
  }

  return createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readAction(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false as const, response: jsonResponse({ ok: false, error: "Valid JSON is required." }, 400) };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, response: jsonResponse({ ok: false, error: "Invalid request." }, 422) };
  }

  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== "action" || entries[0][1] !== TEST_ACTION) {
    return { ok: false as const, response: jsonResponse({ ok: false, error: "Unsupported email action." }, 422) };
  }

  return { ok: true as const };
}

async function buildIdempotencyKey(userId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId)
  );
  const userHash = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const tenMinuteBucket = Math.floor(Date.now() / 600000);
  return `bom-test-${userHash}-${tenMinuteBucket}`;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "Method not allowed." },
      405,
      { Allow: "POST" }
    );
  }

  const authorization = await requireAdminUser(request);
  if (!authorization.ok) return authorization.response;
  const userId = authorization.userId;
  if (!userId) {
    return jsonResponse({ ok: false, error: "Authenticated user identity is unavailable." }, 500);
  }

  const action = await readAction(request);
  if (!action.ok) return action.response;

  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!resendApiKey) {
    return jsonResponse(
      { ok: false, error: "Email service is not configured." },
      503
    );
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(
      userId
    );
    const recipient = data?.user?.email;

    if (error) {
      console.error("Unable to load test email recipient", error.message);
      return jsonResponse({ ok: false, error: "Unable to load email recipient." }, 502);
    }

    if (!isValidEmail(recipient)) {
      return jsonResponse(
        { ok: false, error: "The administrator account has no valid email address." },
        422
      );
    }

    const resendResponse = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": await buildIdempotencyKey(userId)
      },
      body: JSON.stringify({
        from: SENDER,
        to: [recipient],
        subject: TEST_SUBJECT,
        text: TEST_TEXT,
        html: TEST_HTML
      })
    });

    let resendData: Record<string, unknown> = {};
    try {
      resendData = await resendResponse.json();
    } catch {
      // A non-JSON upstream response is handled as a generic gateway failure.
    }

    if (!resendResponse.ok || typeof resendData.id !== "string" || !resendData.id) {
      console.error("Resend test email failed", {
        status: resendResponse.status,
        requestId: resendResponse.headers.get("x-request-id") || ""
      });
      return jsonResponse({ ok: false, error: "Email provider rejected the request." }, 502);
    }

    return jsonResponse({ ok: true, id: resendData.id });
  } catch (error) {
    console.error(
      "Test email failed",
      error instanceof Error ? error.message : "Unexpected error"
    );
    return jsonResponse({ ok: false, error: "Email could not be sent." }, 502);
  }
});
