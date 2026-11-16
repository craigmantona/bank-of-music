import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const rootScript = readFileSync(new URL("../bom-email-announcements.js", import.meta.url), "utf8");
const publicScript = readFileSync(new URL("../public/bom-email-announcements.js", import.meta.url), "utf8");
const rootHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const publicHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const functionSource = readFileSync(new URL("../supabase/functions/email-announcements/index.ts", import.meta.url), "utf8");
const sharedSource = readFileSync(new URL("../supabase/functions/_shared/email-announcement.ts", import.meta.url), "utf8");
const previewHtml = readFileSync(new URL("../outputs/bond-email-preview.html", import.meta.url), "utf8");

test("email announcement assets stay in the Cloudflare public output", () => {
  assert.equal(publicScript, rootScript);
  assert.match(rootHtml, /id="emailAnnouncementsAdmin"/);
  assert.match(rootHtml, /bom-email-announcements\.js\?v=1[\s\S]*app\.js/);
});

test("browser code receives counts and history but no email addresses or secrets", () => {
  assert.doesNotMatch(rootScript, /RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY|recipient\.email/);
  assert.match(functionSource, /eligibleCount: users\.length/);
  assert.match(functionSource, /select\("id, subject, status, eligible_count, sent_count, failed_count, created_at, completed_at"\)/);
});

test("bulk sending stays disabled until the server-side release switch is enabled", () => {
  assert.match(rootScript, /data-email-action="send" disabled/);
  assert.match(rootScript, /!state\.summary\.bulkSendingEnabled/);
  assert.match(functionSource, /BOM_BULK_EMAIL_ENABLED/);
  assert.match(functionSource, /Bulk email delivery is disabled pending final campaign approval/);
});

test("prepared James Bond announcement and compliance footer are present", () => {
  assert.match(sharedSource, /James Bond has arrived at Bank of Music/);
  assert.match(sharedSource, /better music discovery, recommendations/);
  assert.match(sharedSource, /special collection of Bond themes/);
  assert.match(sharedSource, /List-Unsubscribe|Unsubscribe/);
  assert.match(functionSource, /List-Unsubscribe-Post/);
  assert.match(sharedSource, /https:\/\/thebankofmusic\.com\/logo\.jpeg/);
  assert.match(sharedSource, /Enter the Bond Special/);
  assert.match(sharedSource, /repeating-conic-gradient/);
  assert.match(previewHtml, /https:\/\/thebankofmusic\.com\/logo\.jpeg/);
  assert.match(previewHtml, /https:\/\/thebankofmusic\.com\/\?special=bond/);
  assert.match(previewHtml, /#unsubscribe-preview/);
  assert.doesNotMatch(previewHtml, /Henry Cavill|Aaron Taylor-Johnson|casting rumou?r/i);
});

test("signup marketing consent is separate, optional and unticked", () => {
  for (const html of [rootHtml, publicHtml]) {
    assert.match(html, /id="marketingEmailConsent" type="checkbox"/);
    assert.doesNotMatch(html, /id="marketingEmailConsent"[^>]*checked/);
  }
  assert.match(appSource, /marketing_email_consent: marketingEmailConsentInput\?\.checked === true/);
});
