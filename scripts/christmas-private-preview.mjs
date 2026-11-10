#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const port = Number(process.env.BOM_PREVIEW_PORT || 4187);
const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("BOM_PREVIEW_PORT must be an integer between 1024 and 65535.");
}

const previewBootstrap = `(() => {
  "use strict";
  const productionHost = "xevxjggauscyrvvtmftx.supabase.co";
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    const method = String(init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    if (url.hostname === productionHost && method !== "GET" && method !== "HEAD") {
      return Promise.reject(new Error("Private preview is read-only; production writes are blocked."));
    }
    return nativeFetch(input, init);
  };
  window.__BOM_CHRISTMAS_PRIVATE_PREVIEW__ = Object.freeze({ readOnly: true, localOnly: true });

  const style = document.createElement("style");
  style.textContent = \`
    .bom-preview-badge{position:fixed;z-index:2147483647;right:12px;bottom:12px;padding:9px 12px;border:1px solid rgba(255,255,255,.35);border-radius:999px;background:#10182a;color:#fff;font:700 11px/1.2 Manrope,system-ui,sans-serif;letter-spacing:.09em;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none}
    .bom-xmas-preview-notice{margin:0;padding:11px 18px;background:#15213a;color:#e8f1ff;border-bottom:1px solid rgba(255,255,255,.15);font:700 12px/1.45 Manrope,system-ui,sans-serif;text-align:center;letter-spacing:.035em}
  \`;
  document.head.append(style);

  function addBadge() {
    if (document.querySelector(".bom-preview-badge")) return;
    const badge = document.createElement("div");
    badge.className = "bom-preview-badge";
    badge.textContent = "PRIVATE PREVIEW · READ ONLY";
    document.body.append(badge);
  }

  function addBanner() {
    const discover = document.querySelector(".bom-v1-discover");
    if (!discover || discover.querySelector("[data-bom-christmas-banner]")) return;
    const banner = document.createElement("section");
    banner.className = "bom-christmas-banner";
    banner.dataset.bomChristmasBanner = "";
    banner.setAttribute("aria-labelledby", "bomChristmasBannerTitle");
    banner.innerHTML = '<div aria-hidden="true">✦</div><div><p>THE BANK OF MUSIC PRESENTS</p><h2 id="bomChristmasBannerTitle">THE CHRISTMAS TOP 100</h2><span>Private read-only preview · ratings stay on this device.</span></div><button type="button" data-bom-action="christmas-special">OPEN THE CHRISTMAS SPECIAL <span aria-hidden="true">→</span></button>';
    (discover.querySelector(".bom-v1-discover-intro") || discover.firstElementChild)?.after(banner);
  }

  function addDialogNotice() {
    const dialog = document.getElementById("bomChristmasSpecial");
    if (!dialog || dialog.querySelector(".bom-xmas-preview-notice") || !dialog.querySelector(".bom-xmas-hero")) return;
    const notice = document.createElement("p");
    notice.className = "bom-xmas-preview-notice";
    notice.textContent = "Private preview: rating changes are simulated locally and never sent to production.";
    dialog.querySelector(".bom-xmas-hero").after(notice);
  }

  let christmasAssetsPromise = null;
  function openChristmasPreview() {
    if (!christmasAssetsPromise) {
      christmasAssetsPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-bom-christmas-style]')) {
          const stylesheet = document.createElement("link");
          stylesheet.rel = "stylesheet";
          stylesheet.href = "bom-christmas.css?v=4";
          stylesheet.dataset.bomChristmasStyle = "1";
          document.head.append(stylesheet);
        }
        if (window.BOMChristmasUI?.open) { resolve(); return; }
        const script = document.createElement("script");
        script.src = "bom-christmas.js?v=3";
        script.onload = resolve;
        script.onerror = () => reject(new Error("The Christmas preview could not load."));
        document.body.append(script);
      });
    }
    return christmasAssetsPromise.then(() => window.BOMChristmasUI?.open?.());
  }

  document.addEventListener("click", event => {
    if (event.target.closest?.('[data-bom-action="christmas-special"]')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void openChristmasPreview();
      return;
    }
    const button = event.target.closest?.("[data-christmas-rate]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const card = button.closest("[data-christmas-entry]");
    const group = button.closest("[data-christmas-rating-group]");
    const value = Number(button.dataset.christmasRate);
    group.querySelectorAll("button").forEach(control => control.setAttribute("aria-pressed", String(control === button)));
    group.querySelector("legend").textContent = \`Preview rating · \${value} / 10\`;
    card.dataset.personalRated = "true";
    card.querySelector("[role=status]").textContent = "Preview only · not saved";
  }, true);

  new MutationObserver(() => { addBadge(); addBanner(); addDialogNotice(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("DOMContentLoaded", () => { addBadge(); addBanner(); });
})();`;

