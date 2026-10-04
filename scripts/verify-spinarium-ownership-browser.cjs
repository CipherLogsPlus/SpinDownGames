// Local browser contracts only: every account/ownership API is intercepted.
// No live accounts, grants, claims, or database fixtures are created.
// NODE_PATH=/tmp/spindown-qa/node_modules node scripts/verify-spinarium-ownership-browser.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = (process.env.BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Run these intercepted fixtures against a local server only.");
const browserPath = process.env.BROWSER_PATH || undefined;
const fixtureCookie = "ownership-browser-test-only-cookie";
const fixtureCsrf = "ownership_browser_test_only_csrf_1234567890";
const fixturePassword = "Ownership-test-only-password42!";
const introKey = "spinarium.preview.introduction.v3";
const screenshotDir = process.env.SCREENSHOT_DIR || null;
const testFilter = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER) : null;
const secret = "PRIVATE_BACKEND_RECORD_DETAIL_MUST_NOT_RENDER";
const id = (prefix, number) => `${prefix}0000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const user = {
  id: id("a", 1), displayName: "Ownership Browser Collector", email: "ownership@example.test",
  memberSince: "2026-01-01T12:00:00Z",
};
const veilings = [
  { id: id("b", 1), name: "Fixture Twin Echo", number: null },
  { id: id("b", 2), name: "Fixture Middle Lantern", number: 207 },
  { id: id("b", 3), name: "Fixture Early Beacon", number: 3 },
].map((item) => ({
  ...item, type: null, origin: null, editionIds: [], artwork: [],
  lore: [{ id: `lore-${item.id}`, locale: "en", title: "Fixture story", preview: "Local test fixture.",
    text: `Test-only collection story for ${item.name}.`, status: "published", version: 1 }],
  releaseDate: null, contentStatus: "published",
}));
const records = [
  { id: id("c", 1), veilingId: veilings[0].id, acquiredAt: "2026-01-01T12:00:00Z" },
  { id: id("c", 2), veilingId: veilings[0].id, acquiredAt: "2026-09-30T12:00:00Z" },
  { id: id("c", 3), veilingId: veilings[1].id, acquiredAt: "2026-06-15T12:00:00Z" },
  { id: id("c", 4), veilingId: veilings[2].id, acquiredAt: "2026-03-15T12:00:00Z" },
].map((record) => ({ ...record, userId: user.id, acquisition: "server_grant", physicalCardId: null, editionId: "", variantId: "" }));
const snapshot = {
  schemaVersion: "1", mode: "live",
  profile: { id: user.id, displayName: user.displayName, memberSince: user.memberSince, avatarSrc: null },
  veilings, ownerships: records, series: [], editions: [], variants: [], rarities: [], physicalCards: [],
  discoveries: veilings.map((veiling) => ({ veilingId: veiling.id, status: "revealed", firstDiscoveredAt: "2026-01-01T12:00:00Z",
    firstDiscovererId: null, publicDiscovererName: null, revealKind: "launch" })),
  achievements: [], userAchievements: [], collections: [], news: [], events: [],
};
function dashboardProjection(unavailableVeilings, publishedArtworkVeiling) {
  return {
    ...snapshot,
    veilings: veilings.map((veiling) => unavailableVeilings.has(veiling.id) ? {
      id: veiling.id, number: null, name: null, type: null, origin: null,
      editionIds: [], artwork: [], lore: [], releaseDate: null, contentStatus: "unavailable",
    } : publishedArtworkVeiling === veiling.id ? { ...veiling, artwork: [{
      id: id("e", 1), role: "color_art", url: `/api/artwork/${id("e", 1)}`,
      alt: "Local test fixture artwork", variantId: null, status: "approved",
    }] } : veiling),
    discoveries: snapshot.discoveries.filter((discovery) => !unavailableVeilings.has(discovery.veilingId)),
  };
}
function ownershipProjection(recordId, unavailableVeilings) {
  const record = records.find((item) => item.id === recordId);
  if (!record) return null;
  const veiling = veilings.find((item) => item.id === record.veilingId);
  return {
    schemaVersion: "1", mode: "live",
    ownership: { id: record.id, userId: record.userId, veilingId: record.veilingId,
      acquisition: record.acquisition, acquiredAt: record.acquiredAt, physicalCardId: null },
    veiling: unavailableVeilings.has(veiling.id)
      ? { id: veiling.id, number: null, name: null, description: null, artworkUrl: null, contentStatus: "unavailable" }
      : { id: veiling.id, number: veiling.number, name: veiling.name,
        description: veiling.lore[0].text, artworkUrl: null, contentStatus: "published" },
  };
}
function deferredRecord() {
  let release, requested, finished;
  return {
    wait: new Promise((resolve) => { release = resolve; }),
    requested: new Promise((resolve) => { requested = resolve; }),
    finished: new Promise((resolve) => { finished = resolve; }),
    release: () => release(), markRequested: () => requested(), markFinished: () => finished(),
  };
}
async function waitForSignal(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for an intercepted record request.")), 10000); })]); }
  finally { clearTimeout(timer); }
}
async function fixture(browser, { hash = "collection?filter=owned", width = 1280, signedIn = true, missingArtwork = false, publishedArtworkVeiling = null, dashboardHolds = [] } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  try {
  const state = { signedIn, unavailableVeilings: new Set(), failures: new Map(), held: new Map(), dashboardHolds, dashboardReads: 0, requests: [], errors: [], fixtureErrors: [] };
  // The retained ribbon intro has separate baseline coverage. Its presentation
  // preference grants no account or ownership access in these focused fixtures.
  await context.addInitScript((key) => localStorage.setItem(key, "seen"), introKey);
  if (signedIn) await context.addCookies([{ name: "spinarium_session", value: fixtureCookie, url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.route("**/spinarium/config.js*", (route) => route.fulfill({ status: 200, contentType: "text/javascript",
    body: 'export const spinariumConfig = Object.freeze({ previewEnabled:false, backend:"cloudflare", authProvider:"password", apiBase:"/api", signupEnabled:false });' }));
  await context.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), headers = request.headers();
    state.requests.push({ path: url.pathname, method: request.method(), url: request.url(),
      authorization: headers.authorization || null, cookie: headers.cookie || "", body: request.postData() });
    const respond = (value, status = 200, responseHeaders = {}) => route.fulfill({ status,
      contentType: "application/json", headers: { "cache-control": "no-store", ...responseHeaders }, body: JSON.stringify(value) });
    if (url.pathname === "/api/auth/session" && request.method() === "GET")
      return state.signedIn
        ? respond({ user, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() })
        : respond({ code: "UNAUTHORIZED" }, 401);
    if (url.pathname === "/api/auth/login" && request.method() === "POST") {
      assert.deepEqual(request.postDataJSON(), { email: user.email, password: fixturePassword });
      state.signedIn = true;
      return respond({ user, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 200,
        { "set-cookie": `spinarium_session=${fixtureCookie}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (url.pathname === "/api/auth/logout" && request.method() === "POST") {
      assert.equal(headers["x-csrf-token"], fixtureCsrf);
      assert.equal(request.postData(), "{}");
      state.signedIn = false;
      return respond({ signedOut: true }, 200, { "set-cookie": "spinarium_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    }
    if (!state.signedIn) return respond({ code: "UNAUTHORIZED" }, 401);
    assert(headers.cookie?.includes(fixtureCookie), "Collection reads must carry the cookie session.");
    if (url.pathname === "/api/dashboard" && request.method() === "GET") {
      // Capture server content at request time so a delayed active response can
      // genuinely arrive after a newer unavailable ownership response.
      const projection = dashboardProjection(state.unavailableVeilings, publishedArtworkVeiling);
      const hold = state.dashboardHolds[state.dashboardReads++];
      if (hold) { hold.markRequested(); await hold.wait; }
      try { return await respond(projection); }
      finally { hold?.markFinished(); }
    }
    if (url.pathname === "/api/admin/access" && request.method() === "GET") return respond({ admin: false, role: null });
    if (missingArtwork && url.pathname === `/api/artwork/${id("e", 1)}` && request.method() === "GET")
      return respond({ code: "NOT_FOUND" }, 404);
    if (publishedArtworkVeiling && url.pathname === `/api/artwork/${id("e", 1)}` && request.method() === "GET") {
      if (state.unavailableVeilings.has(publishedArtworkVeiling)) return respond({ code: "NOT_FOUND" }, 404);
      return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" },
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUc0thYGBgYmBgYGBgAAAJRADMgBbzgwAAAABJRU5ErkJggg==", "base64") });
    }
    const recordMatch = /^\/api\/ownerships\/([^/]+)$/.exec(url.pathname);
    if (recordMatch && request.method() === "GET") {
      const recordId = recordMatch[1], hold = state.held.get(recordId);
      if (hold) { state.held.delete(recordId); hold.markRequested(); await hold.wait; }
      try {
        if (state.failures.get(recordId)) {
          state.failures.set(recordId, state.failures.get(recordId) - 1);
          return await respond({ code: "UNAVAILABLE", message: secret }, 503);
        }
        const projection = ownershipProjection(recordId, state.unavailableVeilings);
        if (projection && projection.veiling.contentStatus === "published" &&
          (missingArtwork || projection.veiling.id === publishedArtworkVeiling)) projection.veiling.artworkUrl = `/api/artwork/${id("e", 1)}`;
        return await respond(projection || { code: "NOT_FOUND", message: secret }, projection ? 200 : 404);
      } catch (error) {
        // Changing route or signing out may abort the held fetch before release.
        if (!request.failure() && !/closed|cancel|abort/i.test(error.message)) state.fixtureErrors.push(error.message);
      } finally { hold?.markFinished(); }
      return;
    }
    state.fixtureErrors.push(`Unexpected test-only API: ${request.method()} ${url.pathname}`);
    return respond({ code: "UNEXPECTED_FIXTURE_ENDPOINT" }, 500);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.goto(`${base}/spinarium/#${hash}`, { waitUntil: "load", timeout: 30000 });
  await page.bringToFront();
  if (signedIn) await page.waitForFunction(() => !document.body.classList.contains("auth-gated"));
  else await page.waitForSelector("#auth-view:not([hidden])");
  await page.evaluate(() => document.fonts.ready);
  return { context, page, state };
  } catch (error) {
    await context.close();
    throw error;
  }
}
async function withFixture(browser, options, run) {
  const current = await fixture(browser, options);
  try {
    await run(current);
    assert.deepEqual(current.state.errors, [], "Unexpected page errors.");
    assert.deepEqual(current.state.fixtureErrors, [], "Unexpected API fixture behavior.");
    assert(current.state.requests.every((request) => !request.authorization), "Browser read requests must not carry bearer tokens.");
    assert(current.state.requests.every((request) => !request.url.includes(fixtureCookie) && !request.url.includes(fixtureCsrf)), "Credentials must not appear in URLs.");
    assert(current.state.requests.every((request) => request.method === "GET" || ["/api/auth/login", "/api/auth/logout"].includes(request.path)), "Ownership browsing must not mutate records.");
    assert.deepEqual(await current.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })),
      { local: { [introKey]: "seen" }, session: {}, cookie: "" }, "Only the baseline presentation preference may be browser-readable; private identity and ownership must not be stored there.");
  } finally {
    for (const held of current.state.held.values()) held.release();
    for (const held of current.state.dashboardHolds) held.release();
    await current.context.close();
  }
}
const recordPath = (recordId) => `/api/ownerships/${recordId}`;
const recordHref = (recordId) => `#ownership/${recordId}`;
async function navigate(page, hash) {
  await page.evaluate((next) => { location.hash = next; }, hash);
}
async function waitCollection(page) {
  await page.waitForSelector("#dashboard-view:not([hidden])");
  await page.waitForSelector("#collection-grid [data-card-id]");
}
async function waitRecord(page, recordId) {
  await page.waitForSelector("#route-content .ownership-record-page");
  await page.waitForFunction((id) => document.querySelector("#route-content .ownership-record-page")?.textContent.includes(id), recordId);
}
const cardIds = (page) => page.locator("#collection-grid [data-card-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.cardId));
async function checkAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
  assert.deepEqual(result.violations.map((item) => ({ id: item.id, impact: item.impact, targets: item.nodes.map((node) => node.target) })), []);
}
async function checkOverflow(page, width, scale = 100) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%`; }, scale);
  const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(bounds.document <= bounds.viewport + 1, `Overflow at ${width}px/${scale}%: ${JSON.stringify(bounds)}`);
}
let passed = 0;
const issues = [];
async function test(name, run) {
  if (testFilter && !testFilter.test(name)) return;
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { issues.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.stack || error.message}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
  try {
    await test("each owned copy exposes its complete record ID and acquisition date", () => withFixture(browser, {}, async ({ page }) => {
      await waitCollection(page);
      assert.equal(await page.locator("#collection-grid [data-card-id]").count(), 3, "Multiple copies remain grouped by Veiling.");
      await page.locator(`[data-card-id="${veilings[0].id}"]`).click();
      const list = page.locator("#detail-panel .ownership-list");
      assert.equal(await list.locator(".ownership-record-link").count(), 2);
      for (const record of records.slice(0, 2)) {
        assert((await list.innerText()).includes(record.id), "Every record ID must be complete.");
        assert.equal(await list.locator(`a[href="${recordHref(record.id)}"]`).count(), 1);
      }
      assert.match(await list.innerText(), /Jan 1, 2026/);
      assert.match(await list.innerText(), /Sep 30, 2026/);
      assert.equal(await page.locator(`[data-card-id="${veilings[0].id}"] .card-number`).innerText(), "—");
      assert.equal(await page.locator("#detail-panel img").count(), 0, "Missing artwork must not invent a creature.");
      await list.locator(`a[href="${recordHref(records[1].id)}"]`).click();
      await waitRecord(page, records[1].id);
      assert(!(await page.locator("#route-content").innerText()).includes(records[0].id), "A record route must show the selected copy only.");
    }));
    await test("search finds a grouped Veiling by its second ownership record ID", () => withFixture(browser, {}, async ({ page }) => {
      await waitCollection(page);
      assert.equal(await page.locator("#collection-search").getAttribute("placeholder"), "Search collection…");
      assert((await page.locator("#collection-search").getAttribute("aria-describedby")).split(/\s+/).includes("collection-search-help"));
      assert(await page.locator("#collection-search-help").isVisible());
      assert.match(await page.locator("#collection-search-help").innerText(), /name, number, or record ID/i);
      await page.locator("#collection-search").fill(records[1].id.toUpperCase());
      assert.deepEqual(await cardIds(page), [veilings[0].id]);
      assert(await page.locator("#collection-search-help").isVisible(), "Search guidance must remain visible after typing.");
      await page.locator("#collection-search").fill("Middle Lantern");
      assert.deepEqual(await cardIds(page), [veilings[1].id]);
      await page.locator("#collection-search").fill("207");
      assert.deepEqual(await cardIds(page), [veilings[1].id]);
    }));
    await test("newest and oldest acquisition sorts use all ownership records in each group", () => withFixture(browser, {}, async ({ page }) => {
      await waitCollection(page);
      await page.locator("#collection-sort").selectOption("acquired-newest");
      assert.deepEqual(await cardIds(page), [veilings[0].id, veilings[1].id, veilings[2].id]);
      await page.locator("#collection-sort").selectOption("acquired-oldest");
      assert.deepEqual(await cardIds(page), [veilings[0].id, veilings[2].id, veilings[1].id]);
    }));
    await test("direct record links and reload retrieve the exact copy without requiring prior selection", () => withFixture(browser, { hash: recordHref(records[1].id).slice(1) }, async ({ page, state }) => {
      await waitRecord(page, records[1].id);
      const content = page.locator("#route-content");
      assert.match(await content.innerText(), /Ownership record/);
      assert((await content.innerText()).includes(veilings[0].name));
      assert.match(await content.innerText(), /Sep 30, 2026/);
      assert.equal(await content.locator("img").count(), 0);
      assert.match(await content.innerText(), /Number not recorded/i);
      assert.doesNotMatch(await content.innerText(), /\bnull\b/i);
      assert.doesNotMatch(await content.innerText(), /Veiling\s*\/\/\s*000\b/);
      const calls = state.requests.filter((request) => request.path === recordPath(records[1].id)).length;
      await page.reload({ waitUntil: "load" });
      await waitRecord(page, records[1].id);
      assert.equal(state.requests.filter((request) => request.path === recordPath(records[1].id)).length, calls + 1);
      await content.locator('a[href="#collection?filter=owned"]').click();
      await waitCollection(page);
    }));
    await test("an owned record survives an active-to-draft transition with unavailable details", () => withFixture(browser,
      { hash: recordHref(records[2].id).slice(1), publishedArtworkVeiling: veilings[1].id }, async ({ page, state }) => {
        const record = records[2], veiling = veilings[1];
        const neutral = "Veiling details are currently unavailable.";
        await waitRecord(page, record.id);
        assert((await page.locator("#route-content").innerText()).includes(veiling.name));
        assert.match(await page.locator("#route-content").innerText(), /207/);
        await page.waitForFunction(() => document.querySelector("#route-content .ownership-artwork")?.naturalWidth > 0);
        await page.locator('#route-content a[href="#collection?filter=owned"]').click();
        await waitCollection(page);
        await page.locator(`[data-card-id="${veiling.id}"]`).click();
        assert((await page.locator("#detail-panel").innerText()).includes(veiling.name));

        // Change only intercepted server state. The cached active dashboard
        // must be redacted after a fresh detail read, without a page reload.
        state.unavailableVeilings.add(veiling.id);
        const transitionRequestIndex = state.requests.length;
        await page.locator(`#detail-panel a[href="${recordHref(record.id)}"]`).click();
        await waitRecord(page, record.id);
        assert.equal(new URL(page.url()).hash, recordHref(record.id));
        assert.equal(await page.locator("#route-content .ownership-description").textContent(), neutral);
        assert.match(await page.locator("#route-content").innerText(), /Jun 15, 2026/);
        assert.equal(await page.locator("#route-content .ownership-id").textContent(), record.id);
        const noHiddenContent = async () => {
          const text = await page.locator("body").textContent();
          assert(!text.includes(veiling.name), "Unpublished names must not remain in the DOM.");
          assert(!text.includes(veiling.lore[0].text), "Unpublished lore must not remain in the DOM.");
          assert.doesNotMatch(text, /\b207\b/, "An unavailable character number must be hidden.");
          assert.equal(await page.locator('img[src*="/api/artwork/"]').count(), 0, "Cached unpublished artwork must be removed from all views.");
        };
        await noHiddenContent();
        await page.locator('#route-content a[href="#collection?filter=owned"]').click();
        await waitCollection(page);
        assert.equal(await page.locator("#collection-grid [data-card-id]").count(), 3, "The owned Veiling must remain in the collection.");
        assert.equal(await page.locator("#stats .stat-card strong").first().textContent(), "3");
        await page.locator("#collection-search").fill(record.id.toUpperCase());
        assert.deepEqual(await cardIds(page), [veiling.id], "The record must remain findable by its full ID.");
        await page.locator(`[data-card-id="${veiling.id}"]`).click();
        assert.equal(await page.locator("#detail-panel .detail-quote").textContent(), neutral);
        assert.equal(await page.locator("#detail-panel .ownership-record-link").count(), 1);
        assert.equal(await page.locator("#detail-panel .ownership-id").textContent(), record.id);
        assert.match(await page.locator("#detail-panel .ownership-list").innerText(), /Jun 15, 2026/);
        await noHiddenContent();
        await page.locator(`#detail-panel a[href="${recordHref(record.id)}"]`).click();
        await waitRecord(page, record.id);
        assert.equal(new URL(page.url()).hash, recordHref(record.id));
        assert.equal(await page.locator("#route-content .ownership-description").textContent(), neutral);
        await noHiddenContent();
        await page.reload({ waitUntil: "load" });
        await waitRecord(page, record.id);
        assert.equal(new URL(page.url()).hash, recordHref(record.id));
        assert.equal(await page.locator("#route-content .ownership-description").textContent(), neutral);
        assert.equal(await page.locator("#route-content .ownership-id").textContent(), record.id);
        assert.match(await page.locator("#route-content").innerText(), /Jun 15, 2026/);
        await noHiddenContent();
        assert(!state.requests.slice(transitionRequestIndex).some((request) => request.path.startsWith("/api/artwork/")), "Unavailable definitions must make no artwork request.");
        if (screenshotDir) {
          fs.mkdirSync(screenshotDir, { recursive: true });
          await page.screenshot({ path: path.join(screenshotDir, "ownership-record-unavailable.png"), fullPage: true });
        }
      }));
    await test("an older dashboard response cannot restore details hidden by a newer ownership response", async () => {
      const first = deferredRecord(), second = deferredRecord();
      await withFixture(browser, { hash: "dashboard", dashboardHolds: [first, second], publishedArtworkVeiling: veilings[1].id }, async ({ page, state }) => {
        const record = records[2], veiling = veilings[1];
        await waitForSignal(first.requested);
        await navigate(page, "collection?filter=owned");
        await waitForSignal(second.requested);
        first.release();
        await waitForSignal(first.finished);
        await waitCollection(page);
        await page.locator(`[data-card-id="${veiling.id}"]`).click();
        assert((await page.locator("#detail-panel").innerText()).includes(veiling.name));
        state.unavailableVeilings.add(veiling.id);
        await page.locator(`#detail-panel a[href="${recordHref(record.id)}"]`).click();
        await waitRecord(page, record.id);
        assert.equal(await page.locator("#route-content .ownership-description").textContent(), "Veiling details are currently unavailable.");

        const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dashboard");
        second.release();
        await waitForSignal(second.finished);
        await (await lateResponse).finished();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(state.dashboardReads, 2, "This case must exercise two concurrent dashboard reads.");
        await page.locator('#route-content a[href="#collection?filter=owned"]').click();
        await waitCollection(page);
        assert.equal(await page.locator("#collection-grid [data-card-id]").count(), 3);
        await page.locator("#collection-search").fill(record.id);
        assert.deepEqual(await cardIds(page), [veiling.id]);
        await page.locator(`[data-card-id="${veiling.id}"]`).click();
        assert.equal(await page.locator("#detail-panel .detail-quote").textContent(), "Veiling details are currently unavailable.");
        assert.equal(await page.locator("#detail-panel .ownership-id").textContent(), record.id);
        assert.match(await page.locator("#detail-panel .ownership-list").innerText(), /Jun 15, 2026/);
        const body = await page.locator("body").textContent();
        assert(!body.includes(veiling.name), "The late response must not restore the unpublished name.");
        assert(!body.includes(veiling.lore[0].text), "The late response must not restore unpublished lore.");
        assert.doesNotMatch(body, /\b207\b/);
        assert.equal(await page.locator('img[src*="/api/artwork/"]').count(), 0);
      });
    });
    await test("signed-out record links return to the same record after password sign-in", () => withFixture(browser,
      { signedIn: false, hash: recordHref(records[1].id).slice(1) }, async ({ page, state }) => {
        await page.waitForFunction(() => location.hash === "#signin");
        assert(!state.requests.some((request) => request.path.startsWith("/api/ownerships/")));
        await page.locator("#auth-email").fill(user.email);
        await page.locator("#auth-password").fill(fixturePassword);
        await page.locator("#auth-submit").click();
        await waitRecord(page, records[1].id);
        assert.equal(new URL(page.url()).hash, recordHref(records[1].id));
        assert.equal(await page.locator("#auth-password").inputValue(), "");
        assert.equal(state.requests.filter((request) => request.path === "/api/auth/login").length, 1);
      }));
    await test("unavailable artwork preserves readable record metadata and avoids a broken image", () => withFixture(browser,
      { missingArtwork: true, hash: recordHref(records[1].id).slice(1) }, async ({ page, state }) => {
        await waitRecord(page, records[1].id);
        await page.waitForFunction(() => !document.querySelector("#route-content .ownership-artwork"));
        assert(state.requests.some((request) => request.path === `/api/artwork/${id("e", 1)}`));
        const text = await page.locator("#route-content").innerText();
        assert(text.includes(records[1].id));
        assert(text.includes(veilings[0].name));
        assert.match(text, /Sep 30, 2026/);
        assert.doesNotMatch(text, /\bnull\b|undefined|NaN/);
      }));
    await test("absent, foreign, and malformed record links share a generic not-found view", () => withFixture(browser, {}, async ({ page, state }) => {
      await waitCollection(page);
      const messages = [];
      for (const recordId of [id("d", 98), id("d", 99), "not-a-record-id"]) {
        await navigate(page, recordHref(recordId));
        await page.waitForFunction(() => document.querySelector("#route-content")?.textContent.includes("Ownership record not found"));
        const content = await page.locator("#route-content").innerText();
        messages.push(content);
        assert(!content.includes(secret));
        assert(!content.includes(user.email));
        assert(!content.includes(veilings[0].name));
        assert(!content.includes(recordId));
      }
      assert.equal(new Set(messages).size, 1, "Not-found copy must not distinguish account access or existence.");
      assert(!state.requests.some((request) => request.path === recordPath("not-a-record-id")), "Malformed IDs should fail before an API call.");
    }));
    await test("transient record failures have a working retry without exposing backend detail", () => withFixture(browser, {}, async ({ page, state }) => {
      await waitCollection(page);
      state.failures.set(records[1].id, 1);
      await navigate(page, recordHref(records[1].id));
      await page.waitForSelector('#route-content [data-action="retry-ownership"]');
      assert.match(await page.locator("#route-content").innerText(), /couldn.t load this ownership record/i);
      assert(!(await page.locator("#route-content").innerText()).includes(secret));
      await page.locator('#route-content [data-action="retry-ownership"]').click();
      await waitRecord(page, records[1].id);
      assert.equal(state.requests.filter((request) => request.path === recordPath(records[1].id)).length, 2);
    }));
    await test("leaving a record route discards its delayed response", () => withFixture(browser, {}, async ({ page, state }) => {
      await waitCollection(page);
      const held = deferredRecord(); state.held.set(records[1].id, held);
      await navigate(page, recordHref(records[1].id));
      await waitForSignal(held.requested);
      await page.waitForFunction(() => document.querySelector("#route-content")?.textContent.includes("Loading ownership record"));
      await navigate(page, "collection?filter=owned");
      await waitCollection(page);
      held.release(); await waitForSignal(held.finished);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(await page.locator("#route-view").isHidden());
      assert.equal(await page.locator("#route-content .ownership-record-page").count(), 0);
      assert.equal(new URL(page.url()).hash, "#collection?filter=owned");
    }));
    await test("sign-out discards a delayed record response and clears private record content", () => withFixture(browser, {}, async ({ page, state }) => {
      await waitCollection(page);
      const held = deferredRecord(); state.held.set(records[1].id, held);
      await navigate(page, recordHref(records[1].id));
      await waitForSignal(held.requested);
      await page.locator("#sign-out").click();
      await page.waitForSelector("#auth-view:not([hidden])");
      held.release(); await waitForSignal(held.finished);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(state.signedIn, false);
      assert.equal(await page.locator("#route-content").innerText(), "");
      assert.equal(await page.locator("#collection-grid").innerText(), "");
      assert(!(await page.locator("body").innerText()).includes(records[1].id));
      assert(!(await page.locator("body").innerText()).includes(veilings[0].name));
    }));
    await test("ownership lists and record pages fit desktop/mobile text sizes and pass WCAG checks", () => withFixture(browser, {}, async ({ page }) => {
      await waitCollection(page);
      await page.locator(`[data-card-id="${veilings[0].id}"]`).click();
      await page.locator("#collection-sort").selectOption("acquired-newest");
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, "ownership-collection-1280px.png"), fullPage: true });
      }
      await checkAxe(page);
      for (const width of [320, 390, 1280]) for (const scale of [100, 200]) await checkOverflow(page, width, scale);
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      await page.setViewportSize({ width: 390, height: 844 });
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "ownership-collection-390px.png"), fullPage: true });
      await page.locator(`[data-card-id="${veilings[0].id}"]`).click();
      await page.waitForSelector("#veiling-dialog[open]");
      assert.equal(await page.locator("#full-detail-content .ownership-record-link").count(), 2);
      await checkAxe(page);
      await page.locator(`#full-detail-content a[href="${recordHref(records[1].id)}"]`).click();
      await waitRecord(page, records[1].id);
      assert(!(await page.locator("#veiling-dialog").evaluate((node) => node.open)), "The dialog must close when following its record link.");
      for (const width of [320, 390, 1280]) for (const scale of [100, 200]) await checkOverflow(page, width, scale);
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await checkAxe(page);
        await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
        if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `ownership-record-${width}px.png`), fullPage: true });
      }
    }));
  } finally { await browser.close(); }
  assert(passed > 0 || issues.length > 0, "No ownership browser checks matched TEST_FILTER.");
  if (issues.length) { console.error(`\n${issues.length} ownership browser checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${passed} local ownership browser checks passed. Hosted authorization and real grants were not tested.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
