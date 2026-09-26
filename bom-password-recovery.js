(function initialiseBOMPasswordRecovery(global) {
  "use strict";

  const STORAGE_KEY = "bom_password_recovery_user_id";
  const PENDING_VALUE = "pending";
  const MINIMUM_PASSWORD_LENGTH = 6;

  function hasRecoveryMarker(location) {
    const search = new URLSearchParams(location.search || "");
    const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    return search.get("password-recovery") === "1" || hash.get("type") === "recovery";
  }

  function create({ auth, document, window, onExit } = {}) {
    const card = document?.getElementById("passwordRecoveryCard");
    const form = document?.getElementById("passwordRecoveryForm");
    const passwordInput = document?.getElementById("newPassword");
    const confirmInput = document?.getElementById("confirmNewPassword");
    const submitButton = document?.getElementById("setNewPasswordBtn");
    const continueButton = document?.getElementById("passwordRecoveryContinueBtn");
    const message = document?.getElementById("passwordRecoveryMessage");
    let active = false;

    function readStoredState() {
      try { return window.sessionStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
    }

    function storeState(value) {
      try {
        if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
        else window.sessionStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
    }

    function setMessage(text, isError = false) {
      if (!message) return;
      message.textContent = text || "";
      message.classList.toggle("error", Boolean(isError));
    }

    function render() {
      if (card) card.classList.toggle("hidden", !active);
      document?.body?.classList.toggle("bom-password-recovery-active", active);
    }

    function activate(session) {
      active = true;
      storeState(session?.user?.id || readStoredState() || PENDING_VALUE);
      render();
      window.setTimeout?.(() => passwordInput?.focus(), 0);
      return true;
    }

    function clear({ notify = true } = {}) {
      active = false;
      storeState(null);
      if (passwordInput) passwordInput.value = "";
      if (confirmInput) confirmInput.value = "";
      render();
      if (notify) onExit?.();
    }

    function reconcileSession(session) {
      const storedState = readStoredState();
      if (!session) {
        if (!hasRecoveryMarker(window.location)) storeState(null);
        active = false;
        render();
        return false;
      }

      if (hasRecoveryMarker(window.location) || storedState === PENDING_VALUE || storedState === session.user?.id) {
        return activate(session);
      }

      active = false;
      render();
      return false;
    }

    function handleAuthEvent(event, session) {
      if (event === "PASSWORD_RECOVERY") return activate(session);
      if (active) return true;
      return reconcileSession(session);
    }

    async function submit(event) {
      event?.preventDefault?.();
      if (!active || submitButton?.disabled) return;

      const password = passwordInput?.value || "";
      const confirmation = confirmInput?.value || "";
      if (password.length < MINIMUM_PASSWORD_LENGTH) {
        setMessage(`Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`, true);
        return;
      }
      if (password !== confirmation) {
        setMessage("Passwords do not match.", true);
        return;
      }

      submitButton.disabled = true;
      submitButton.textContent = "Updating password…";
      setMessage("");
      try {
        const { error } = await auth.updateUser({ password });
        if (error) {
          setMessage(error.message || "Password could not be updated. Please try again.", true);
          return;
        }

        storeState(null);
        if (form) form.classList.add("hidden");
        if (continueButton) continueButton.classList.remove("hidden");
        setMessage("Your password has been updated successfully.");
      } catch (_) {
        setMessage("Password could not be updated. Please try again.", true);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Set new password";
      }
    }

    function continueToApp() {
      if (form) form.classList.remove("hidden");
      if (continueButton) continueButton.classList.add("hidden");
      setMessage("");
      const url = new URL(window.location.href);
      url.searchParams.delete("password-recovery");
      window.history?.replaceState?.({}, "", url.pathname + url.search + url.hash);
      clear();
    }

    if (hasRecoveryMarker(window.location)) {
      active = true;
      storeState(PENDING_VALUE);
      render();
    }
    form?.addEventListener("submit", submit);
    continueButton?.addEventListener("click", continueToApp);

    return Object.freeze({
      isActive: () => active,
      activate,
      clear,
      reconcileSession,
      handleAuthEvent,
      submit,
      continueToApp
    });
  }

  global.BOMPasswordRecovery = Object.freeze({ create, MINIMUM_PASSWORD_LENGTH });
})(window);
