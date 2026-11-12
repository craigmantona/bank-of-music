(function initialiseQuickfire() {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const state = { mode:"songs", pool:[], pair:null, seen:new Set(), featured:new Map(), score:0, answered:0, streak:0, best:0, deadline:0, timer:null, locked:false, finished:false };
  let root;
  const settings = () => window.BOM_QUICKFIRE_FEATURE || {};
  const key = () => `bom-quickfire-best:${state.mode}`;
  function loadBest(){try{state.best=Number(localStorage.getItem(key()))||0;}catch{state.best=0;}}
  function storeBest(){try{localStorage.setItem(key(),String(state.best));}catch{/* optional */}}
  function pairKey(a,b){return [a.itemId,b.itemId].sort((x,y)=>x-y).join(":");}
  function nextPair(){
    const gap=Math.max(.2,Number(settings().minimumRatingGap)||.2), candidates=[];
    for(let a=0;a<state.pool.length;a+=1)for(let b=a+1;b<state.pool.length;b+=1){const left=state.pool[a],right=state.pool[b],id=pairKey(left,right);if(!state.seen.has(id)&&Math.abs(left.rating-right.rating)>=gap)candidates.push([left,right,id]);}
    if(!candidates.length)return null;
    const [a,b,id]=candidates[Math.floor(Math.random()*candidates.length)];state.seen.add(id);
    state.featured.set(`${state.mode}:${a.itemId}`,a);state.featured.set(`${state.mode}:${b.itemId}`,b);
    return Math.random()<.5?{left:a,right:b}:{left:b,right:a};
  }
  function normalise(r){return{itemId:Number(r.item_id),title:r.title,artist:r.artist,artworkUrl:r.artwork_url,rating:Number(r.average_rating),ratingCount:Number(r.rating_count)};}
  function seconds(){return Math.max(0,Math.ceil((state.deadline-Date.now())/1000));}
  function card(item,reveal){return `<article class="bom-hl-card"><div class="bom-hl-art"><img src="${escapeHtml(item.artworkUrl)}" alt="${escapeHtml(item.title)} artwork"></div><div class="bom-hl-card-copy"><h2>${escapeHtml(item.title)}</h2><span>${escapeHtml(item.artist)}</span><strong class="bom-hl-score${reveal?' is-revealed':''}">${reveal?`${item.rating.toFixed(1)} / 10`:'? / 10'}</strong></div></article>`;}
  function shell(body){root.innerHTML=`<main class="bom-hl bom-qf"><header class="bom-hl-header"><button data-game-close>← Discover</button><div><p>60-SECOND</p><h1>Quickfire</h1><span>Higher or Lower at full speed.</span></div><div class="bom-hl-stats"><span>Time <strong data-qf-time>${seconds()}</strong></span><span>Score <strong>${state.score}</strong></span><span>Streak <strong>${state.streak}</strong></span><span>Best <strong>${state.best}</strong></span></div></header>${body}</main>`;}
  function renderRound(message=""){
    if(!state.pair)return finish();const reveal=state.locked,p=state.pair;
    shell(`<div class="bom-hl-modes" role="group" aria-label="Quickfire mode"><button data-qf-mode="songs" aria-pressed="${state.mode==='songs'}">Songs</button><button data-qf-mode="albums" aria-pressed="${state.mode==='albums'}">Albums</button></div><section class="bom-hl-board">${card(p.left,reveal)}<div class="bom-hl-versus">VS</div>${card(p.right,reveal)}</section><section class="bom-hl-actions" aria-live="polite">${reveal?`<p class="${message.startsWith('Correct')?'is-win':'is-loss'}">${escapeHtml(message)}</p>`:`<p>Is <strong>${escapeHtml(p.right.title)}</strong> higher or lower?</p><div><button data-qf-guess="higher">↑ Higher</button><button data-qf-guess="lower">↓ Lower</button></div>`}</section>`);
  }
  function tick(){const el=root?.querySelector('[data-qf-time]');if(el)el.textContent=seconds();if(seconds()<=0)finish();}
  function startClock(){clearInterval(state.timer);state.deadline=Date.now()+(Number(settings().durationSeconds)||60)*1000;state.timer=setInterval(tick,200);}
  async function start(mode=state.mode){clearInterval(state.timer);Object.assign(state,{mode,score:0,answered:0,streak:0,locked:false,finished:false});state.seen.clear();state.featured.clear();loadBest();shell('<div class="bom-hl-loading">Loading fair comparisons…</div>');try{state.pool=(await window.BOMPresentationBridge.loadQuickfirePool(mode)).map(normalise).filter(x=>x.itemId&&x.artworkUrl);state.pair=nextPair();if(!state.pair)return finish();startClock();renderRound();}catch{shell('<div class="bom-hl-empty"><h2>Quickfire is unavailable</h2><p>There are not enough eligible ratings yet.</p></div>');}}
  function guess(value){if(state.locked||state.finished||!state.pair)return;state.locked=true;state.answered+=1;const correct=value===(state.pair.right.rating>state.pair.left.rating?'higher':'lower');if(correct){state.score+=1;state.streak+=1;}else state.streak=0;renderRound(correct?'Correct!':'Incorrect.');setTimeout(()=>{if(state.finished)return;state.locked=false;state.pair=nextPair();renderRound();},450);}
  function finish(){if(state.finished)return;state.finished=true;clearInterval(state.timer);state.best=Math.max(state.best,state.score);storeBest();const accuracy=state.answered?Math.round(state.score/state.answered*100):0;const links=[...state.featured.values()].slice(-4).map(x=>`<button data-qf-rate="${x.itemId}">Rate ${escapeHtml(x.title)} →</button>`).join('');shell(`<section class="bom-game-results"><p>TIME</p><h2>${state.score} correct</h2><strong>${accuracy}% accuracy</strong><span>${state.answered} answered · Personal best ${state.best}</span><button data-qf-replay>Play again</button><div class="bom-game-rate-links">${links}</div></section>`);}
  document.addEventListener('click',e=>{if(!root?.contains(e.target))return;const b=e.target.closest('button');if(!b)return;if(b.dataset.qfGuess)guess(b.dataset.qfGuess);if(b.dataset.qfMode&&b.dataset.qfMode!==state.mode)void start(b.dataset.qfMode);if(b.hasAttribute('data-qf-replay'))void start();if(b.dataset.qfRate)window.BOMPresentationBridge.openHigherLowerItem(state.mode,Number(b.dataset.qfRate));if(b.hasAttribute('data-game-close')){clearInterval(state.timer);window.BOMPresentationBridge.showDiscover();}});
  window.BOMQuickfireUI=Object.freeze({open(container){root=container;return start();}});
})();
