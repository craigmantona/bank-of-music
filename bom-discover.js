(function initialiseBOMDiscoverPresentation() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  const anniversaries = new Set([10,20,25,30,40,50]);
  let data, loading, dataRefreshComplete = false, index = 0, timer = 0, resumeAt = 0;

  function londonParts(value = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(value).map(x => [x.type,x.value]));
    return { year:+p.year, month:+p.month, day:+p.day };
  }
  const utc = p => new Date(Date.UTC(p.year,p.month-1,p.day));
  function currentLondonWeek(value = new Date()) {
    const today = utc(londonParts(value)), start = new Date(today);
    start.setUTCDate(today.getUTCDate() - ((today.getUTCDay()+6)%7));
    const end = new Date(start); end.setUTCDate(start.getUTCDate()+6);
    return {start,end};
  }
  function safeDate(year,month,day) {
    const d = new Date(Date.UTC(year,month-1,day));
    return d.getUTCMonth() === month-1 ? d : new Date(Date.UTC(year,month,0));
  }
  function occurrenceInWeek(value, week = currentLondonWeek()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value||""))) return null;
    const [releaseYear,month,day] = value.split("-").map(Number);
    for (const year of new Set([week.start.getUTCFullYear(),week.end.getUTCFullYear()])) {
      const occurrence = safeDate(year,month,day);
      if (occurrence >= week.start && occurrence <= week.end) return {releaseYear,occurrence};
    }
    return null;
  }
  function chartCoversWeek(row, week = currentLondonWeek()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.first_number_one_date||""))) return false;
    const start = new Date(`${row.first_number_one_date}T00:00:00Z`), days = Math.max(1,+row.weeks_at_number_one||1)*7;
    for (let n=0;n<days;n++) { const d=new Date(start); d.setUTCDate(start.getUTCDate()+n); if (occurrenceInWeek(d.toISOString().slice(0,10),week)) return true; }
    return false;
  }
  function releases(rows, now = new Date()) {
    const week=currentLondonWeek(now), year=londonParts(now).year, seen=new Set();
    return (rows||[]).flatMap(a => { const match=occurrenceInWeek(a.originalReleaseDate,week); if(!match) return []; const key=(a.releaseGroupId||`${a.artist}|${a.title}|${a.originalReleaseDate}`).toLowerCase(); if(seen.has(key)) return []; seen.add(key); const age=year-match.releaseYear; return [{...a,year:match.releaseYear,age,significant:anniversaries.has(age)}]; }).sort((a,b)=>b.year-a.year);
  }
  const numberOnes = (rows,now=new Date()) => (rows||[]).filter(r=>chartCoversWeek(r,currentLondonWeek(now))).sort((a,b)=>b.chart_year-a.chart_year);
  const art = (item,label) => item?.artworkUrl ? `<img src="${esc(item.artworkUrl)}" alt="${esc(item.title)} artwork" loading="lazy" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="bom-v1-discovery-art-fallback" aria-hidden="true" hidden>${label}</span>` : `<span class="bom-v1-discovery-art-fallback" aria-hidden="true">${label}</span>`;
  const historyArt = (item,albums) => `<div class="bom-v1-history-art">${art(item,albums?"LP":"♪")}${albums?"":`<span class="bom-v1-history-position">No. 1</span>`}</div>`;

  function albumRow(albums,label) {
    if(!albums.length) return ""; const id=`bomDiscoverRow-${Math.random().toString(36).slice(2)}`;
    return `<div class="bom-v1-discover-row-shell"><button class="bom-v1-discover-arrow is-previous" data-bom-discover-scroll="-1" aria-controls="${id}" aria-label="Scroll ${esc(label)} left">←</button><div id="${id}" class="bom-v1-discover-row" tabindex="0">${albums.map(window.BOMUI.AlbumCard).join("")}</div><button class="bom-v1-discover-arrow is-next" data-bom-discover-scroll="1" aria-controls="${id}" aria-label="Scroll ${esc(label)} right">→</button></div>`;
  }
  function carousel() {
    const album=releases(data?.albums)[0], one=numberOnes(data?.numberOnes)[0];
    const slides=[
      ["Quick rate","Rate the songs that shaped the charts","Move through UK singles by year and build your collection faster.","quick-rate","Start Quick Rate",`<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="28"/><circle cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="2" fill="currentColor"/></svg>`],
      album ? [album.significant?`${album.age} years · Released this week`:"Released this week",album.title,`${album.artist} · ${album.year}. Albums first released during this week in music history.`,"released-week","Explore releases",art(album,"LP")] : ["Released this week","Albums from this week in music history","No verified original release in BOM matches this week yet.","released-week","Explore releases",art(null,"LP")],
      one ? ["UK No.1s this week",one.title,`${one.artist} · ${one.chart_year}. Revisit the singles that topped the UK chart this week.`,"number-ones-week","Explore No.1s",art(one,"01")] : ["UK No.1s this week","The songs that topped the UK chart","Explore verified historical chart runs held in BOM.","number-ones-week","Explore No.1s",art(null,"01")]
    ];
    return `<section class="bom-v1-discovery-carousel" data-bom-discovery-carousel aria-label="Discover music through the years"><header><span><i aria-hidden="true">◉</i> Discover music through the years</span><div>${slides.map((_,i)=>`<button data-bom-carousel-go="${i}" aria-label="Show feature ${i+1}" aria-current="${i===index}"></button>`).join("")}</div></header><div class="bom-v1-discovery-viewport"><div class="bom-v1-discovery-track" style="--bom-slide:${index}">${slides.map((s,i)=>`<article class="bom-v1-discovery-slide" aria-hidden="${i!==index}"><div class="bom-v1-discovery-art">${s[5]}</div><div><p class="bom-v1-discovery-label">${esc(s[0])}</p><h2>${esc(s[1])}</h2><p class="bom-v1-discovery-copy">${esc(s[2])}</p><button data-bom-action="${s[3]}">${esc(s[4])} →</button></div></article>`).join("")}</div><button class="bom-v1-discovery-next" data-bom-carousel-next aria-label="Next feature">→</button></div></section>`;
  }
  function render(model) {
    const groups=model.groups||[], general=model.general||[], has=groups.some(g=>g.albums.length)||general.length;
    return `<article class="bom-v1-discover" data-bom-discover><header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Old favourites. New obsessions. Your next great record.</p></div><span>The Bank of Music<br>A life in records</span></header>${model.authenticated?carousel():""}${has?`${general.length?`<section class="bom-v1-discover-section"><header class="bom-v1-discover-section-heading"><div><h2>Your next listen</h2><p>Records to make time for.</p></div></header>${albumRow(general,"Albums to rate next")}</section>`:""}${groups.map(g=>`<section class="bom-v1-discover-group"><header class="bom-v1-discover-group-heading"><p>Because you rated <strong>${esc(g.reason.title)}</strong> ${esc(g.reason.rating)} / 10</p></header>${albumRow(g.albums,`Recommendations because you rated ${g.reason.title}`)}</section>`).join("")}`:window.BOMUI.SectionState({title:model.authenticated?"Your next record is waiting.":"Sign in to make Discover yours.",message:"Search or rate music to start building recommendations.",actionLabel:"Search the collection",action:"discover-search"})}</article>`;
  }
  function history(type) {
    const albums=type==="released", rows=albums?releases(data?.albums):numberOnes(data?.numberOnes), groups=new Map();
    rows.forEach(row=>{const key=albums?row.year:Math.floor(row.chart_year/10)*10;groups.set(key,[...(groups.get(key)||[]),row]);});
    return `<article class="bom-v1-discover bom-v1-history"><button class="bom-v1-history-back" data-bom-action="history-back">← Back to Discover</button><header><p class="bom-v1-discover-eyebrow">Discover music through the years</p><h1>${albums?"Released This Week":"UK No.1s This Week"}</h1><p>${albums?"Verified original album releases matching this Monday–Sunday calendar week.":"Verified singles whose actual UK No.1 run covered this calendar week."}</p></header>${rows.length?[...groups].map(([key,items])=>`<section><h2>${albums?key:`${key}s`}</h2><div class="bom-v1-history-grid">${items.map(item=>historyCard(item,albums)).join("")}</div></section>`).join(""):`<div class="bom-v1-history-empty"><h2>No verified matches yet</h2><p>${albums?"BOM needs more complete MusicBrainz release-group first-release dates for this week.":"The existing UK No.1 evidence has no chart run covering this week."}</p></div>`}</article>`;
  }
  function historyCard(item, albums) {
    const destination = albums ? item.id : item.resolvedSongId;
    const meta = albums && item.significant ? `${item.age} year anniversary` : albums ? item.originalReleaseDate : `${item.chart_year} · ${item.weeks_at_number_one||1} week${+item.weeks_at_number_one===1?"":"s"} at No.1`;
    const albumRating = item.rating==null ? "Not rated" : `${Number(item.rating).toFixed(1)} / 10${item.ratingCount?` · ${item.ratingCount} ratings`:""}`;
    const communityCount = Number(item.communityRatingCount||0), communityAverage = Number(item.communityAverage);
    const community = communityCount>0&&Number.isFinite(communityAverage) ? `<span class="bom-v1-history-community"><strong>${communityAverage.toFixed(1)}</strong> / 10 · ${communityCount.toLocaleString()} community rating${communityCount===1?"":"s"}</span>` : `<span class="bom-v1-history-community is-empty">No community ratings yet</span>`;
    const personal = item.personalRating==null ? "Not rated by you" : `Your rating · ${item.personalRating} / 10`;
    return `<article class="bom-v1-history-card${destination?"":" is-unlinked"}" ${destination?'tabindex="0" role="link"':""} data-${albums?"album":"track"}-id="${esc(destination||"")}">${historyArt(item,albums)}<div><p>${meta}</p><h3>${esc(item.title)}</h3><span>${esc(item.artist)}</span>${albums?`<small>${albumRating}</small>`:`<div class="bom-v1-history-ratings">${community}<small>${personal}</small></div>`}</div></article>`;
  }
  function load() { if(!loading) loading=Promise.resolve(window.BOMPresentationBridge?.loadHistoricalDiscovery?.()).then(x=>data=x||{albums:[],numberOnes:[]}).catch(()=>data={albums:[],numberOnes:[]}); return loading; }
  function setCarousel(root) { root.querySelector(".bom-v1-discovery-track")?.style.setProperty("--bom-slide",index); root.querySelectorAll(".bom-v1-discovery-slide").forEach((x,i)=>x.setAttribute("aria-hidden",i!==index)); root.querySelectorAll("[data-bom-carousel-go]").forEach((x,i)=>x.setAttribute("aria-current",i===index)); }
  function move(root,delta,manual=true){index=(index+delta+3)%3;if(manual)resumeAt=Date.now()+14000;setCarousel(root);activate(root);}
  function activate(scope=document){clearTimeout(timer);const root=scope.querySelector?.("[data-bom-discovery-carousel]");if(!root)return;if(!root.dataset.ready){root.dataset.ready="1";let x=0;root.addEventListener("pointerdown",e=>x=e.clientX);root.addEventListener("pointerup",e=>{if(Math.abs(e.clientX-x)>45)move(root,e.clientX<x?1:-1)});root.addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();move(root,e.key==="ArrowRight"?1:-1)}});root.addEventListener("mouseenter",()=>clearTimeout(timer));root.addEventListener("focusin",()=>clearTimeout(timer));root.addEventListener("mouseleave",()=>activate(root.parentElement));root.addEventListener("focusout",()=>activate(root.parentElement));}if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&Date.now()>=resumeAt)timer=setTimeout(()=>move(root,1,false),7000);}
  function updateRowControls(root=document){root.querySelectorAll?.(".bom-v1-discover-row-shell").forEach(s=>{const r=s.querySelector(".bom-v1-discover-row"),p=s.querySelector(".is-previous"),n=s.querySelector(".is-next"),o=r.scrollWidth>r.clientWidth+2;p.hidden=!o||r.scrollLeft<=2;n.hidden=!o||r.scrollLeft+r.clientWidth>=r.scrollWidth-2;});activate(root);void load().then(()=>{if(!dataRefreshComplete&&root.querySelector?.("[data-bom-discovery-carousel]")){dataRefreshComplete=true;window.BOMPresentationBridge?.refreshDiscover?.();}});}
  document.addEventListener("click",e=>{const scroll=e.target.closest("[data-bom-discover-scroll]");if(scroll){document.getElementById(scroll.getAttribute("aria-controls"))?.scrollBy({left:+scroll.dataset.bomDiscoverScroll*500,behavior:"smooth"});return;}const car=e.target.closest("[data-bom-discovery-carousel]"),go=e.target.closest("[data-bom-carousel-go]");if(car&&go){index=+go.dataset.bomCarouselGo;resumeAt=Date.now()+14000;setCarousel(car);activate(car.parentElement);return;}if(car&&e.target.closest("[data-bom-carousel-next]")){move(car,1);return;}const action=e.target.closest("[data-bom-action]")?.dataset.bomAction;if(action==="quick-rate")window.BOMPresentationBridge?.showQuickRate();if(action==="discover-search")window.BOMPresentationBridge?.showSearch();if(action==="history-back"||action==="discover-retry")window.BOMPresentationBridge?.refreshDiscover();if(action==="released-week"||action==="number-ones-week")document.getElementById("recommendationsList").innerHTML=history(action==="released-week"?"released":"number");const a=e.target.closest(".bom-v1-history [data-album-id]");if(a)void window.BOMPresentationBridge?.openAlbumById(a.dataset.albumId);const t=e.target.closest(".bom-v1-history [data-track-id]");if(t?.dataset.trackId)void window.BOMPresentationBridge?.openTrackById(t.dataset.trackId);});
  document.addEventListener("keydown",e=>{const card=e.target.closest(".bom-v1-history-card,.bom-v1-music-card");if(card&&["Enter"," "].includes(e.key)){e.preventDefault();card.click();}});
  document.addEventListener("click", event => {
    const album = event.target.closest(".bom-v1-discover .bom-v1-music-card");
    if (!album) return;
    window.history.replaceState({ ...(window.history.state || {}), bomDiscover: true, scrollY: window.scrollY }, "", window.location.href);
    window.history.pushState({ bomDiscoverDestination: true }, "", window.location.href);
  }, true);
  document.addEventListener("click",e=>{const a=e.target.closest("[data-bom-discover-artist]");if(a){e.preventDefault();e.stopPropagation();void window.BOMPresentationBridge?.openArtist(a.dataset.bomDiscoverArtist);}},true);
  const skeleton=()=>`<article class="bom-v1-discover" aria-busy="true"><header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Finding records for you…</p></div></header></article>`;
  window.BOMDiscoverHelpers=Object.freeze({currentLondonWeek,occurrenceInWeek,chartCoversWeek,releases,numberOnes});
  window.BOMDiscoverUI=Object.freeze({render,renderLoading:skeleton,renderError:()=>`<article class="bom-v1-discover">${window.BOMUI.SectionState({title:"Discover couldn’t load.",actionLabel:"Try again",action:"discover-retry"})}</article>`,updateRowControls});
})();
