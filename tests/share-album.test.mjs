import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../bom-foundation.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const shareStart = app.indexOf("async function shareSelectedItem");
const shareEnd = app.indexOf("async function handleIncomingShareLink", shareStart);
const shareSource = app.slice(shareStart, shareEnd);

function harness({ nativeShare, clipboard } = {}) {
  const status = { textContent: "", classList: { toggle() {} } };
  const context = {
    selectedItem: { type: "album", title: "Blue", artist: "Joni Mitchell", savedAlbumId: 42 },
    globalSearchMessage: {},
    navigator: {},
    document: { querySelector: () => status },
    setMessage: (_target, message) => { context.lastMessage = message; },
    getItemDeepLinkUrl: () => "https://bankofmusic.app/?share=album&albumId=42",
    prompt: (message, value) => { context.promptCall = [message, value]; }
  };
  if (nativeShare) context.navigator.share = nativeShare;
  if (clipboard) context.navigator.clipboard = { writeText: clipboard };
  vm.runInNewContext(shareSource, context);
  return { context, status };
}

test("album action uses native share with the existing deep link", async () => {
  let payload;
  const { context } = harness({ nativeShare: async value => { payload = value; } });
  await context.shareSelectedItem();
  assert.equal(payload.url, "https://bankofmusic.app/?share=album&albumId=42");
  assert.match(payload.title, /Rate Blue/);
});

test("copy-link fallback copies only the stable album deep link", async () => {
  let copied;
  const { context, status } = harness({ clipboard: async value => { copied = value; } });
  await context.shareSelectedItem();
  assert.equal(copied, "https://bankofmusic.app/?share=album&albumId=42");
  assert.equal(context.lastMessage, "Share link copied.");
  assert.equal(status.textContent, "Share link copied.");
});

test("failed native share falls back to copy and denied clipboard falls back to prompt", async () => {
  const { context } = harness({
    nativeShare: async () => { throw new Error("unavailable"); },
    clipboard: async () => { throw new Error("denied"); }
  });
  await context.shareSelectedItem();
  assert.equal(context.promptCall[1], "https://bankofmusic.app/?share=album&albumId=42");
});

test("album detail exposes a prominent responsive Share album action", () => {
  assert.match(app, /#shareSelectedItemBtn[\s\S]*await shareSelectedItem\(\)/);
  assert.match(app, /shareControlHtml: buildSelectedSharePanel\(selectedItem\)\.replace\(">Send<", ">Share album<"\)/);
  assert.match(css, /#shareSelectedItemBtn \{[^}]*background: var\(--bom-v1-accent\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*#shareSelectedItemBtn \{ width: 100%/);
  assert.match(html, /bom-foundation\.css\?v=48/);
  assert.match(html, /app\.js\?v=179/);
});
