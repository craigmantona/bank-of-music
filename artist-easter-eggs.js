(function () {
  "use strict";

  const ARTIST_EASTER_EGGS_ENABLED = true;
  const BEATLES_MBID = "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d";
  const ROLLING_STONES_MBID = "b071f9fa-14b0-4217-8e97-eb41da73f598";
  const DAVID_BOWIE_MBID = "5441c29d-3602-4898-b1a1-b77fa23b8e50";
  const OASIS_MBID = "39ab1aed-75e0-4140-bd47-540276886b60";
  const PINK_FLOYD_MBID = "83d91898-7763-47d7-b03b-b92132375c47";
  const MICHAEL_JACKSON_MBID = "f27ec8db-af05-4f36-916e-3d57f91ecf5e";
  const registry = new Map();
  let activeHost = null;
  let cleanupTimer = 0;

  function normaliseName(value) {
    return String(value || "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
  }

  function submarineMarkup() {
    return '<div class="bom-egg-submarine" data-bom-artist-egg="beatles">' +
      '<svg viewBox="0 0 150 76" role="img" aria-label="A cheerful yellow submarine">' +
        '<path fill="#f6c928" stroke="#302a23" stroke-width="4" d="M28 35c7-17 28-25 62-22 23 2 39 13 43 26-7 17-25 25-54 25-30 0-47-10-51-29Z"/>' +
        '<path fill="#f6c928" stroke="#302a23" stroke-width="4" d="M64 15V5h24v11M24 36 8 25v31l20-13"/>' +
        '<circle cx="69" cy="35" r="8" fill="#8ed8ee" stroke="#302a23" stroke-width="3"/><circle cx="96" cy="35" r="8" fill="#8ed8ee" stroke="#302a23" stroke-width="3"/>' +
        '<path d="M52 56h58" stroke="#302a23" stroke-width="4" stroke-linecap="round"/>' +
      '</svg>' +
      '<i class="bom-egg-bubble b1"></i><i class="bom-egg-bubble b2"></i><i class="bom-egg-bubble b3"></i></div>';
  }

  function lipsMarkup() {
    return '<div class="bom-egg-lips" data-bom-artist-egg="rolling-stones">' +
      '<img src="assets/rolling-stones-easter-egg.png" alt="" width="512" height="468" decoding="async">' +
      '</div>';
  }

  function lightningMarkup() {
    return '<div class="bom-egg-lightning" data-bom-artist-egg="david-bowie">' +
      '<img src="assets/david-bowie-lightning.png" alt="" width="416" height="500" decoding="async">' +
      '</div>';
  }

  function bucketHatMarkup() {
    return '<div class="bom-egg-hat" data-bom-artist-egg="oasis">' +
      '<svg viewBox="0 0 190 130" role="img" aria-label="Dark bucket hat">' +
        '<defs><linearGradient id="bomHatShade" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#30343a"/><stop offset="1" stop-color="#111318"/><stop offset="1" stop-color="#08090b"/></linearGradient><pattern id="bomHatTexture" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 7 7 0M-2 2 2-2M5 9 9 5" stroke="#fff" stroke-width=".45" opacity=".11"/></pattern></defs>' +
        '<path fill="url(#bomHatShade)" d="M51 18c27-11 61-11 88 0l13 69H37l14-69Z"/>' +
        '<path fill="url(#bomHatTexture)" d="M51 18c27-11 61-11 88 0l13 69H37l14-69Z"/>' +
        '<path fill="#08090c" d="M36 78c37 9 78 9 118 0 16 10 27 22 29 35-51 17-126 17-177 0 3-14 13-25 30-35Z"/>' +
        '<path d="M42 76c34 7 72 7 106 0" fill="none" stroke="#555b64" stroke-width="3" opacity=".58"/>' +
        '<g transform="translate(73 65)"><path fill="#194c9b" d="M0 0h44v10H0z"/><path fill="#fff" d="m0 0 17 5L0 10h8l14-4 14 4h8L27 5 44 0h-8L22 4 8 0Z"/><path fill="#e2293f" d="M19 0h6v10h-6zM0 4h44v3H0z"/></g>' +
      '</svg></div>';
  }

  function prismMarkup() {
    return '<div class="bom-egg-prism" data-bom-artist-egg="pink-floyd">' +
      '<svg viewBox="0 0 270 150" role="img" aria-label="Prism splitting white light into a rainbow">' +
        '<g class="bom-prism-beam-in"><path d="M3 76 102 76" pathLength="1"/></g>' +
        '<path class="bom-prism-outline" d="M103 130 151 20l48 110H103Z" pathLength="1"/>' +
        '<g class="bom-prism-spectrum">' +
          '<path stroke="#ff334d" d="M170 76 267 58" pathLength="1"/><path stroke="#ff8a25" d="M170 77 267 69" pathLength="1"/>' +
          '<path stroke="#ffd83d" d="M170 78 267 80" pathLength="1"/><path stroke="#48db72" d="M170 79 267 91" pathLength="1"/>' +
          '<path stroke="#31bfff" d="M170 80 267 102" pathLength="1"/><path stroke="#8e65ed" d="M170 81 267 113" pathLength="1"/>' +
        '</g>' +
      '</svg></div>';
  }

  function moonwalkMarkup() {
    return '<div class="bom-egg-moonwalk" data-bom-artist-egg="michael-jackson">' +
      '<span class="bom-mj-spotlight"></span>' +
      '<svg viewBox="0 0 120 205" role="img" aria-label="Elegant silhouette performing a moonwalk">' +
        '<g class="bom-mj-figure" transform="rotate(3 60 105)">' +
          '<g class="bom-mj-hat"><path class="bom-mj-rim" d="M39 24c2-14 11-21 24-21 14 0 23 7 25 21H39Z"/><path fill="#050608" d="M41 23c2-12 10-18 22-18s20 6 22 18H41Z"/><path class="bom-mj-rim" d="M22 24c23-6 53-6 78 0-7 8-68 9-78 0Z"/><path fill="#040507" d="M24 24c22-5 51-5 74 0-9 6-64 7-74 0Z"/><path d="M44 18h39" stroke="#777d86" stroke-width="2" opacity=".7"/></g>' +
          '<path class="bom-mj-rim" d="M52 30c13-7 25 0 25 14 0 10-5 18-14 19-10 0-16-8-16-18 0-7 1-11 5-15Z"/><path fill="#08090b" d="M53 31c12-6 22 1 22 13 0 9-4 16-12 17-9 0-14-7-14-16 0-6 1-10 4-14Z"/>' +
          '<path class="bom-mj-rim" d="M45 59c10-6 23-6 32 0l8 49-15 15-30-6-4-45 9-13Z"/><path fill="#07080a" d="M46 60c9-5 21-5 29 0l7 46-14 14-26-5-4-42 8-13Z"/><path d="m55 62 8 13 8-14M62 75l-5 31" fill="none" stroke="#8a9099" stroke-width="1.5" opacity=".65"/>' +
          '<path class="bom-mj-rim bom-mj-limb-rim" d="M43 68c-10 11-15 26-20 43"/><path d="M43 68c-10 11-15 26-20 43" fill="none" stroke="#07080a" stroke-width="8" stroke-linecap="round"/><path d="M23 110c4 5 9 6 14 3" fill="none" stroke="#090a0c" stroke-width="7" stroke-linecap="round"/>' +
          '<g class="bom-mj-glove-arm"><path class="bom-mj-rim bom-mj-limb-rim" d="M74 67c9 12 14 27 17 42"/><path d="M74 67c9 12 14 27 17 42" fill="none" stroke="#07080a" stroke-width="8" stroke-linecap="round"/><path d="M91 108c-1 7-4 13-8 19" fill="none" stroke="#08090b" stroke-width="7" stroke-linecap="round"/><path fill="#fff" d="M78 128c2-8 8-13 13-11 5 2 5 9 0 15-5 6-12 7-13-4Z"/><path d="m82 122 8 6M84 119l8 6" stroke="#c9ced6" stroke-width="1" opacity=".8"/></g>' +
          '<g class="bom-mj-leg bom-mj-leg-left"><path class="bom-mj-rim bom-mj-limb-rim" d="M50 114c0 14-2 26-6 38-2 8-2 14-1 20"/><path d="M50 114c0 14-2 26-6 38-2 8-2 14-1 20" fill="none" stroke="#07080a" stroke-width="12" stroke-linecap="round"/><path d="M43 164v18" stroke="#fff" stroke-width="8"/><g class="bom-mj-foot bom-mj-foot-left"><path class="bom-mj-rim" d="M37 178c11-3 22 1 29 9-10 6-28 6-39 1 1-5 4-8 10-10Z"/><path fill="#040507" d="M38 179c10-3 20 1 26 8-9 4-25 5-35 0 2-4 4-6 9-8Z"/><path d="M36 182c8-2 15-1 21 2" stroke="#727883" stroke-width="1.5" opacity=".65"/></g><g class="bom-mj-sparks bom-mj-sparks-left"><ellipse class="bom-mj-foot-glow" cx="44" cy="188" rx="18" ry="4"/><circle style="--spark-x:-13px;--spark-y:-11px" cx="40" cy="186" r="1.6"/><circle style="--spark-x:-7px;--spark-y:-18px" cx="42" cy="186" r="1.2"/><circle style="--spark-x:2px;--spark-y:-15px" cx="45" cy="187" r="1.4"/><circle style="--spark-x:10px;--spark-y:-10px" cx="47" cy="187" r="1.2"/><circle style="--spark-x:15px;--spark-y:-5px" cx="48" cy="188" r="1.1"/><circle style="--spark-x:-2px;--spark-y:-22px" cx="44" cy="187" r=".9"/></g></g>' +
          '<g class="bom-mj-leg bom-mj-leg-right"><path class="bom-mj-rim bom-mj-limb-rim" d="M68 114c-1 14 1 27 5 39 3 8 3 14 2 20"/><path d="M68 114c-1 14 1 27 5 39 3 8 3 14 2 20" fill="none" stroke="#08090b" stroke-width="12" stroke-linecap="round"/><path d="M75 164v18" stroke="#fff" stroke-width="8"/><g class="bom-mj-foot bom-mj-foot-right"><path class="bom-mj-rim" d="M69 178c11-2 23 2 30 9-9 6-28 7-39 1 1-5 4-8 9-10Z"/><path fill="#040507" d="M70 179c10-2 21 2 27 8-9 5-25 6-35 1 1-5 4-7 8-9Z"/><path d="M69 182c8-1 16 0 22 3" stroke="#737984" stroke-width="1.5" opacity=".65"/></g><g class="bom-mj-sparks bom-mj-sparks-right"><ellipse class="bom-mj-foot-glow" cx="76" cy="188" rx="18" ry="4"/><circle style="--spark-x:-14px;--spark-y:-8px" cx="72" cy="187" r="1.5"/><circle style="--spark-x:-8px;--spark-y:-17px" cx="74" cy="187" r="1.1"/><circle style="--spark-x:0px;--spark-y:-21px" cx="76" cy="187" r="1.3"/><circle style="--spark-x:8px;--spark-y:-15px" cx="78" cy="187" r="1.2"/><circle style="--spark-x:14px;--spark-y:-8px" cx="80" cy="188" r="1.1"/><circle style="--spark-x:5px;--spark-y:-24px" cx="77" cy="187" r=".9"/></g></g>' +
        '</g>' +
      '</svg></div>';
  }

  registry.set(BEATLES_MBID, { names: ["beatles"], markup: submarineMarkup, duration: 2800 });
  registry.set(ROLLING_STONES_MBID, { names: ["rollingstones"], markup: lipsMarkup, duration: 2050 });
  registry.set(DAVID_BOWIE_MBID, { names: ["davidbowie", "bowie"], markup: lightningMarkup, duration: 2050 });
  registry.set(OASIS_MBID, { names: ["oasis"], markup: bucketHatMarkup, duration: 2200 });
  registry.set(PINK_FLOYD_MBID, { names: ["pinkfloyd"], markup: prismMarkup, duration: 3000 });
  registry.set(MICHAEL_JACKSON_MBID, { names: ["michaeljackson"], markup: moonwalkMarkup, duration: 3400 });

  function installStyles() {
    if (document.getElementById("bomArtistEasterEggStyles")) return;
    const style = document.createElement("style");
    style.id = "bomArtistEasterEggStyles";
    style.textContent = `
      .bom-artist-egg-host{position:fixed;inset:0;z-index:45;overflow:hidden;pointer-events:none;contain:layout style paint}
      .bom-egg-submarine{position:absolute;left:-170px;bottom:max(88px,calc(env(safe-area-inset-bottom) + 72px));width:132px;animation:bom-sub-sail 2.8s ease-in-out forwards}
      .bom-egg-submarine svg{display:block;width:100%;filter:drop-shadow(0 5px 5px rgba(0,0,0,.28));animation:bom-sub-bob .55s ease-in-out infinite alternate}
      .bom-egg-bubble{position:absolute;right:2px;top:12px;width:10px;height:10px;border:2px solid #9be7fa;border-radius:50%;opacity:0;animation:bom-bubble 1.25s ease-out infinite}
      .bom-egg-bubble.b2{right:-14px;top:28px;width:7px;height:7px;animation-delay:.35s}.bom-egg-bubble.b3{right:-3px;top:39px;width:5px;height:5px;animation-delay:.7s}
      .bom-egg-lips{position:absolute;right:28px;bottom:max(96px,calc(env(safe-area-inset-bottom) + 80px));width:148px;transform-origin:55% 65%;animation:bom-lips-pop 2.05s cubic-bezier(.22,.75,.24,1) forwards}
      .bom-egg-lips img{display:block;width:100%;height:auto;filter:drop-shadow(0 6px 7px rgba(0,0,0,.32))}
      @keyframes bom-sub-sail{0%{transform:translate3d(0,0,0);opacity:0}8%{opacity:1}90%{opacity:1}100%{transform:translate3d(calc(100vw + 310px),0,0);opacity:0}}
      @keyframes bom-sub-bob{to{transform:translateY(-7px) rotate(1deg)}}
      @keyframes bom-bubble{0%{transform:translate(0,10px) scale(.5);opacity:0}20%{opacity:.9}100%{transform:translate(22px,-34px) scale(1.15);opacity:0}}
      @keyframes bom-lips-pop{0%{transform:translateY(12px) scale(.28) rotate(-5deg);opacity:0}12%{transform:translateY(-6px) scale(1.08) rotate(2deg);opacity:1}22%{transform:translateY(0) scale(.98) rotate(0)}38%{transform:translateY(-5px) scale(1.02) rotate(-6deg)}50%{transform:translateY(1px) rotate(6deg)}61%{transform:translateY(-3px) rotate(-3deg)}72%{transform:translateY(0) rotate(1deg);opacity:1}100%{transform:translateY(7px) scale(.9) rotate(0);opacity:0}}
      @media(max-width:600px){.bom-egg-submarine{width:105px;bottom:max(76px,calc(env(safe-area-inset-bottom) + 62px))}.bom-egg-lips{right:16px;width:116px;bottom:max(82px,calc(env(safe-area-inset-bottom) + 68px))}}
      .bom-egg-lightning{position:absolute;left:50%;top:max(64px,14vh);width:250px;opacity:0;transform:translate(-50%,-110vh);filter:drop-shadow(0 0 6px rgba(58,200,255,.62)) drop-shadow(0 0 9px rgba(244,30,65,.38));animation:bom-bowie-flash 2.05s cubic-bezier(.2,.72,.25,1) forwards}
      .bom-egg-lightning img,.bom-egg-hat svg,.bom-egg-prism svg{display:block;width:100%;height:auto}
      .bom-egg-hat{position:absolute;left:clamp(20px,8vw,110px);bottom:max(94px,calc(env(safe-area-inset-bottom) + 78px));width:138px;opacity:0;transform-origin:50% 80%;animation:bom-hat-drop 2.2s cubic-bezier(.22,.75,.25,1) forwards}
      .bom-egg-prism{position:absolute;right:clamp(22px,8vw,120px);bottom:max(98px,calc(env(safe-area-inset-bottom) + 82px));width:238px;opacity:0;animation:bom-prism-scene 3s ease-out forwards}
      .bom-prism-outline,.bom-prism-beam-in path,.bom-prism-spectrum path{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
      .bom-prism-outline{stroke:#fff;stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;filter:drop-shadow(0 0 3px rgba(255,255,255,.72));animation:bom-prism-draw 3s linear forwards}
      .bom-prism-beam-in path{stroke:#fff;stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1;filter:drop-shadow(0 0 3px rgba(255,255,255,.8));animation:bom-beam-enter 3s linear forwards}
      .bom-prism-spectrum path{stroke-width:3;stroke-dasharray:1;stroke-dashoffset:1;animation:bom-spectrum-spread 3s linear forwards}
      @keyframes bom-bowie-flash{0%{transform:translate(-50%,-110vh);opacity:.2}4%{opacity:1}20%{transform:translate(-50%,0);opacity:1}67%{transform:translate(-50%,0);opacity:1}71%{opacity:.58}75%{opacity:1}77%{transform:translate(-50%,0);opacity:1}100%{transform:translate(-50%,8px);opacity:0}}
      @keyframes bom-hat-drop{0%{transform:translateY(-55vh) rotate(-13deg);opacity:0}12%{opacity:1}38%{transform:translateY(0) rotate(4deg)}49%{transform:translateY(-22px) rotate(-7deg)}61%{transform:translateY(0) rotate(5deg)}75%{transform:translateY(4px) rotate(-2deg);opacity:1}100%{transform:translate(38px,34px) rotate(12deg);opacity:0}}
      @keyframes bom-prism-scene{0%,4%{opacity:0}8%,82%{opacity:1}100%{opacity:0}}
      @keyframes bom-prism-draw{0%,5%{stroke-dashoffset:1}36%,100%{stroke-dashoffset:0}}
      @keyframes bom-beam-enter{0%,36%{stroke-dashoffset:1}52%,100%{stroke-dashoffset:0}}
      @keyframes bom-spectrum-spread{0%,50%{stroke-dashoffset:1}70%,100%{stroke-dashoffset:0}}
      @media(max-width:600px){.bom-egg-lightning{left:50%;top:max(54px,12vh);width:176px}.bom-egg-hat{left:16px;width:108px;bottom:max(82px,calc(env(safe-area-inset-bottom) + 68px))}.bom-egg-prism{right:14px;width:190px;bottom:max(86px,calc(env(safe-area-inset-bottom) + 72px))}}
      .bom-egg-moonwalk{position:absolute;right:6vw;bottom:max(82px,calc(env(safe-area-inset-bottom) + 66px));width:120px;height:170px;opacity:0;animation:bom-mj-glide 3.4s linear forwards}
      .bom-egg-moonwalk svg{position:relative;z-index:1;display:block;width:94px;height:170px;margin:0 auto;overflow:visible}
      .bom-mj-spotlight{position:absolute;z-index:0;left:50%;bottom:-7px;width:120px;height:36px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(241,246,255,.24) 0,rgba(190,210,242,.1) 42%,transparent 72%);animation:bom-mj-spotlight 3.4s ease-in-out forwards}
      .bom-mj-leg{transform-box:fill-box;transform-origin:50% 2%}
      .bom-mj-foot{transform-box:fill-box;transform-origin:50% 55%}
      .bom-mj-leg-left{animation:bom-mj-leg-left 3.4s ease-in-out forwards}.bom-mj-leg-right{animation:bom-mj-leg-right 3.4s ease-in-out forwards}
      .bom-mj-foot-left{animation:bom-mj-foot-left 3.4s ease-in-out forwards}.bom-mj-foot-right{animation:bom-mj-foot-right 3.4s ease-in-out forwards}
      .bom-mj-hat{transform-box:fill-box;transform-origin:78% 90%;animation:bom-mj-hat-tip 3.4s ease-in-out forwards}
      .bom-mj-glove-arm{transform-box:fill-box;transform-origin:20% 10%;animation:bom-mj-glove-tip 3.4s ease-in-out forwards}
      .bom-mj-rim{fill:none;stroke:#aeb5c0;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:.5}
      .bom-mj-limb-rim{stroke-width:15;opacity:.28}
      .bom-mj-sparks circle{fill:#ffd45a;opacity:0;transform-box:fill-box;transform-origin:center}.bom-mj-sparks circle:nth-of-type(even){fill:#fff4c7}
      .bom-mj-foot-glow{fill:#ffc83d;opacity:0;filter:drop-shadow(0 0 3px rgba(255,194,43,.65))}
      .bom-mj-sparks-left circle{animation:bom-mj-spark-left 3.4s ease-out forwards}.bom-mj-sparks-right circle{animation:bom-mj-spark-right 3.4s ease-out forwards}
      .bom-mj-sparks-left .bom-mj-foot-glow{animation:bom-mj-glow-left 3.4s ease-out forwards}.bom-mj-sparks-right .bom-mj-foot-glow{animation:bom-mj-glow-right 3.4s ease-out forwards}
      @keyframes bom-mj-glide{0%{transform:translateX(0);opacity:0}8%{opacity:1}12%{transform:translateX(0);opacity:1}76%{transform:translateX(-55vw);opacity:1}88%{transform:translateX(-55vw);opacity:1}100%{transform:translateX(-55vw);opacity:0}}
      @keyframes bom-mj-spotlight{0%{opacity:0;transform:translateX(-50%) scale(.72)}12%,86%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) scale(.88)}}
      @keyframes bom-mj-leg-left{0%,12%,76%,100%{transform:rotate(-5deg) translateY(0)}20%{transform:rotate(9deg) translateY(-3px)}28%{transform:rotate(-7deg)}36%{transform:rotate(10deg) translateY(-3px)}44%{transform:rotate(-7deg)}52%{transform:rotate(9deg) translateY(-3px)}60%{transform:rotate(-7deg)}68%{transform:rotate(8deg) translateY(-2px)}}
      @keyframes bom-mj-leg-right{0%,12%,76%,100%{transform:rotate(8deg) translateY(-2px)}20%{transform:rotate(-7deg)}28%{transform:rotate(10deg) translateY(-3px)}36%{transform:rotate(-7deg)}44%{transform:rotate(9deg) translateY(-3px)}52%{transform:rotate(-7deg)}60%{transform:rotate(10deg) translateY(-3px)}68%{transform:rotate(-6deg)}}
      @keyframes bom-mj-foot-left{0%,12%,28%,44%,60%,76%,100%{transform:rotate(0) translateY(0)}20%,36%,52%,68%{transform:rotate(-17deg) translateY(-5px)}}
      @keyframes bom-mj-foot-right{0%,12%,28%,44%,60%,76%,100%{transform:rotate(-16deg) translateY(-5px)}20%,36%,52%,68%{transform:rotate(0) translateY(0)}}
      @keyframes bom-mj-hat-tip{0%,75%,89%,100%{transform:rotate(0) translate(0)}80%,85%{transform:rotate(13deg) translate(3px,-3px)}}
      @keyframes bom-mj-glove-tip{0%,74%,90%,100%{transform:rotate(0) translate(0)}80%,86%{transform:rotate(-68deg) translate(-10px,-3px)}}
      @keyframes bom-mj-spark-left{0%,18%,25%,34%,41%,50%,57%,66%,73%,100%{transform:translate(0);opacity:0}20%,36%,52%,68%{transform:translate(0);opacity:1}24%,40%,56%,72%{transform:translate(var(--spark-x),var(--spark-y));opacity:0}}
      @keyframes bom-mj-spark-right{0%,10%,17%,26%,33%,42%,49%,58%,65%,100%{transform:translate(0);opacity:0}12%,28%,44%,60%{transform:translate(0);opacity:1}16%,32%,48%,64%{transform:translate(var(--spark-x),var(--spark-y));opacity:0}}
      @keyframes bom-mj-glow-left{0%,18%,25%,34%,41%,50%,57%,66%,73%,100%{opacity:0}20%,36%,52%,68%{opacity:.28}24%,40%,56%,72%{opacity:0}}
      @keyframes bom-mj-glow-right{0%,10%,17%,26%,33%,42%,49%,58%,65%,100%{opacity:0}12%,28%,44%,60%{opacity:.28}16%,32%,48%,64%{opacity:0}}
      @media(max-width:600px){.bom-egg-moonwalk{right:3vw;width:98px;height:140px;bottom:max(72px,calc(env(safe-area-inset-bottom) + 58px))}.bom-egg-moonwalk svg{width:77px;height:140px}.bom-mj-spotlight{width:98px;height:30px}@keyframes bom-mj-glide{0%{transform:translateX(0);opacity:0}8%{opacity:1}12%{transform:translateX(0);opacity:1}76%{transform:translateX(-48vw);opacity:1}88%{transform:translateX(-48vw);opacity:1}100%{transform:translateX(-48vw);opacity:0}}}
    `;
    document.head.appendChild(style);
  }

  function cancel() {
    window.clearTimeout(cleanupTimer);
    cleanupTimer = 0;
    activeHost?.remove();
    activeHost = null;
  }

  function findEntry(artistId, artistName) {
    const stableId = String(artistId || "").trim().toLowerCase();
    if (registry.has(stableId)) return registry.get(stableId);
    const name = normaliseName(artistName);
    return [...registry.values()].find((entry) => entry.names.includes(name));
  }

  function play({ artistId = "", artistName = "" } = {}) {
    cancel();
    if (!ARTIST_EASTER_EGGS_ENABLED || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    const entry = findEntry(artistId, artistName);
    if (!entry) return false;
    installStyles();
    activeHost = document.createElement("div");
    activeHost.className = "bom-artist-egg-host";
    activeHost.setAttribute("aria-hidden", "true");
    activeHost.innerHTML = entry.markup();
    document.body.appendChild(activeHost);
    cleanupTimer = window.setTimeout(cancel, entry.duration + 150);
    return true;
  }

  window.BOMArtistEasterEggs = Object.freeze({ play, cancel });
})();
