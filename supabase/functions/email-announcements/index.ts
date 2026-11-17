import { createClient } from "npm:@supabase/supabase-js@2";
import { getAdminKey, requireAdminUser, requireAuthenticatedUser } from "../_shared/authorization.ts";
import { AUDIENCE, DEFAULT_MESSAGE, DEFAULT_SUBJECT, MARKETING_CONSENT_WORDING, authUserCanReceive, confirmationToken, parseUnsubscribeToken, renderEmail, sha256, unsubscribeToken, validDraft, verifyConfirmation } from "../_shared/email-announcement.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const siteUrl = () => (Deno.env.get("BOM_SITE_URL") || "https://thebankofmusic.com").replace(/\/$/, "");
const secret = () => Deno.env.get("BOM_UNSUBSCRIBE_SECRET") || "";
const bulkSendingEnabled = () => Deno.env.get("BOM_BULK_EMAIL_ENABLED") === "true";

function db() {
  const url = Deno.env.get("SUPABASE_URL") || "", key = getAdminKey();
  if (!url || !key) throw new Error("Missing Supabase server credentials.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function eligibleUsers(client: ReturnType<typeof db>) {
  const { data: preferences, error } = await client.from("marketing_email_preferences").select("user_id").eq("status", "OPTED_IN");
  if (error) throw error;
  const users = [] as Array<{ id: string; email: string }>;
  for (const preference of preferences || []) {
    const { data } = await client.auth.admin.getUserById(preference.user_id);
    const user = data?.user;
    if (authUserCanReceive(user)) users.push({ id: user!.id, email: user!.email! });
  }
  return users;
}

async function sendEmail(recipient: string, subject: string, message: string, token: string, idempotencyKey: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!apiKey) throw new Error("Email service is not configured.");
  const unsubscribeUrl = `${siteUrl()}/?unsubscribe=${encodeURIComponent(token)}`;
  const oneClickUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-announcements?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ from: "Bank of Music <hello@thebankofmusic.com>", to: [recipient], subject, text: `${message}\n\nUnsubscribe: ${unsubscribeUrl}`, html: renderEmail(subject, message, unsubscribeUrl), headers: { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }) });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof result.id !== "string") throw new Error(`provider_${response.status}`);
  return result.id;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405);
  let body: Record<string, unknown>;
  const oneClickToken = new URL(request.url).searchParams.get("token");
  if (oneClickToken) body = { action: "unsubscribe", token: oneClickToken };
  else try { body = await request.json(); } catch { return reply({ ok: false, error: "Valid JSON is required." }, 400); }
  const action = body.action;
  if (!secret()) return reply({ ok: false, error: "Email announcements are not configured." }, 503);
  const client = db();

  if (action === "unsubscribe") {
    const userId = await parseUnsubscribeToken(typeof body.token === "string" ? body.token : "", secret());
    if (!userId) return reply({ ok: false, error: "This unsubscribe link is invalid." }, 422);
    const { error } = await client.from("marketing_email_preferences").upsert({ user_id: userId, status: "UNSUBSCRIBED", unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    return error ? reply({ ok: false, error: "Your preference could not be saved." }, 500) : reply({ ok: true, message: "You have been unsubscribed from Bank of Music announcements." });
  }

  if (action === "get_preferences" || action === "update_preferences" || action === "dismiss_invitation") {
    const auth = await requireAuthenticatedUser(request);
    if (!auth.ok || !auth.userId) return auth.ok ? reply({ ok: false, error: "User identity unavailable." }, 500) : new Response(auth.response.body, { status: auth.response.status, headers: { ...cors, "Content-Type": "application/json" } });
    if (action === "get_preferences") {
      const { data } = await client.from("marketing_email_preferences").select("status").eq("user_id", auth.userId).maybeSingle();
      const { data: invitation } = await client.from("email_updates_invitations").select("dismissed_at, responded_at").eq("user_id", auth.userId).maybeSingle();
      return reply({ ok: true, subscribed: data?.status === "OPTED_IN", invitationPending: !data && !!invitation && !invitation.responded_at });
    }
    if (action === "dismiss_invitation") {
      const now = new Date().toISOString();
      const { error } = await client.from("email_updates_invitations").update({ dismissed_at: now, responded_at: now }).eq("user_id", auth.userId).is("responded_at", null);
      return error ? reply({ ok: false, error: "Your choice could not be saved." }, 500) : reply({ ok: true });
    }
    const subscribed = body.subscribed === true, now = new Date().toISOString();
    const preference = subscribed ? { user_id: auth.userId, status: "OPTED_IN", consented_at: now, consent_source: "ACCOUNT_PREFERENCES", consent_wording: MARKETING_CONSENT_WORDING, unsubscribed_at: null, updated_at: now } : { user_id: auth.userId, status: "UNSUBSCRIBED", unsubscribed_at: now, updated_at: now };
    const { error } = await client.from("marketing_email_preferences").upsert(preference, { onConflict: "user_id" });
    if (!error) await client.from("email_updates_invitations").update({ responded_at: now }).eq("user_id", auth.userId).is("responded_at", null);
    return error ? reply({ ok: false, error: "Your email preference could not be saved." }, 500) : reply({ ok: true, subscribed });
  }

  const auth = await requireAdminUser(request);
  if (!auth.ok || !auth.userId) return auth.ok ? reply({ ok: false, error: "Administrator identity unavailable." }, 500) : new Response(auth.response.body, { status: auth.response.status, headers: { ...cors, "Content-Type": "application/json" } });

  if (action === "summary") {
    const users = await eligibleUsers(client);
    const { data: history } = await client.from("email_announcements").select("id, subject, status, eligible_count, sent_count, failed_count, created_at, completed_at").order("created_at", { ascending: false }).limit(25);
    return reply({ ok: true, eligibleCount: users.length, bulkSendingEnabled: bulkSendingEnabled(), defaults: { audience: AUDIENCE, subject: DEFAULT_SUBJECT, message: DEFAULT_MESSAGE }, history: history || [] });
  }

  if (!validDraft(body.subject, body.message) || body.audience !== AUDIENCE) return reply({ ok: false, error: "A valid subject, message and audience are required." }, 422);
  const subject = (body.subject as string).trim(), message = (body.message as string).trim();
  const fingerprint = await sha256(`${AUDIENCE}\n${subject}\n${message}`);
  const users = await eligibleUsers(client);

  if (action === "prepare") return reply({ ok: true, eligibleCount: users.length, confirmationToken: await confirmationToken(fingerprint, users.length, secret()), previewHtml: renderEmail(subject, message, "#unsubscribe-preview") });

  if (action === "send_test") {
    const tenMinutesAgo = new Date(Date.now() - 600000).toISOString();
    const { count } = await client.from("email_announcement_test_sends").select("id", { head: true, count: "exact" }).eq("admin_user_id", auth.userId).gte("sent_at", tenMinutesAgo);
    if ((count || 0) >= 5) return reply({ ok: false, error: "Test email rate limit reached. Try again later." }, 429);
    const { data } = await client.auth.admin.getUserById(auth.userId);
    if (!data?.user?.email) return reply({ ok: false, error: "Administrator email address unavailable." }, 422);
    const id = await sendEmail(data.user.email, `[TEST] ${subject}`, message, await unsubscribeToken(auth.userId, secret()), `bom-test-${fingerprint}-${Math.floor(Date.now() / 600000)}`);
    await client.from("email_announcement_test_sends").insert({ admin_user_id: auth.userId, provider_message_id: id });
    return reply({ ok: true, id });
  }

  if (action !== "send") return reply({ ok: false, error: "Unsupported action." }, 422);
  if (!bulkSendingEnabled()) return reply({ ok: false, error: "Bulk email delivery is disabled pending final campaign approval." }, 403);
  if (!users.length) return reply({ ok: false, error: "There are no eligible recipients. No email was sent." }, 409);
  if (users.length > 500) return reply({ ok: false, error: "Audience exceeds the per-send safety limit of 500." }, 409);
  if (!await verifyConfirmation(String(body.confirmationToken || ""), fingerprint, users.length, secret())) return reply({ ok: false, error: "Recipient count or draft changed. Review and confirm again." }, 409);

  const { data: campaign, error: createError } = await client.from("email_announcements").insert({ fingerprint, audience: AUDIENCE, subject, message, eligible_count: users.length, created_by: auth.userId }).select("id").single();
  if (createError) return reply({ ok: false, error: createError.code === "23505" ? "This exact announcement has already been sent or is in progress." : "Announcement could not be created." }, createError.code === "23505" ? 409 : 500);
  let sent = 0, failed = 0;
  for (const user of users) {
    const { data: current } = await client.from("marketing_email_preferences").select("status").eq("user_id", user.id).maybeSingle();
    if (current?.status !== "OPTED_IN") { await client.from("email_announcement_deliveries").insert({ announcement_id: campaign.id, user_id: user.id, status: "SUPPRESSED" }); continue; }
    try {
      const providerId = await sendEmail(user.email, subject, message, await unsubscribeToken(user.id, secret()), `bom-${campaign.id}-${user.id}`);
      await client.from("email_announcement_deliveries").insert({ announcement_id: campaign.id, user_id: user.id, status: "SENT", provider_message_id: providerId }); sent += 1;
    } catch (error) {
      await client.from("email_announcement_deliveries").insert({ announcement_id: campaign.id, user_id: user.id, status: "FAILED", error_code: error instanceof Error ? error.message.slice(0, 80) : "provider_error" }); failed += 1;
    }
    await new Promise(resolve => setTimeout(resolve, 550));
  }
  const status = failed === 0 ? "SENT" : sent === 0 ? "FAILED" : "PARTIAL";
  await client.from("email_announcements").update({ status, sent_count: sent, failed_count: failed, completed_at: new Date().toISOString(), error_summary: failed ? `${failed} provider delivery request(s) failed` : null }).eq("id", campaign.id);
  return reply({ ok: true, announcementId: campaign.id, status, sentCount: sent, failedCount: failed });
});