function replaceOnce(source, expected, replacement, file) {
  const first = source.indexOf(expected);
  if (first < 0 || source.indexOf(expected, first + expected.length) >= 0) {
    throw new Error(`Private-preview transform for ${file} is no longer exact.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + expected.length);
}

function transform(relativePath, source) {
  if (relativePath === "index.html") {
    return replaceOnce(
      source,
      '<script src="config.js?v=3"></script>',
      '<script src="config.js?v=3"></script>\n <script src="/__christmas-preview.js?v=4"></script>',
      relativePath
    );
  }
  if (relativePath === "config.js") {
    return replaceOnce(
      source,
      '  isEligible(now = new Date()) {\n    if (window.BOM_CHRISTMAS_FEATURE?.emergencyDisabled === true) return false;\n    return new Intl.DateTimeFormat("en-GB", { month: "2-digit", timeZone: "Europe/London" }).format(now) === "12";\n  }',
      '  isEligible() { return true; }',
      relativePath
    );
  }
  if (relativePath === "app.js") {
    let result = replaceOnce(
      source,
      'async function openChristmasSpecial() {\n  if (!isChristmasFeatureEnabled() || !currentUser) return false;',
      'async function openChristmasSpecial() {\n  if (!isChristmasFeatureEnabled() && !window.__BOM_CHRISTMAS_PRIVATE_PREVIEW__?.localOnly) return false;',
      relativePath
    );
    result = replaceOnce(
      result,
      'async function loadChristmasMusicData(manifest) {\n  if (!isChristmasFeatureEnabled() || !currentUser) throw new Error("The Christmas Special is unavailable.");',
      'async function loadChristmasMusicData(manifest) {\n  if (!isChristmasFeatureEnabled() && !window.__BOM_CHRISTMAS_PRIVATE_PREVIEW__?.localOnly) throw new Error("The Christmas Special is unavailable.");',
      relativePath
    );
    result = replaceOnce(
      result,
      'const personal = ratings.filter(row => row.user_id === currentUser.id);',
      'const personal = currentUser ? ratings.filter(row => row.user_id === currentUser.id) : [];',
      relativePath
    );
    return result;
  }
  return source;
}

const mime = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".jpeg", "image/jpeg"], [".jpg", "image/jpeg"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".ttf", "font/ttf"], [".woff2", "font/woff2"]
]);

const server = createServer(async (request, response) => {
  try {
    if (!allowedHosts.has(String(request.headers.host || ""))) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Private preview is available only on this computer.\n");
      return;
    }
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname === "/__christmas-preview.js") {
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "X-BOM-Private-Preview": "read-only" });
      response.end(previewBootstrap);
      return;
    }
    const relativePath = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`)) throw new Error("Invalid preview path.");
    if (!(await stat(absolutePath)).isFile()) throw new Error("Not found.");
    const extension = path.extname(absolutePath).toLowerCase();
    const raw = await readFile(absolutePath);
    const body = [".html", ".js"].includes(extension) ? transform(relativePath, raw.toString("utf8")) : raw;
    response.writeHead(200, {
      "Content-Type": mime.get(extension) || "application/octet-stream",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-BOM-Private-Preview": "read-only"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Not found.\n");
  }
});

server.listen(port, host, () => {
  console.log(`Bank of Music Christmas private preview: http://${host}:${port}/`);
  console.log("Localhost only · read-only production catalogue · production writes blocked");
});
