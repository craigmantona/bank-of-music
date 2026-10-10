import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireAdminUser } from "../_shared/authorization.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const genericRequestMessage = "Thanks! Your Early Access request has been received. We’ll be in touch if your invitation is approved.";
const validEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = getAdminKey();
  if (!url || !key) throw new Error("Missing Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sendInvite(email: string, token: string) {
  const key = Deno.env.get("RESEND_API_KEY") || "";
  const siteUrl = (Deno.env.get("BOM_SITE_URL") || "https://thebankofmusic.com").replace(/\/$/, "");
  if (!key) throw new Error("Email service is not configured.");
  const activationUrl = `${siteUrl}/?invitation=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Bank of Music <hello@thebankofmusic.com>", to: [email],
      subject: "You’re invited to The Bank of Music Early Access",
      text: `You’re invited to join The Bank of Music Early Access. Activate your invitation to create your account: ${activationUrl}`,
      html: `<div style="background:#070b15;color:#f4f4ef;padding:32px;font-family:Arial,sans-serif"><p style="color:#22f5a7;letter-spacing:.12em">THE BANK OF MUSIC</p><h1>You’re invited to Early Access</h1><p>You’re joining BoM while we’re still building and growing the community, and your ratings will help shape the site.</p><p><a href="${activationUrl}" style="display:inline-block;background:#22f5a7;color:#07110d;padding:14px 20px;text-decoration:none;font-weight:700">Activate your invitation</a></p><p>This single-use invitation expires in 7 days.</p></div>`
    })
  });
  if (!response.ok) throw new Error("Email provider rejected the invitation.");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply({ ok: false, error: "Valid JSON is required." }, 400); }
  const action = body.action;
  const db = adminClient();

  if (action === "request_access") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!name || name.length > 120 || !validEmail(email)) return reply({ ok: false, error: "Please enter a valid name and email address." }, 422);
    await db.from("early_access_requests").insert({ name, email });
    return reply({ ok: true, message: genericRequestMessage });
  }

  const authorization = await requireAdminUser(request);
  if (!authorization.ok) return new Response(authorization.response.body, { status: authorization.response.status, headers: { ...cors, "Content-Type": "application/json" } });

  if (action === "list") {
    const [{ data: settings }, { data: requests }, { data: invitations }, { count: founders }] = await Promise.all([
      db.from("registration_settings").select("mode, early_access_started_at").single(),
      db.from("early_access_requests").select("id, name, email, requested_at, status").order("requested_at", { ascending: false }),
      db.from("early_access_invitations").select("id, email, status, created_at, sent_at, expires_at, accepted_at, request_id").order("created_at", { ascending: false }),
      db.from("profiles").select("id", { count: "exact", head: true }).eq("is_founding_member", true)
    ]);
    return reply({ ok: true, settings, requests: requests || [], invitations: invitations || [], foundingMembers: founders || 0 });
  }

  if (action === "set_mode") {
    if (body.mode !== "PUBLIC" && body.mode !== "INVITATION_ONLY") return reply({ ok: false, error: "Invalid registration mode." }, 422);
    const { error } = await db.rpc("admin_set_registration_mode", { p_mode: body.mode, p_admin_id: authorization.userId });
    if (error) return reply({ ok: false, error: "Registration mode could not be updated." }, 500);
    return reply({ ok: true });
  }

  if (action === "decline") {
    const { error } = await db.from("early_access_requests").update({ status: "DECLINED", reviewed_at: new Date().toISOString(), reviewed_by: authorization.userId }).eq("id", body.requestId).eq("status", "PENDING");
    return error ? reply({ ok: false, error: "Request could not be declined." }, 500) : reply({ ok: true });
  }

  if (action === "revoke") {
    const { error } = await db.from("early_access_invitations").update({ status: "REVOKED", revoked_at: new Date().toISOString() }).eq("id", body.invitationId).in("status", ["PENDING", "SENT"]);
    return error ? reply({ ok: false, error: "Invitation could not be revoked." }, 500) : reply({ ok: true });
  }

  if (action === "invite" || action === "approve") {
    let email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    let requestId: string | null = null;
    if (action === "approve") {
      const { data: accessRequest } = await db.from("early_access_requests").select("id, email, status").eq("id", body.requestId).eq("status", "PENDING").maybeSingle();
      if (!accessRequest) return reply({ ok: false, error: "Pending request not found." }, 404);
      email = accessRequest.email.toLowerCase(); requestId = accessRequest.id;
    }
    if (!validEmail(email)) return reply({ ok: false, error: "A valid email address is required." }, 422);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const { data: invitation, error } = await db.from("early_access_invitations").insert({ email, token_hash: await sha256(token), expires_at: expiresAt, request_id: requestId, created_by: authorization.userId }).select("id").single();
    if (error) return reply({ ok: false, error: "An active invitation already exists for this email." }, 409);
    try {
      await sendInvite(email, token);
      await db.from("early_access_invitations").update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", invitation.id);
      if (requestId) await db.from("early_access_requests").update({ status: "APPROVED", reviewed_at: new Date().toISOString(), reviewed_by: authorization.userId }).eq("id", requestId);
      return reply({ ok: true });
    } catch {
      return reply({ ok: false, error: "Invitation created, but the email could not be sent." }, 502);
    }
  }

  return reply({ ok: false, error: "Unsupported action." }, 422);
});
