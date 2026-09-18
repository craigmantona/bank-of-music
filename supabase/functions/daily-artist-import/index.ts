import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireCronSecretOrAdmin } from "../_shared/authorization.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://bank-of-music.pages.dev",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-bom-cron-secret, apikey, x-client-info",
  "Vary": "Origin"
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

async function functionErrorDetails(error: any) {
  const response = error?.context;
  if (!(response instanceof Response)) return null;

  try {
    return {
      status: response.status,
      body: await response.clone().json()
    };
  } catch {
    return {
      status: response.status,
      body: (await response.clone().text()).slice(0, 1500)
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  const authorization = await requireCronSecretOrAdmin(request);
  if (!authorization.ok) return withCors(authorization.response);

  let action = "run";

  try {
    const body = await request.json();
    if (typeof body?.action === "string") action = body.action;
  } catch {
    // An empty request body is the normal scheduled run.
  }

  if (action === "auth-check") {
    return jsonResponse({
      ok: true,
      authorized: true,
      principal: authorization.kind
    });
  }

  if (action !== "run") {
    return jsonResponse({ ok: false, error: "Unknown import action." }, 400);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const adminKey = getAdminKey();

    if (!supabaseUrl || !adminKey) {
      throw new Error("Missing Supabase server credentials.");
    }

    // Construct the privileged client only after authentication and input
    // validation have succeeded.
    const supabase = createClient(supabaseUrl, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    console.log(
      "DAILY IMPORT: starting artist catalogue run"
    );

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "artist-catalog-importer",
        {
          body: {},
          // Make the service principal explicit for server-to-server calls.
          // This avoids depending on FunctionsClient header defaults.
          headers: {
            Authorization: `Bearer ${adminKey}`
          }
        }
      );

    if (error) {
      const downstream =
        await functionErrorDetails(error);

      console.error(
        "DAILY IMPORT: importer failed",
        error,
        downstream
      );

      return jsonResponse(
        {
          ok: false,
          error:
            error.message ||
            String(error),
          downstream
        },
        500
      );
    }

    console.log(
      "DAILY IMPORT: importer response",
      JSON.stringify(data)
    );

    return jsonResponse({
      ok: true,
      importer: data
    });
  } catch (error) {
    console.error(
      "DAILY IMPORT: unexpected error",
      error
    );

    return jsonResponse(
      {
        ok: false,
        error:
          String(
            (error as any)?.message ||
            error
          )
      },
      500
    );
  }
});
