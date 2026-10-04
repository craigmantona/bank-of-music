import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadEdge } from "./helpers.mjs";

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const source = readFileSync(
  new URL("../functions/admin-catalogue/index.ts", import.meta.url),
  "utf8"
);

function request(action, extra = {}) {
  return new Request("https://project.invalid/functions/v1/admin-catalogue", {
    method: "POST",
    headers: {
      Origin: "https://thebankofmusic.com",
      Authorization: "Bearer user-session",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, ...extra })
  });
}

function loadHandler({ authorization, rpcResult = { data: { status: "preview" }, error: null } }) {
  let handler;
  const rpcCalls = [];
  let clientCount = 0;
  const context = loadEdge(source.replace(/^export /gm, ""), {
    Deno: {
      env: { get: () => "test-only" },
      serve: value => { handler = value; }
    },
    getAdminKey: () => "service-key",
    requireAdminUser: async () => authorization,
    createClient: () => {
      clientCount += 1;
      if (clientCount === 1) return {};
      return {
        rpc: async (name, params) => {
          rpcCalls.push({ name, params });
          return rpcResult;
        }
      };
    }
  });
  return { handler, rpcCalls, context };
}

test("unauthenticated and ordinary users are rejected before the conversion RPC", async () => {
  for (const [status, message] of [[401, "Authentication required"], [403, "Admin access required"]]) {
    const { handler, rpcCalls } = loadHandler({
      authorization: {
        ok: false,
        response: Response.json({ error: message }, { status })
      }
    });
    const response = await handler(request("convert_definitely_maybe_preview"));
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, message);
    assert.deepEqual(rpcCalls, []);
  }
});

test("admin preview invokes only the hard-coded conversion RPC and ignores caller target data", async () => {
  const { handler, rpcCalls } = loadHandler({ authorization: { ok: true } });
  const response = await handler(request("convert_definitely_maybe_preview", {
    album_id: 999,
    song_ids: [1, 2, 3],
    p_execute: true,
    conversion: { release_id: "caller-controlled" }
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    conversion: { status: "preview" }
  });
  assert.deepEqual(plain(rpcCalls), [{
    name: "admin_convert_definitely_maybe",
    params: { p_execute: false }
  }]);
});

test("admin execution sets only the fixed RPC execute flag", async () => {
  const { handler, rpcCalls } = loadHandler({
    authorization: { ok: true },
    rpcResult: { data: { status: "converted", album_id: 6 }, error: null }
  });
  const response = await handler(request("convert_definitely_maybe", { album_id: 999 }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    conversion: { status: "converted", album_id: 6 }
  });
  assert.deepEqual(plain(rpcCalls), [{
    name: "admin_convert_definitely_maybe",
    params: { p_execute: true }
  }]);
});

test("RPC guard failure is returned without any follow-up operation", async () => {
  const { handler, rpcCalls } = loadHandler({
    authorization: { ok: true },
    rpcResult: {
      data: null,
      error: { message: "Definitely Maybe source tracks have changed; conversion aborted" }
    }
  });
  const response = await handler(request("convert_definitely_maybe"));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Definitely Maybe source tracks have changed; conversion aborted"
  });
  assert.deepEqual(plain(rpcCalls), [{
    name: "admin_convert_definitely_maybe",
    params: { p_execute: true }
  }]);
});
