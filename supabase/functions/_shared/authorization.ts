import { createClient } from "npm:@supabase/supabase-js@2";

type AuthorizationResult =
  | {
      ok: true;
      kind: "service" | "scheduler" | "admin" | "user";
      userId?: string;
    }
  | { ok: false; response: Response };

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);

  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

export function getAdminKeys() {
  const keys = new Set<string>();
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      for (const value of Object.values(parsed || {})) {
        if (typeof value === "string" && value) keys.add(value);
      }
    } catch {
      // Fall through to the individually hosted keys below.
    }
  }

  for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = Deno.env.get(name);
    if (value) keys.add(value);
  }

  return [...keys];
}

export function getAdminKey() {
  return getAdminKeys()[0] || "";
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

export async function requireAuthenticatedUser(
  request: Request
): Promise<AuthorizationResult> {
  const token = getBearerToken(request);

  if (!token) {
    return { ok: false, response: jsonError("Authentication required.", 401) };
  }

  const admin = getAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false,
      response: jsonError("Invalid or expired session.", 401)
    };
  }

  return { ok: true, kind: "user", userId: user.id };
}

export async function requireServiceOrAdmin(
  request: Request
): Promise<AuthorizationResult> {
  const token = getBearerToken(request);

  if (!token) {
    return { ok: false, response: jsonError("Authentication required.", 401) };
  }

  if (getAdminKeys().includes(token)) {
    return { ok: true, kind: "service" };
  }

  return requireAdminUser(request);
}

export async function requireAdminUser(
  request: Request
): Promise<AuthorizationResult> {
  const userResult = await requireAuthenticatedUser(request);
  if (!userResult.ok) return userResult;

  const admin = getAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userResult.userId)
    .maybeSingle();

  if (error || profile?.is_admin !== true) {
    return {
      ok: false,
      response: jsonError("Administrator access required.", 403)
    };
  }

  return { ok: true, kind: "admin", userId: userResult.userId };
}

export async function requireCronSecretOrAdmin(
  request: Request
): Promise<AuthorizationResult> {
  const suppliedCronSecret =
    request.headers.get("x-bom-cron-secret") || "";

  if (suppliedCronSecret) {
    const expectedCronSecret =
      Deno.env.get("BOM_IMPORT_CRON_SECRET") || "";

    if (!expectedCronSecret) {
      return {
        ok: false,
        response: jsonError("Scheduler authentication is unavailable.", 503)
      };
    }

    if (await constantTimeEqual(suppliedCronSecret, expectedCronSecret)) {
      return { ok: true, kind: "scheduler" };
    }

    return {
      ok: false,
      response: jsonError("Invalid scheduler authentication.", 401)
    };
  }

  return requireAdminUser(request);
}
