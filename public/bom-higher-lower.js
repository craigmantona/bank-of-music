(function initialiseHigherLower() {
  "use strict";

  const config = () => window.BOM_HIGHER_LOWER_FEATURE || {};
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const state = { mode: "songs", pool: [], pair: null, streak: 0, best: 0, answered: false, seen: new Set() };
  let root = null;

  function bestKey() { return `bom-higher-lower-best:${state.mode}`; }
  function loadBest() {
    try { state.best = Math.max(0, Number(localStorage.getItem(bestKey())) || 0); }
    catch { state.best = 0; }
  }
  function saveBest() {
    try { localStorage.setItem(bestKey(), String(state.best)); } catch { /* Storage is optional. */ }
  }
  function comparisonKey(left, right) { return [left.itemId, right.itemId].sort((a, b) => a - b).join(":"); }
  function nextPair() {
    const minimumGap = Math.max(0.1, Number(config().minimumRatingGap) || 0.2);
    const candidates = [];
    for (let left = 0; left < state.pool.length; left += 1) {
      for (let right = left + 1; right < state.pool.length; right += 1) {
        const a = state.pool[left], b = state.pool[right];
        const key = comparisonKey(a, b);
        if (!state.seen.has(key) && Math.abs(a.rating - b.rating) >= minimumGap) candidates.push([a, b, key]);
      }
    }
    if (!candidates.length) return null;
    const [a, b, key] = candidates[Math.floor(Math.random() * candidates.length)];
    state.seen.add(key);
    return Math.random() < 0.5 ? { left: a, right: b } : { left: b, right: a };
  }
  function artwork(item) {
    return `<div class="bom-hl-art"><img src="${escapeHtml(item.artworkUrl)}" alt="${escapeHtml(item.title)} artwork" loading="eager" decoding="async"></div>`;
  }
  function card(item, side) {
    const revealed = state.answered;
    return `<article class="bom-hl-card is-${side}">${artwork(item)}<div class="bom-hl-card-copy"><p>${state.mode === "songs" ? "Song" : "Album"}</p><h2>${escapeHtml(item.title)}</h2><span>${escapeHtml(item.artist)}</span><strong class="bom-hl-score${revealed ? " is-revealed" : ""}">${revealed ? `${item.rating.toFixed(1)} / 10` : "? / 10"}</strong>${revealed ? `<small>${item.ratingCount.toLocaleString()} independent rater${item.ratingCount === 1 ? "" : "s"}</small><button type="button" data-hl-rate="${side}">Rate on BOM →</button>` : ""}</div></article>`;
  }
  function render(message = "") {
    if (!root) return;
    const pair = state.pair;
    root.innerHTML = `<main class="bom-hl" aria-labelledby="bomHlTitle"><header class="bom-hl-header"><button type="button" data-hl-close>← Discover</button><div><p>THE BANK OF MUSIC</p><h1 id="bomHlTitle">Higher or Lower</h1><span>Which has the higher community rating?</span></div><div class="bom-hl-stats"><span>Streak <strong>${state.streak}</strong></span><span>Best <strong>${state.best}</strong></span></div></header><div class="bom-hl-modes" role="group" aria-label="Game mode"><button type="button" data-hl-mode="songs" aria-pressed="${state.mode === "songs"}">Songs</button><button type="button" data-hl-mode="albums" aria-pressed="${state.mode === "albums"}">Albums</button></div>${pair ? `<section class="bom-hl-board">${card(pair.left, "left")}<div class="bom-hl-versus" aria-hidden="true">VS</div>${card(pair.right, "right")}</section><section class="bom-hl-actions" aria-live="polite">${state.answered ? `<p class="${message.startsWith("Correct") ? "is-win" : "is-loss"}">${escapeHtml(message)}</p><button type="button" data-hl-next>Next round →</button>` : `<p>Is <strong>${escapeHtml(pair.right.title)}</strong> rated higher or lower than <strong>${escapeHtml(pair.left.title)}</strong>?</p><div><button type="button" data-hl-guess="higher">↑ Higher</button><button type="button" data-hl-guess="lower">↓ Lower</button></div>`}</section>` : `<section class="bom-hl-empty"><h2>No more fair comparisons</h2><p>This session has used every eligible pairing. Switch mode or come back for another run.</p></section>`}<footer>Scores are frozen when each round is created · Minimum ${Number(config().minimumRaters) || 3} independent raters</footer></main>`;
  }
  function normalise(row) {
    return { itemId: Number(row.item_id), title: row.title, artist: row.artist, artworkUrl: row.artwork_url, rating: Number(row.average_rating), ratingCount: Number(row.rating_count) };
  }
  async function start(mode = state.mode) {
    state.mode = mode; state.streak = 0; state.answered = false; state.seen.clear(); loadBest();
    root.innerHTML = '<div class="bom-hl-loading" role="status">Building a fair comparison…</div>';
    try {
      state.pool = (await window.BOMPresentationBridge.loadHigherLowerPool(mode)).map(normalise).filter(item => item.itemId && Number.isFinite(item.rating) && item.artworkUrl);
      state.pair = nextPair(); render();
    } catch {
      root.innerHTML = '<div class="bom-hl-loading" role="alert">The game could not load. Please try again later.</div>';
    }
  }
  function guess(choice) {
    if (state.answered || !state.pair) return;
    const difference = state.pair.right.rating - state.pair.left.rating;
    const correct = choice === (difference > 0 ? "higher" : "lower");
    state.answered = true;
    state.streak = correct ? state.streak + 1 : 0;
    if (state.streak > state.best) { state.best = state.streak; saveBest(); }
    render(correct ? "Correct — keep the streak alive." : "Not this time — your streak starts again.");
  }
  function openRate(side) {
    const item = state.pair?.[side];
    if (!item) return;
    window.BOMPresentationBridge.openHigherLowerItem(state.mode, item.itemId);
  }
  document.addEventListener("click", event => {
    if (!root?.contains(event.target)) return;
    const target = event.target.closest("button"); if (!target) return;
    if (target.dataset.hlGuess) guess(target.dataset.hlGuess);
    if (target.hasAttribute("data-hl-next")) { state.answered = false; state.pair = nextPair(); render(); }
    if (target.dataset.hlMode && target.dataset.hlMode !== state.mode) void start(target.dataset.hlMode);
    if (target.dataset.hlRate) openRate(target.dataset.hlRate);
    if (target.hasAttribute("data-hl-close")) window.BOMPresentationBridge.showDiscover();
  });
  window.BOMHigherLowerUI = Object.freeze({ open(container) { root = container; return start(); } });
})();

