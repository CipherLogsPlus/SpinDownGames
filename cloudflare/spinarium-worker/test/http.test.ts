import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, readBytes, readJson } from "../src/http";
import { createHarness } from "./support";

test("a disabled backend accepts neither preview credentials nor forged account headers", async () => {
  const h = await createHarness({ AUTH_ENABLED: "false" });
  try {
    for (const path of ["/api/auth/login", "/api/auth/signup", "/api/auth/session", "/api/dashboard", "/api/admin/veilings"]) {
      const response = await h.fetch(path, {
        headers: { Authorization: "Basic YWRtaW46MTIzNA==", "X-User-Id": "admin", "X-Role": "admin" },
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.deepEqual(await (await h.fetch("/api/health")).json(), {
      service: "spinarium", accountsEnabled: false, claimsEnabled: false,
    });
  } finally { await h.mf.dispose(); }
});

test("API access is bound to the configured origin and unsupported authority routes stay absent", async () => {
  const h = await createHarness();
  try {
    const wrongHost = await h.mf.dispatchFetch("https://untrusted.test/api/dashboard");
    assert.equal(wrongHost.status, 403);
    for (const path of ["/api/claims", "/api/ownerships", "/api/admin/grant", "/api/production", "/api/invohub"]) {
      const response = await h.fetch(path, { method: "POST" });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    }
    assert.equal((await h.fetch("/api/dashboard", { method: "OPTIONS", headers: { Origin: "https://untrusted.test" } })).status, 401);
  } finally { await h.mf.dispose(); }
});

test("streamed request limits cannot be bypassed by omitting Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://spinarium.test/api/admin/veilings", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readBytes(request, 10), (error) => error instanceof HttpError && error.status === 413);
  assert.equal(cancelled, true);
});

test("JSON mutation input rejects form posts, malformed JSON and invalid UTF-8", async () => {
  for (const [contentType, body, status] of [
    ["text/plain", "{}", 415],
    ["application/json", "{broken", 400],
    ["application/json", new Uint8Array([0xc0, 0xaf]), 400],
  ] as const) {
    const request = new Request("https://spinarium.test/api/admin/veilings", { method: "POST", headers: { "Content-Type": contentType }, body });
    await assert.rejects(readJson(request), (error) => error instanceof HttpError && error.status === status);
  }
});
