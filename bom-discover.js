(function initialiseBOMDiscoverPresentation() {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  const bondEnabled = () => window.BOM_BOND_FEATURE?.enabled === true;
  const bondBanner = () => bondEnabled() ? `<section class="bom-007-banner" data-bom-bond-banner aria-labelledby="bomBondBannerTitle"><div class="bom-007-banner-motif" aria-hidden="true"><span></span></div><div class="bom-007-banner-copy"><p>THE BANK OF MUSIC PRESENTS</p><h2 id="bomBondBannerTitle">007 — THE MUSIC OF BOND</h2><span>Six decades. Legendary voices. One licence to rate.</span></div><button type="button" data-bom-action="bond-special">ACCEPT YOUR MISSION <span aria-hidden="true">→</span></button></section>` : "";
  const comingSoonGames = () => [
    { name:"Higher or Lower", description:"Trust your ears. Pick the community favourite.", enabled:window.BOM_HIGHER_LOWER_FEATURE?.enabled === true, mark:"↕" },
    { name:"60-Second Quickfire", description:"Race the clock. Keep the streak alive.", enabled:window.BOM_QUICKFIRE_FEATURE?.enabled === true, mark:"60" },
    { name:"Daily BOM Challenge", description:"Ten questions. One shared daily challenge.", enabled:window.BOM_DAILY_CHALLENGE_FEATURE?.enabled === true, mark:"10" }
  ].filter(game => !game.enabled);
  function gamesTeaser(canQuickRate=true) {
    const games=comingSoonGames();
    if(!games.length)return "";
    const partial=games.length<3;
    return `<section class="bom-games-teaser" data-bom-games-teaser aria-labelledby="bomGamesTeaserTitle"><div class="bom-games-teaser-copy"><p>BOM GAMES · COMING SOON</p><h2 id="bomGamesTeaserTitle">Think you know your music?</h2><span>Your ratings. Your knowledge. Your bragging rights.</span></div><div class="bom-games-teaser-list" aria-label="${partial?"More upcoming BOM games":"Upcoming BOM games"}">${games.map(game=>`<article><b aria-hidden="true">${game.mark}</b><div><h3>${game.name}</h3><p>${game.description}</p></div><span>COMING SOON</span></article>`).join("")}</div><footer><strong>Rate more music. Help unlock the games.</strong>${canQuickRate?'<button type="button" data-bom-action="quick-rate">Open Quick Rate <span aria-hidden="true">→</span></button>':""}</footer></section>`;
  }
  const christmasEnabled = (now = new Date()) => window.BOM_CHRISTMAS_FEATURE?.isEligible?.(now) === true;
  const christmasBanner = () => christmasEnabled() ? `<section class="bom-christmas-banner" data-bom-christmas-banner aria-labelledby="bomChristmasBannerTitle"><div aria-hidden="true">✦</div><div><p>THE BANK OF MUSIC PRESENTS</p><h2 id="bomChristmasBannerTitle">THE CHRISTMAS TOP 100</h2><span>Festive favourites, ranked by the BOM community.</span></div><button type="button" data-bom-action="christmas-special">OPEN THE CHRISTMAS SPECIAL <span aria-hidden="true">→</span></button></section>` : "";
  const anniversaries = new Set([10,20,25,30,40,50]);
  let data, loading, dataRefreshComplete = false, index = 0, timer = 0, christmasSeasonTimer = 0, lastDiscoverModel = null, resumeAt = 0, historicalSelectionPending = false, historicalRatingPending = false, historicalDetailItem = null, historicalDetailToken = 0;

  function londonParts(value = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone:"Europe/London", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(value).map(x => [x.type,x.value]));
    return { year:+p.year, month:+p.month, day:+p.day };
  }
  function nextChristmasBoundary(value = new Date()) {
    const { year, month } = londonParts(value);
    return new Date(month === 12 ? Date.UTC(year + 1, 0, 1) : Date.UTC(month < 12 ? year : year + 1, 11, 1));
  }
  function christmasBoundaryDelay(value = new Date()) {
    return Math.max(1000, Math.min(nextChristmasBoundary(value).getTime() - value.getTime(), 12 * 60 * 60 * 1000));
  }
  function scheduleChristmasSeasonCheck(value = new Date()) {
    window.clearTimeout?.(christmasSeasonTimer);
    christmasSeasonTimer = window.setTimeout?.(syncChristmasSeason, christmasBoundaryDelay(value)) || 0;
  }
  function syncChristmasSeason() {
    const root = document.querySelector?.("[data-bom-discover]");
    const existing = root?.querySelector?.("[data-bom-christmas-banner]");
    const eligible = christmasEnabled();
    if (root && lastDiscoverModel?.authenticated && eligible && !existing) {
      root.querySelector(".bom-v1-discover-intro")?.insertAdjacentHTML("afterend", christmasBanner());
    } else if (!eligible && existing) {
      existing.remove();
      document.getElementById("bomChristmasSpecial")?.close?.();
    }
    scheduleChristmasSeasonCheck();
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
  const art = (item,label) => item?.artworkUrl ? `<img src="${esc(item.artworkUrl)}" alt="${esc(item.title)} artwork" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="bom-v1-discovery-art-fallback" aria-hidden="true" hidden>${label}</span>` : `<span class="bom-v1-discovery-art-fallback" aria-hidden="true">${label}</span>`;
  function artworkStack(items,label,variant="olive") {
    const unique=(items||[]).filter((item,i,rows)=>item?.artworkUrl&&rows.findIndex(row=>row.artworkUrl===item.artworkUrl)===i).slice(0,3);
    const covers=Array.from({length:3},(_,i)=>`<span class="bom-v1-discovery-cover is-${i+1}">${art(unique[i],label)}</span>`).join("");
    return `<div class="bom-v1-discovery-artwork is-${variant}" aria-label="Featured catalogue artwork">${covers}${variant==="chart"?'<span class="bom-v1-discovery-chart-mark" aria-hidden="true">1</span>':""}</div>`;
  }
  const historyArt = (item,albums) => `<div class="bom-v1-history-art">${art(item,albums?"LP":"♪")}${albums?"":`<span class="bom-v1-history-position">No. 1</span>`}</div>`;

  function albumRow(albums,label) {
    if(!albums.length) return ""; const id=`bomDiscoverRow-${Math.random().toString(36).slice(2)}`;
    return `<div class="bom-v1-discover-row-shell"><button class="bom-v1-discover-arrow is-previous" data-bom-discover-scroll="-1" aria-controls="${id}" aria-label="Scroll ${esc(label)} left">←</button><div id="${id}" class="bom-v1-discover-row" tabindex="0">${albums.map(window.BOMUI.AlbumCard).join("")}</div><button class="bom-v1-discover-arrow is-next" data-bom-discover-scroll="1" aria-controls="${id}" aria-label="Scroll ${esc(label)} right">→</button></div>`;
  }
  function carousel() {
    const weeklyAlbums=releases(data?.albums), weeklyNumberOnes=numberOnes(data?.numberOnes), album=weeklyAlbums[0], one=weeklyNumberOnes[0];
    const catalogueArtwork=(data?.albums||[]).filter(item=>item.artworkUrl).slice(0,3);
    const slides=[
      ["Quick rate","Rate the songs that shaped the charts","Move through BOM catalogue tracks by year and build your collection faster.","quick-rate","Start Quick Rate",artworkStack(catalogueArtwork,"LP","olive"),["BOM Tracks by Year","UK No. 1s by Decade","Build Your Ratings"]],
      album ? [album.significant?`${album.age} years · Released this week`:"Released this week",album.title,`${album.artist} · ${album.year}. Albums first released during this week in music history.`,"released-week","Explore releases",artworkStack(weeklyAlbums,"LP","amber")] : ["Released this week","Albums from this week in music history","No verified original release in BOM matches this week yet.","released-week","Explore releases",artworkStack([],"LP","amber")],
      one ? ["UK No.1s this week",one.title,`${one.artist} · ${one.chart_year}. Revisit the singles that topped the UK chart this week.`,"number-ones-week","Explore No.1s",artworkStack(weeklyNumberOnes,"01","chart")] : ["UK No.1s this week","The songs that topped the UK chart","Explore verified historical chart runs held in BOM.","number-ones-week","Explore No.1s",artworkStack([],"01","chart")]
    ];
    return `<section class="bom-v1-discovery-carousel" data-bom-discovery-carousel aria-label="Discover music through the years" tabindex="0"><header><span><i aria-hidden="true">◉</i> Discover music through the years</span><div>${slides.map((_,i)=>`<button data-bom-carousel-go="${i}" aria-label="Show feature ${i+1}" aria-current="${i===index}"></button>`).join("")}</div></header><div class="bom-v1-discovery-viewport"><div class="bom-v1-discovery-track" style="--bom-slide:${index}">${slides.map((s,i)=>`<article class="bom-v1-discovery-slide" aria-hidden="${i!==index}">${s[5]}<div class="bom-v1-discovery-content"><p class="bom-v1-discovery-label">${esc(s[0])}</p><h2>${esc(s[1])}</h2><p class="bom-v1-discovery-copy">${esc(s[2])}</p><button class="bom-v1-discovery-action" data-bom-action="${s[3]}">${esc(s[4])} <span aria-hidden="true">→</span></button>${s[6]?`<ul class="bom-v1-discovery-features" aria-label="Quick Rate features">${s[6].map(feature=>`<li>${esc(feature)}</li>`).join("")}</ul>`:""}</div></article>`).join("")}</div><button class="bom-v1-discovery-next" data-bom-carousel-next aria-label="Next feature">→</button></div></section>`;
  }
  function render(model) {
    lastDiscoverModel = model;
    scheduleChristmasSeasonCheck();
    const groups=model.groups||[], general=model.general||[], has=groups.some(g=>g.albums.length)||general.length;
    return `<article class="bom-v1-discover" data-bom-discover><header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Old favourites. New obsessions. Your next great record.</p></div><span>The Bank of Music<br>A life in records</span></header>${model.authenticated?`${christmasBanner()}${bondBanner()}`:""}${gamesTeaser(model.authenticated)}${model.authenticated?carousel():""}${has?`${general.length?`<section class="bom-v1-discover-section"><header class="bom-v1-discover-section-heading"><div><h2>Your next listen</h2><p>Records to make time for.</p></div></header>${albumRow(general,"Albums to rate next")}</section>`:""}${groups.map(g=>`<section class="bom-v1-discover-group"><header class="bom-v1-discover-group-heading"><p>Because you rated <strong>${esc(g.reason.title)}</strong> ${esc(g.reason.rating)} / 10</p></header>${albumRow(g.albums,`Recommendations because you rated ${g.reason.title}`)}</section>`).join("")}`:window.BOMUI.SectionState({title:model.authenticated?"Your next record is waiting.":"Sign in to make Discover yours.",message:"Search or rate music to start building recommendations.",actionLabel:"Search the collection",action:"discover-search"})}</article>`;
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
    const historicalId = albums ? "" : ` data-history-id="${esc(item.id)}"`;
    const provisional=item.provisionalRatingSummary, provisionalCount=Number(provisional?.communityRatingCount||0), provisionalAverage=Number(provisional?.communityAverage);
    const provisionalCommunity=provisionalCount>0&&Number.isFinite(provisionalAverage)?`<span class="bom-v1-history-community"><strong>${provisionalAverage.toFixed(1)}</strong> / 10 · ${provisionalCount.toLocaleString()} historical rating${provisionalCount===1?"":"s"}</span>`:`<span class="bom-v1-history-community is-empty">No historical ratings yet</span>`;
    const provisionalPersonal=provisional?.personalRating==null?"Not rated by you":`Your historical rating · ${provisional.personalRating} / 10`;
    const unresolved = !albums&&!destination ? `<small class="bom-v1-history-match-state">Historical entry · recording not yet verified</small><div class="bom-v1-history-ratings is-provisional">${provisionalCommunity}<small>${provisionalPersonal}</small></div>` : "";
    return `<article class="bom-v1-history-card${destination?"":" is-unlinked"}" tabindex="0" role="link" data-${albums?"album":"track"}-id="${esc(destination||"")}"${historicalId}>${historyArt(item,albums)}<div><p>${meta}</p><h3>${esc(item.title)}</h3><span>${esc(item.artist)}</span>${albums?`<small>${albumRating}</small>`:destination?`<div class="bom-v1-history-ratings">${community}<small>${personal}</small></div>`:unresolved}</div></article>`;
  }
  function historicalRatingPanel(item,summary=item?.provisionalRatingSummary,{pending=false,message=""}={}) {
    const authenticated=Boolean(window.BOMPresentationBridge?.getState?.().authenticated), count=Math.max(0,Number(summary?.communityRatingCount)||0), average=Number(summary?.communityAverage);
    const personal=summary?.personalRating===null||summary?.personalRating===undefined?null:Number(summary.personalRating), hasPersonal=Number.isInteger(personal)&&personal>=0&&personal<=10;
    const community=count>0&&Number.isFinite(average)?`<strong>${average.toFixed(1)}</strong><span>/ 10</span><small>${count.toLocaleString()} historical rating${count===1?"":"s"}</small>`:`<span class="bom-v1-rating-empty">No historical ratings yet</span>`;
    const controls=authenticated?`<div class="bom-v1-historical-rating-choices" role="group" aria-label="Rate this historical entry from 0 to 10">${Array.from({length:11},(_,rating)=>`<button type="button" data-historical-rating-value="${rating}" aria-label="Rate ${rating} out of 10" aria-pressed="${hasPersonal&&personal===rating}"${pending?" disabled":""}>${rating}</button>`).join("")}</div>${hasPersonal?`<button type="button" class="bom-v1-historical-rating-clear" data-historical-rating-clear${pending?" disabled":""}>Clear rating</button>`:""}`:`<p class="bom-v1-historical-rating-signin">Sign in to add your historical rating.</p>`;
    return `<section class="bom-v1-album-ratings bom-v1-historical-rating-panel${pending?" is-saving":""}" data-historical-rating-panel aria-busy="${pending}"><div><span>Historical community</span><div class="bom-v1-album-community bom-v1-historical-community">${community}</div></div><div><span>Your historical rating</span><div class="bom-v1-album-personal bom-v1-historical-personal"><strong>${hasPersonal?`${personal} / 10`:"Not rated"}</strong>${controls}</div></div><p class="bom-v1-historical-rating-note">Historical chart entry — recording not yet verified</p><p class="bom-v1-historical-rating-status" role="status" aria-live="polite">${esc(message||(pending?"Saving…":""))}</p></section>`;
  }
  function historicalDetail(item) {
    const weeks=Math.max(1,Number(item.weeks_at_number_one)||1), runs=Math.max(1,Number(item.number_one_runs)||1);
    const firstDate=/^\d{4}-\d{2}-\d{2}$/.test(String(item.first_number_one_date||"")) ? new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${item.first_number_one_date}T00:00:00Z`)) : "Date unavailable";
    const artwork=item.artworkUrl?`<img class="bom-v1-album-artwork" src="${esc(item.artworkUrl)}" alt="${esc(item.title)} artwork" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><div class="bom-v1-album-artwork bom-v1-album-artwork-missing" role="img" aria-label="Artwork unavailable" hidden><span>bom</span><small>Artwork unavailable</small></div>`:`<div class="bom-v1-album-artwork bom-v1-album-artwork-missing" role="img" aria-label="Artwork unavailable"><span>bom</span><small>Artwork unavailable</small></div>`;
    return `<article class="bom-v1-album bom-v1-track-detail bom-v1-historical-detail" data-historical-detail-id="${esc(item.id)}"><div class="bom-v1-album-back"><button class="bom-v1-history-back" data-bom-action="historical-detail-back">← Back to UK No.1s</button></div><section class="bom-v1-album-hero bom-v1-track-detail-hero bom-v1-historical-hero"><div class="bom-v1-album-artwork-wrap bom-v1-historical-artwork">${artwork}<span class="bom-v1-historical-position">No. 1</span></div><div class="bom-v1-album-identity bom-v1-historical-copy"><div class="bom-v1-album-kind">Historical chart entry</div><h1 tabindex="-1">${esc(item.title)}</h1><div class="bom-v1-album-artist">${esc(item.artist)}</div><div class="bom-v1-album-meta bom-v1-historical-chart-summary"><span>${esc(item.chart_year)}</span><span>${weeks} week${weeks===1?"":"s"} at No.1</span></div>${historicalRatingPanel(item)}</div></section><section class="bom-v1-album-section bom-v1-historical-facts" aria-label="Verified chart information"><header class="bom-v1-album-section-header"><h2>Chart History</h2></header><dl><div><dt>First reached No.1</dt><dd>${esc(firstDate)}</dd></div><div><dt>Weeks at No.1</dt><dd>${weeks}</dd></div><div><dt>Number-one runs</dt><dd>${runs}</dd></div></dl></section></article>`;
  }
  function setHistoricalDetailHeading(active) {
    const section=document.getElementById("recommendationsSection");
    if(!section)return;
    const heading=section.querySelector(":scope > h2"), description=section.querySelector(":scope > .small");
    if(heading)heading.textContent=active?"UK No.1s — Music History":"Recommended Albums";
    if(description)description.textContent=active?"Explore the songs and verified chart stories that reached No.1 in the UK.":"Albums you may want to rate next.";
  }
  function resetHistoricalDetailScroll(root) {
    const scroller=document.scrollingElement||document.documentElement;
    const previous=scroller.style.scrollBehavior;
    scroller.style.scrollBehavior="auto";
    scroller.scrollTop=0;
    void scroller.scrollTop;
    scroller.style.scrollBehavior=previous;
    root.querySelector("h1")?.focus({preventScroll:true});
  }
  function updateHistoricalRatingPanel(item,root,options={}) {
    if(!item||root.querySelector(".bom-v1-historical-detail")?.dataset.historicalDetailId!==String(item.id))return;
    const panel=root.querySelector("[data-historical-rating-panel]");
    if(panel)panel.outerHTML=historicalRatingPanel(item,item.provisionalRatingSummary,options);
  }
  async function hydrateHistoricalRating(item,root,token) {
    try {
      const summaries=await window.BOMPresentationBridge?.loadHistoricalChartRatingSummaries?.([Number(item.id)]);
      if(token!==historicalDetailToken)return;
      item.provisionalRatingSummary=summaries?.get?.(Number(item.id))||item.provisionalRatingSummary||null;
      updateHistoricalRatingPanel(item,root);
    } catch {
      if(token===historicalDetailToken)updateHistoricalRatingPanel(item,root,{message:"Historical ratings could not be loaded. Please try again later."});
    }
  }
  function openHistoricalDetail(item,{origin="history"}={}) {
    if(!item||historicalSelectionPending)return;
    historicalSelectionPending=true;
    const root=document.getElementById("recommendationsList");
    window.BOMPresentationBridge?.showSection?.("recommendationsSection");
    if(origin==="history")window.history.replaceState({...window.history.state,bomHistoricalList:true,bomHistoricalType:"number",scrollY:window.scrollY},"",window.location.href);
    window.history.pushState({bomHistoricalDetail:true,historicalId:item.id},"",window.location.href);
    setHistoricalDetailHeading(true);
    historicalDetailItem=item;
    const token=++historicalDetailToken;
    root.innerHTML=historicalDetail(item);
    resetHistoricalDetailScroll(root);
    historicalSelectionPending=false;
    void hydrateHistoricalRating(item,root,token);
  }
  function load() { if(!loading) loading=Promise.resolve(window.BOMPresentationBridge?.loadHistoricalDiscovery?.()).then(x=>data=x||{albums:[],numberOnes:[]}).catch(()=>data={albums:[],numberOnes:[]}); return loading; }
  function setCarousel(root) { root.querySelector(".bom-v1-discovery-track")?.style.setProperty("--bom-slide",index); root.querySelectorAll(".bom-v1-discovery-slide").forEach((x,i)=>x.setAttribute("aria-hidden",i!==index)); root.querySelectorAll("[data-bom-carousel-go]").forEach((x,i)=>x.setAttribute("aria-current",i===index)); }
  function move(root,delta,manual=true){index=(index+delta+3)%3;if(manual)resumeAt=Date.now()+14000;setCarousel(root);activate(root);}
  function activate(scope=document){clearTimeout(timer);const root=scope.querySelector?.("[data-bom-discovery-carousel]");if(!root)return;if(!root.dataset.ready){root.dataset.ready="1";let x=0;root.addEventListener("pointerdown",e=>x=e.clientX);root.addEventListener("pointerup",e=>{if(Math.abs(e.clientX-x)>45)move(root,e.clientX<x?1:-1)});root.addEventListener("keydown",e=>{if(["ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();move(root,e.key==="ArrowRight"?1:-1)}});root.addEventListener("mouseenter",()=>clearTimeout(timer));root.addEventListener("focusin",()=>clearTimeout(timer));root.addEventListener("mouseleave",()=>activate(root.parentElement));root.addEventListener("focusout",()=>activate(root.parentElement));}if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&Date.now()>=resumeAt)timer=setTimeout(()=>move(root,1,false),7000);}
  function updateRowControls(root=document){if(!root.querySelector?.(".bom-v1-historical-detail"))setHistoricalDetailHeading(false);root.querySelectorAll?.(".bom-v1-discover-row-shell").forEach(s=>{const r=s.querySelector(".bom-v1-discover-row"),p=s.querySelector(".is-previous"),n=s.querySelector(".is-next"),o=r.scrollWidth>r.clientWidth+2;p.hidden=!o||r.scrollLeft<=2;n.hidden=!o||r.scrollLeft+r.clientWidth>=r.scrollWidth-2;});activate(root);void load().then(()=>{if(!dataRefreshComplete&&root.querySelector?.("[data-bom-discovery-carousel]")){dataRefreshComplete=true;window.BOMPresentationBridge?.refreshDiscover?.();}});}
  document.addEventListener("click",e=>{const scroll=e.target.closest("[data-bom-discover-scroll]");if(scroll){document.getElementById(scroll.getAttribute("aria-controls"))?.scrollBy({left:+scroll.dataset.bomDiscoverScroll*500,behavior:"smooth"});return;}const car=e.target.closest("[data-bom-discovery-carousel]"),go=e.target.closest("[data-bom-carousel-go]");if(car&&go){index=+go.dataset.bomCarouselGo;resumeAt=Date.now()+14000;setCarousel(car);activate(car.parentElement);return;}if(car&&e.target.closest("[data-bom-carousel-next]")){move(car,1);return;}const ratingButton=e.target.closest("[data-historical-rating-value],[data-historical-rating-clear]");if(ratingButton&&historicalDetailItem&&!historicalRatingPending){const root=document.getElementById("recommendationsList"),isClear=ratingButton.hasAttribute("data-historical-rating-clear"),value=isClear?null:Number(ratingButton.dataset.historicalRatingValue),current=historicalDetailItem.provisionalRatingSummary?.personalRating;if(!isClear&&current!==null&&current!==undefined&&Number(current)===value)return;historicalRatingPending=true;updateHistoricalRatingPanel(historicalDetailItem,root,{pending:true});void window.BOMPresentationBridge?.saveHistoricalChartEntryRating?.(Number(historicalDetailItem.id),value).then(result=>{if(result?.ok){if(result.summary)historicalDetailItem.provisionalRatingSummary=result.summary;updateHistoricalRatingPanel(historicalDetailItem,root,{message:result.message||(isClear?"Rating cleared.":`Saved ${value} / 10.`)});}else updateHistoricalRatingPanel(historicalDetailItem,root,{message:result?.message||"Your rating could not be saved. Please try again."});}).catch(()=>updateHistoricalRatingPanel(historicalDetailItem,root,{message:"Your rating could not be saved. Please try again."})).finally(()=>{historicalRatingPending=false;});return;}const action=e.target.closest("[data-bom-action]")?.dataset.bomAction;if(action==="bond-special")void window.BOMPresentationBridge?.showBondSpecial?.();if(action==="quick-rate")window.BOMPresentationBridge?.showQuickRate();if(action==="discover-search")window.BOMPresentationBridge?.showSearch();if(action==="history-back"||action==="discover-retry")window.BOMPresentationBridge?.refreshDiscover();if(action==="historical-detail-back"){window.history.back();return;}if(action==="released-week"||action==="number-ones-week")document.getElementById("recommendationsList").innerHTML=history(action==="released-week"?"released":"number");const a=e.target.closest(".bom-v1-history [data-album-id]");if(a)void window.BOMPresentationBridge?.openAlbumById(a.dataset.albumId);const t=e.target.closest(".bom-v1-history [data-track-id]");if(t?.dataset.trackId){void window.BOMPresentationBridge?.openTrackById(t.dataset.trackId,t);return;}const historical=e.target.closest(".bom-v1-history [data-history-id]");if(historical){const item=data?.numberOnes?.find(row=>String(row.id)===historical.dataset.historyId);openHistoricalDetail(item);}});
  document.addEventListener("keydown",e=>{const card=e.target.closest(".bom-v1-history-card,.bom-v1-music-card");if(card&&["Enter"," "].includes(e.key)){e.preventDefault();card.click();}});
  document.addEventListener("click", event => {
    const album = event.target.closest(".bom-v1-discover .bom-v1-music-card");
    if (!album) return;
    window.history.replaceState({ ...(window.history.state || {}), bomDiscover: true, scrollY: window.scrollY }, "", window.location.href);
    window.history.pushState({ bomDiscoverDestination: true }, "", window.location.href);
  }, true);
  document.addEventListener("click",e=>{const a=e.target.closest("[data-bom-discover-artist]");if(a){e.preventDefault();e.stopPropagation();void window.BOMPresentationBridge?.openArtist(a.dataset.bomDiscoverArtist);}},true);
  document.addEventListener("click",event=>{if(event.target.closest('[data-bom-action="christmas-special"]'))void window.BOMPresentationBridge?.showChristmasSpecial?.();},true);
  window.addEventListener("popstate",event=>{if(!event.state?.bomHistoricalList)return;const root=document.getElementById("recommendationsList");root.innerHTML=history(event.state.bomHistoricalType||"number");window.requestAnimationFrame(()=>window.scrollTo({top:Number(event.state.scrollY||0),behavior:"auto"}));});
  const skeleton=()=>`<article class="bom-v1-discover" aria-busy="true"><header class="bom-v1-discover-intro"><div><p class="bom-v1-discover-eyebrow">Listen closely. Find something good.</p><h1>A world worth listening to.</h1><p>Finding records for you…</p></div></header></article>`;
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncChristmasSeason();});
  window.addEventListener("focus",syncChristmasSeason);
  window.addEventListener("pageshow",syncChristmasSeason);
  window.BOMDiscoverHelpers=Object.freeze({currentLondonWeek,occurrenceInWeek,chartCoversWeek,releases,numberOnes,historicalRatingPanel,christmasEnabled,nextChristmasBoundary,christmasBoundaryDelay,syncChristmasSeason,comingSoonGames,gamesTeaser});
  window.BOMDiscoverUI=Object.freeze({render,renderLoading:skeleton,renderError:()=>`<article class="bom-v1-discover">${window.BOMUI.SectionState({title:"Discover couldn’t load.",actionLabel:"Try again",action:"discover-retry"})}</article>`,updateRowControls,openHistoricalDetail});
})();
