(function initialiseBOMArtistHeroPolicy() {
  "use strict";

  const allowedTypes = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
  const maxBytes = 5 * 1024 * 1024;

  function validateFile(file) {
    if (!file || !allowedTypes.includes(file.type)) return "Choose a JPEG, PNG or WebP image.";
    if (Number(file.size || 0) > maxBytes) return "Artist hero images must be 5 MB or smaller.";
    return "";
  }

  function fitForDimensions(width, height) {
    const ratio = Number(width || 0) / Math.max(Number(height || 0), 1);
    const heroFit = ratio >= 1.25 && ratio <= 2.6 ? "cover" : "contain";
    return { heroFit, heroPosition: heroFit === "cover" ? "center 32%" : "center" };
  }

  async function select(manualHero, automaticResolver) {
    if (manualHero?.url) return manualHero;
    return await automaticResolver();
  }

  window.BOMArtistHeroPolicy = Object.freeze({ allowedTypes, maxBytes, validateFile, fitForDimensions, select });
})();
