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
    let unavailableMessage = "";

    function setMessage(text) {
      if (message) message.textContent = text || "";
    }

    function render() {
      api = api || window?.turnstile || null;
      if (!enabled || !api || !widget || widgetId !== null) return;
      setMessage("Complete the security check to continue.");
      try {
        widgetId = api.render(widget, {
          sitekey: cleanSiteKey,
          theme: "dark",
          size: "flexible",
          appearance: "always",
          execution: "render",
          action: "bom_auth",
          callback(response) {
            token = String(response || "");
            unavailableMessage = "";
            setMessage("");
          },
          "expired-callback"() {
            token = "";
            setMessage("Security check expired. Please complete it again.");
          },
          "timeout-callback"() {
            token = "";
            setMessage("Security check timed out. Please complete it again.");
          },
          "unsupported-callback"() {
            token = "";
            unavailableMessage = "This browser cannot run the security check. Please use a supported browser.";
            setMessage(unavailableMessage);
          },
          "error-callback"() {
            token = "";
            unavailableMessage = "Security check is unavailable. Please refresh and try again.";
            setMessage(unavailableMessage);
          }
        });
      } catch {
        unavailableMessage = "Security check could not initialise. Please refresh and try again.";
        setMessage(unavailableMessage);
      }
    }

    function load() {
      if (!enabled) return Promise.resolve();
      container?.classList.remove("hidden");
      setMessage("Loading security check…");
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
          unavailableMessage = "Security check could not load. Please refresh and try again.";
          setMessage(unavailableMessage);
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
      const error = new Error(
        unavailableMessage || "Complete the security check before continuing."
      );
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
