import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [source, app, config, html] = await Promise.all([
  readFile(new URL("../bom-turnstile.js", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../config.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

function element(hidden = true) {
  const classes = new Set(hidden ? ["hidden"] : []);
  return {
    textContent: "",
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    }
  };
}

function setup({ siteKey = "", api = null } = {}) {
  const elements = {
    turnstileContainer: element(),
    turnstileWidget: element(false),
    turnstileMessage: element(false)
  };
  const window = { turnstile: api };
  window.window = window;
  const document = {
    getElementById: id => elements[id] || null,
    head: { appendChild() { throw new Error("script loading was not expected in this test"); } }
  };
  const context = vm.createContext({ URLSearchParams, window });
  vm.runInContext(source, context);
  const controller = window.BOMTurnstile.create({
    siteKey,
    document,
    window,
    turnstileApi: api
  });
  return { controller, elements };
}

test("empty Site Key keeps CAPTCHA disabled and existing auth unaffected", async () => {
  const { controller, elements } = setup();
  assert.equal(controller.isEnabled(), false);
  assert.equal(await controller.getToken(), null);
  assert.equal(elements.turnstileContainer.classList.contains("hidden"), true);
});

test("Managed Turnstile token is fresh, single-use and reset after an auth attempt", async () => {
  let options;
  const resets = [];
  const api = {
    render(_element, suppliedOptions) {
      options = suppliedOptions;
      return "widget-1";
    },
    reset(widgetId) { resets.push(widgetId); }
  };
  const { controller, elements } = setup({ siteKey: "public-site-key", api });
  assert.equal(controller.isEnabled(), true);
  assert.equal(elements.turnstileContainer.classList.contains("hidden"), false);
  assert.equal(options.appearance, "interaction-only");
  assert.equal(options.action, "bom_auth");

  options.callback("fresh-token");
  assert.equal(await controller.getToken(), "fresh-token");
  controller.reset();
  assert.deepEqual(resets, ["widget-1"]);
  await assert.rejects(controller.getToken(), /Complete the security check/);
});

test("expired and failed challenges discard tokens without exposing details", async () => {
  let options;
  const api = { render(_element, value) { options = value; return "widget-2"; }, reset() {} };
  const { controller, elements } = setup({ siteKey: "public-site-key", api });
  options.callback("soon-expired-token");
  options["expired-callback"]();
  await assert.rejects(controller.getToken(), /Complete the security check/);
  assert.match(elements.turnstileMessage.textContent, /expired/i);
  options["error-callback"]("internal-error-code");
  assert.doesNotMatch(elements.turnstileMessage.textContent, /internal-error-code/);
});

test("all protected Supabase auth calls receive captchaToken options", () => {
  assert.match(app, /auth\.signUp\(\{[\s\S]*?options: \{[\s\S]*?captchaToken/);
  assert.match(app, /auth\.signInWithPassword\(\{[\s\S]*?options: \{ captchaToken \}/);
  assert.match(app, /auth\.resetPasswordForEmail\(email, \{[\s\S]*?captchaToken/);
  assert.match(app, /authCaptcha\?\.reset\(\)/);
});

test("client integration contains only the configured public Site Key", () => {
  assert.match(config, /Public Cloudflare Turnstile Site Key only/);
  assert.match(config, /window\.TURNSTILE_SITE_KEY = "0x[^"]+"/);
  assert.doesNotMatch(`${source}\n${app}\n${config}`, /TURNSTILE_SECRET|secret.?key/i);
  assert.match(source, /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(html, /bom-turnstile\.js\?v=1/);
});
