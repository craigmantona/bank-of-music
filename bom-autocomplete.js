(function () {
  "use strict";
  const normalise = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const escape = (value) => String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function buildCatalogue(albums, songs, artwork, artistArtwork = () => "") {
    const visible = albums.filter((row) => !row.is_deleted);
    const hiddenAlbums = new Set(albums.filter((row) => row.is_deleted).map((row) => String(row.id)));
    const byId = new Map(visible.map((row) => [String(row.id), row]));
    const artists = new Map();
    const items = [];
    function add(row, kind, album) {
      const artist = row.artist?.trim();
      if (artist && !artists.has(normalise(artist))) artists.set(normalise(artist), { kind: "Artist", title: artist, secondary: "", artworkUrl: artistArtwork(artist) });
      items.push({ kind, title: row.title, secondary: [artist, kind === "Track" && album?.title].filter(Boolean).join(" · "), artist, artworkUrl: album ? artwork(album) : "", row, album });
    }
    visible.forEach((row) => add(row, "Album", row));
    songs.filter((row) => !row.is_deleted && (!row.album_id || !hiddenAlbums.has(String(row.album_id)))).forEach((row) => add(row, "Track", byId.get(String(row.album_id))));
    return [...artists.values(), ...items].map((item) => ({ ...item, key: normalise(item.title), artistKey: normalise(item.artist) }));
  }
  // Bounded edit distance, including a single adjacent transposition.
  function near(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    if (i === Math.min(a.length, b.length)) return true;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function rank(items, query, limit = 7) {
    const q = normalise(query);
    if (q.length < 2) return { items: [], more: false };
    const kindOrder = { Artist: 0, Album: 1, Track: 2 };
    const scored = items.map((item) => {
      const title = item.key;
      let score = title === q ? 400 : title.startsWith(q) ? 300 : title.includes(q) ? 200 : 0;
      if (!score && (`${item.artistKey} ${title}`.includes(q) || `${title} ${item.artistKey}`.includes(q))) score = 180;
      if (!score && q.length >= 4 && [title, ...title.split(" ")].some((word) => near(q, word) || (word.length > q.length && near(q, word.slice(0, q.length))))) score = 100;
      return { item, score };
    }).filter(({ score }) => score).sort((a, b) => b.score - a.score || kindOrder[a.item.kind] - kindOrder[b.item.kind] || a.item.key.length - b.item.key.length || a.item.key.localeCompare(b.item.key) || a.item.kind.localeCompare(b.item.kind));
    return { items: scored.slice(0, limit).map(({ item }) => item), more: scored.length > limit };
  }
  function attach(input, form, actions) {
    const panel = document.createElement("div");
    panel.className = "bom-v1-suggestions";
    panel.id = "bomSearchSuggestions";
    panel.setAttribute("role", "listbox");
    panel.setAttribute("aria-label", "Search suggestions");
    panel.hidden = true;
    form.append(panel);
    const status = document.createElement("span");
    status.className = "visually-hidden";
    status.setAttribute("role", "status");
    form.append(status);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", panel.id);
    input.setAttribute("aria-expanded", "false");
    let timer, generation = 0, active = -1, results = [], composing = false;
    function close() {
      clearTimeout(timer); generation++; panel.hidden = true; active = -1;
      input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant");
    }
    function position() {
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      panel.style.maxHeight = `${Math.max(64, Math.min(460, bottom - form.getBoundingClientRect().bottom - 12))}px`;
    }
    function show(html) {
      panel.innerHTML = html; panel.hidden = false; position();
      input.setAttribute("aria-expanded", "true");
    }
    function schedule() {
      close();
      const query = input.value.trim();
      if (composing || normalise(query).length < 2) return;
      const token = generation;
      timer = setTimeout(async () => {
        show('<div class="bom-v1-suggestion-message">Searching…</div>');
        try {
          const catalogue = await actions.load();
          if (token !== generation || document.activeElement !== input) return;
          const found = rank(catalogue, query);
          results = found.items;
          let html = results.map((item, index) => `<div role="option" aria-selected="false" id="bomSuggestion${index}" data-suggestion="${index}" class="bom-v1-suggestion">
            <span class="bom-v1-suggestion-art">${item.artworkUrl ? `<img src="${escape(item.artworkUrl)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden aria-hidden="true">♪</span>` : "♪"}</span>
            <span class="bom-v1-suggestion-copy"><strong>${escape(item.title)}</strong>${item.secondary ? `<span>${escape(item.secondary)}</span>` : ""}</span><small>${item.kind}</small></div>`).join("");
          if (found.more || !results.length) html += `<div role="option" aria-selected="false" id="bomSuggestion${results.length}" data-suggestion="${results.length}" class="bom-v1-suggestion bom-v1-suggestion-all">See all results for ‘${escape(query)}’ <span aria-hidden="true">→</span></div>`;
          show(html);
          status.textContent = `${results.length} suggestions. Use up and down arrows to choose.`;
        } catch {
          if (token !== generation) return;
          results = [];
          show('<div role="option" aria-selected="false" id="bomSuggestion0" data-suggestion="0" class="bom-v1-suggestion">Suggestions unavailable. Search all results →</div>');
          status.textContent = "Suggestions unavailable. Submit to search all results.";
        }
      }, 180);
    }
    async function choose(index) {
      const item = results[index];
      close();
      if (!item) { form.requestSubmit(); return; }
      input.blur();
      try { await actions.open(item); }
      catch { status.textContent = "Could not open this result. Try searching all results."; }
    }
    input.addEventListener("input", schedule);
    input.addEventListener("focus", schedule);
    input.addEventListener("compositionstart", () => { composing = true; close(); });
    input.addEventListener("compositionend", () => { composing = false; schedule(); });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || composing) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (panel.hidden) return;
      const options = [...panel.querySelectorAll("[role=option]")];
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
        event.preventDefault();
        active = (active + (event.key === "ArrowDown" ? 1 : active < 0 ? 0 : -1) + options.length) % options.length;
        options.forEach((option, index) => option.setAttribute("aria-selected", String(index === active)));
        input.setAttribute("aria-activedescendant", options[active].id);
        options[active].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && active >= 0) { event.preventDefault(); void choose(active); }
      else if (event.key === "Tab") close();
    });
    panel.addEventListener("pointerdown", (event) => { if (event.pointerType === "mouse") event.preventDefault(); });
    panel.addEventListener("click", (event) => { const option = event.target.closest("[data-suggestion]"); if (option) void choose(Number(option.dataset.suggestion)); });
    form.addEventListener("submit", close);
    document.addEventListener("pointerdown", (event) => { if (!form.contains(event.target)) close(); });
    form.addEventListener("focusout", (event) => { if (event.relatedTarget && !form.contains(event.relatedTarget)) close(); });
    window.addEventListener("popstate", close);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
  }
  window.BOMAutocomplete = Object.freeze({ buildCatalogue, rank, attach });
})();
