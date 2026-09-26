(function initialiseBOMTurnstile(global) {
  "use strict";

  const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const SCRIPT_ID = "bomTurnstileScript";

  function create({ siteKey, document, window, turnstileApi } = {}) {
    const cleanSiteKey = String(siteKey || "").trim();
    const container = document?.getElementById("turnstileContainer");
    const widget = document?.getElementById("turnstileWidget");
    const message = document?.getElementById("turnstileMessage");
    const enabled = Boolean(cleanSiteKey);
    let token = "";
    let widgetId = null;
    let api = turnstileApi || window?.turnstile || null;

    function setMessage(text) {
      if (message) message.textContent = text || "";
    }

    function render() {
      api = api || window?.turnstile || null;
      if (!enabled || !api || !widget || widgetId !== null) return;
      widgetId = api.render(widget, {
        sitekey: cleanSiteKey,
        theme: "dark",
        size: "flexible",
        appearance: "interaction-only",
        action: "bom_auth",
        callback(response) {
          token = String(response || "");
          setMessage("");
        },
        "expired-callback"() {
          token = "";
          setMessage("Security check expired. Please try it again.");
        },
        "timeout-callback"() {
          token = "";
          setMessage("Security check timed out. Please try it again.");
        },
        "error-callback"() {
          token = "";
          setMessage("Security check is unavailable. Please try again.");
        }
      });
    }

    function load() {
      if (!enabled) return Promise.resolve();
      container?.classList.remove("hidden");
      if (api || window?.turnstile) {
        render();
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const existing = document?.getElementById(SCRIPT_ID);
        const script = existing || document?.createElement("script");
        if (!script) return resolve();
        const finish = () => {
          api = window?.turnstile || null;
          render();
          resolve();
        };
        script.addEventListener("load", finish, { once: true });
        script.addEventListener("error", () => {
          setMessage("Security check could not load. Please refresh and try again.");
          resolve();
        }, { once: true });
        if (!existing) {
          script.id = SCRIPT_ID;
          script.src = SCRIPT_URL;
          script.async = true;
          script.defer = true;
          document.head.appendChild(script);
        }
      });
    }

    const ready = load();

    async function getToken() {
      if (!enabled) return null;
      await ready;
      if (token) return token;
      const error = new Error("Complete the security check before continuing.");
      error.isCaptchaRequired = true;
      throw error;
    }

    function reset() {
      token = "";
      setMessage("");
      api = api || window?.turnstile || null;
      if (api && widgetId !== null) api.reset(widgetId);
      else render();
    }

    if (!enabled) container?.classList.add("hidden");

    return Object.freeze({
      isEnabled: () => enabled,
      getToken,
      reset
    });
  }

  global.BOMTurnstile = Object.freeze({ create, SCRIPT_URL });
})(window);
