import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../artist-easter-eggs.js", import.meta.url), "utf8");

function createHarness(reducedMotion = false) {
  const byId = new Map();
  const children = [];
  const timers = new Map();
  let nextTimer = 0;
  const createElement = (tagName) => ({
    tagName,
    id: "",
    className: "",
    innerHTML: "",
    setAttribute() {},
    remove() {
      const index = children.indexOf(this);
      if (index >= 0) children.splice(index, 1);
      if (this.id) byId.delete(this.id);
    }
  });
  const document = {
    createElement,
    getElementById: (id) => byId.get(id) || null,
    head: { appendChild(node) { if (node.id) byId.set(node.id, node); } },
    body: { appendChild(node) { children.push(node); } }
  };
  const window = {
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(source, { window, document });
  return {
    api: window.BOMArtistEasterEggs,
    children,
    runTimers() { for (const callback of [...timers.values()]) callback(); timers.clear(); }
  };
}

{
  const { api, children } = createHarness();
  assert.equal(api.play({ artistId: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", artistName: "Wrong name" }), true);
  assert.match(children[0].innerHTML, /data-bom-artist-egg="beatles"/);
  assert.equal(api.play({ artistId: "b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d" }), true, "reopening the same item starts a fresh animation");
  assert.equal(children.length, 1);
  assert.equal(api.play({ artistId: "b071f9fa-14b0-4217-8e97-eb41da73f598" }), true);
  assert.equal(children.length, 1, "a rapid eligible selection replaces the active animation");
  assert.match(children[0].innerHTML, /data-bom-artist-egg="rolling-stones"/);
  assert.match(children[0].innerHTML, /assets\/rolling-stones-easter-egg\.png/);
  assert.doesNotMatch(children[0].innerHTML, /<svg/);
  assert.equal(api.play({ artistName: "The Beatles" }), true, "name fallback supports asynchronously-resolved records");
  assert.equal(children.length, 1);
  assert.equal(api.play({ artistName: "Unrelated Artist" }), false);
  assert.equal(children.length, 0, "an ineligible selection clears any previous animation");
}

{
  const { api, children, runTimers } = createHarness();
  const artists = [
    ["5441c29d-3602-4898-b1a1-b77fa23b8e50", "david-bowie"],
    ["39ab1aed-75e0-4140-bd47-540276886b60", "oasis"],
    ["83d91898-7763-47d7-b03b-b92132375c47", "pink-floyd"],
    ["f27ec8db-af05-4f36-916e-3d57f91ecf5e", "michael-jackson"]
  ];
  for (const [artistId, marker] of artists) {
    assert.equal(api.play({ artistId }), true, `${marker} resolves from its MusicBrainz ID`);
    assert.equal(children.length, 1, "rapid artist navigation keeps only one animation host");
    assert.match(children[0].innerHTML, new RegExp(`data-bom-artist-egg="${marker}"`));
  }
  assert.match(children[0].innerHTML, /bom-mj-leg-left/);
  assert.match(children[0].innerHTML, /bom-mj-leg-right/);
  assert.match(children[0].innerHTML, /bom-mj-foot-left/);
  assert.match(children[0].innerHTML, /bom-mj-hat/);
  assert.match(children[0].innerHTML, /bom-mj-glove-arm/);
  assert.match(children[0].innerHTML, /bom-mj-rim/);
  assert.match(children[0].innerHTML, /bom-mj-leg-left[\s\S]*bom-mj-sparks-left/,
    "left sparks remain inside the articulated left leg group");
  assert.match(children[0].innerHTML, /bom-mj-leg-right[\s\S]*bom-mj-sparks-right/,
    "right sparks remain inside the articulated right leg group");
  assert.equal((children[0].innerHTML.match(/--spark-x/g) || []).length, 12,
    "each foot has a restrained six-particle burst");
  assert.match(source, /bom-mj-spark-left[\s\S]*20%,36%,52%,68%/);
  assert.match(source, /bom-mj-spark-right[\s\S]*12%,28%,44%,60%/);
  assert.match(source, /@media\(max-width:600px\)[\s\S]*bom-egg-moonwalk/);
  assert.equal(api.play({ artistName: "Michael Jackson" }), true, "Michael Jackson retains normalized-name fallback");
  assert.equal(api.play({ artistName: "Michael Jackson" }), true, "repeat selections restart the moonwalk");
  assert.equal(children.length, 1);
  runTimers();
  assert.equal(children.length, 0, "completion timer removes the animation host");
}

{
  const { api, children } = createHarness(true);
  assert.equal(api.play({ artistName: "The Beatles" }), false);
  assert.equal(api.play({ artistName: "Michael Jackson" }), false);
  assert.equal(children.length, 0, "reduced-motion users receive no animation elements");
}

console.log("Artist Easter Eggs focused checks passed.");
