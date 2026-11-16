export const AUDIENCE = "MARKETING_OPT_IN";
export const MARKETING_CONSENT_WORDING = "Yes, email me occasional Bank of Music news, feature announcements and special releases. I can unsubscribe or change this at any time.";
export const BOND_SPECIAL_URL = "https://thebankofmusic.com/?special=bond";
export const DEFAULT_SUBJECT = "🎬 James Bond has arrived at Bank of Music!";
export const DEFAULT_MESSAGE = `Hi everyone,

We've been busy improving Bank of Music, and we'd love you to have another look!

The site has had a refresh, with better music discovery, recommendations and more ways to explore and rate your favourite songs and albums.

🎬 NEW: The James Bond Special

To celebrate the announcement of the next James Bond, we've launched a special collection of Bond themes from across the films. Explore the collection, rate your favourites and see which themes come out on top.

There's plenty more on the way, too!

Visit https://thebankofmusic.com

Thanks for being part of Bank of Music. Every rating helps make the site better!

Craig
Bank of Music`;

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}

export function validDraft(subject: unknown, message: unknown) {
  return typeof subject === "string" && subject.trim().length > 0 && subject.length <= 200 &&
    typeof message === "string" && message.trim().length > 0 && message.length <= 20000;
}

export function authUserCanReceive(user: { email?: string; email_confirmed_at?: string | null; is_anonymous?: boolean; deleted_at?: string | null } | null | undefined) {
  return Boolean(user?.email && user.email_confirmed_at && !user.is_anonymous && !user.deleted_at);
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function confirmationToken(fingerprint: string, count: number, secret: string, bucket = Math.floor(Date.now() / 600000)) {
  return `${bucket}.${await hmac(`${fingerprint}:${count}:${bucket}`, secret)}`;
}

export async function verifyConfirmation(token: string, fingerprint: string, count: number, secret: string) {
  const [rawBucket, supplied] = token.split(".");
  const bucket = Number(rawBucket);
  const current = Math.floor(Date.now() / 600000);
  if (!Number.isSafeInteger(bucket) || Math.abs(current - bucket) > 1 || !supplied) return false;
  return constantTimeEqual(supplied, await hmac(`${fingerprint}:${count}:${bucket}`, secret));
}

export async function unsubscribeToken(userId: string, secret: string) {
  return `${userId}.${await hmac(`unsubscribe:${userId}`, secret)}`;
}

export async function parseUnsubscribeToken(token: string, secret: string) {
  const separator = token.indexOf(".");
  const userId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !signature) return null;
  return constantTimeEqual(signature, await hmac(`unsubscribe:${userId}`, secret)) ? userId : null;
}

export function renderEmail(subject: string, message: string, unsubscribeUrl: string) {
  const linked = escapeHtml(message).replace(/https:\/\/thebankofmusic\.com\/?/g,
    '<a href="https://thebankofmusic.com" style="color:#d8d8d8">thebankofmusic.com</a>');
  const body = linked.split(/\n{2,}/).map(block => `<p style="margin:0 0 18px;line-height:1.65">${block.replaceAll("\n", "<br>")}</p>`).join("");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><style>@media(max-width:640px){.shell{width:100%!important}.pad{padding:24px 20px!important}.barrel{width:210px!important;height:210px!important}.title{font-size:30px!important}.cta{display:block!important;text-align:center!important}}</style></head><body style="margin:0;background:#050505;color:#f4f4f4;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505"><tr><td align="center" style="padding:24px 10px"><table role="presentation" width="640" class="shell" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#0a0a0a;border:1px solid #555"><tr><td align="center" style="height:6px;background:#b30816;font-size:0">&nbsp;</td></tr><tr><td align="center" class="pad" style="padding:28px 30px 18px"><img src="https://thebankofmusic.com/logo.jpeg" width="150" height="150" alt="Bank of Music" style="display:block;width:150px;height:150px;border:0;border-radius:50%;object-fit:cover"><p style="margin:18px 0 0;color:#b9b9b9;font-size:11px;letter-spacing:4px;text-transform:uppercase">The Bank of Music presents</p></td></tr><tr><td align="center" class="pad" style="padding:10px 30px 30px"><table role="presentation" class="barrel" width="280" height="280" cellspacing="0" cellpadding="0" style="width:280px;height:280px;border-radius:50%;border:12px solid #a9a9a9;background:#b30816;background-image:repeating-conic-gradient(from 4deg,#d9d9d9 0deg 8deg,#181818 8deg 18deg);box-shadow:inset 0 0 0 14px #050505"><tr><td align="center" valign="middle"><table role="presentation" width="184" height="184" cellspacing="0" cellpadding="0" style="width:184px;height:184px;border-radius:50%;background:#070707;border:5px solid #b30816"><tr><td align="center" valign="middle" style="color:#fff;font-size:58px;font-weight:700;letter-spacing:-3px">007</td></tr></table></td></tr></table><h1 class="title" style="font-size:38px;line-height:1.12;margin:30px 0 14px;color:#fff;text-transform:uppercase;letter-spacing:1px">${escapeHtml(subject)}</h1><div style="width:72px;height:3px;background:#b30816;margin:0 auto 26px"></div></td></tr><tr><td class="pad" style="padding:0 38px 34px;color:#d5d5d5;font-size:16px">${body}<p style="margin:30px 0 12px;text-align:center"><a class="cta" href="${BOND_SPECIAL_URL}" style="display:inline-block;background:#b30816;color:#fff;border:1px solid #e1e1e1;padding:16px 26px;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Enter the Bond Special&nbsp; →</a></p></td></tr><tr><td style="padding:22px 30px;border-top:1px solid #555;background:#111;color:#aaa;font-size:12px;line-height:1.6;text-align:center">You received this because you explicitly opted in to Bank of Music marketing emails.<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#ddd;text-decoration:underline">Unsubscribe</a> or change your email preferences from your account menu at any time.</td></tr></table></td></tr></table></body></html>`;
}
