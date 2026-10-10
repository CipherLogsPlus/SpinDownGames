// Local browser contracts only. Account, catalog and showcase APIs are intercepted;
// this suite never creates hosted accounts, ownerships or publications.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = (process.env.BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname), "Run intercepted fixtures against a local server only.");
const screenshotDir = process.env.SCREENSHOT_DIR || null;
const testFilter = process.env.TEST_FILTER ? new RegExp(process.env.TEST_FILTER) : null;
const introKey = "spinarium.preview.introduction.v3";
const cookie = "showcase-browser-test-only-session";
const csrf = "showcase_browser_test_only_csrf_1234567890";
const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Showcase Browser Collector", email: "showcase@example.test", memberSince: "2026-01-01T12:00:00Z" };
const uuid = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const privateMessage = "PRIVATE_BACKEND_DETAIL_MUST_NOT_RENDER";
const publicName = "Approved Glass Beacon";
const draftName = "Unapproved Copper Wisp";
const fixtureDate = "2026-10-03T12:00:00Z";
const emptyDashboard = () => ({
  schemaVersion: "1", mode: "live", profile: { id: user.id, displayName: user.displayName, memberSince: user.memberSince, avatarSrc: null },
  veilings: [], series: [], editions: [], variants: [], rarities: [], physicalCards: [], ownerships: [], discoveries: [],
  achievements: [], userAchievements: [], collections: [], news: [], events: [],
});
function draft(id, name) {
  return { id, name, description: `${name}: saved draft description.`, character_number: null, status: "draft", rarity: null, edition: null, artworkUrl: null, revision: 1, publication: null, canTrash: true, trashedAt: null };
}
function snapshot(row, visibility, releaseDate = null, sourceRevision = row.revision) {
  return { id: row.id, name: row.name, number: row.character_number, description: row.description, rarity: row.rarity, edition: row.edition,
    artworkUrl: row.artworkUrl, visibility, releaseDate, updatedAt: fixtureDate, sourceRevision };
}
function publicSnapshot(row) {
  if (!row.publication) return null;
  const { sourceRevision, ...published } = row.publication;
  return clone(published);
}
function sampleCatalog() {
  const publicRow = draft(uuid(1), publicName); publicRow.character_number = 41; publicRow.artworkUrl = `/api/artwork/${uuid(80)}`;
  publicRow.publication = snapshot(publicRow, "public");
  const coming = draft(uuid(2), "Approved Mist Lantern"); coming.publication = snapshot(coming, "upcoming");
  const dated = draft(uuid(3), "Approved Far Star"); dated.publication = snapshot(dated, "upcoming", "2099-07-21");
  const past = draft(uuid(4), "Approved Waiting Ember"); past.publication = snapshot(past, "upcoming", "2001-02-03");
  for (const row of [publicRow, coming, dated, past]) row.canTrash = false;
  return [publicRow, coming, dated, past, draft(uuid(5), draftName)];
}
function deferred() {
  let resolve, markRequested, markFinished;
  return { wait: new Promise(r => { resolve = r; }), requested: new Promise(r => { markRequested = r; }),
    finished: new Promise(r => { markFinished = r; }), release: () => resolve(), markRequested: () => markRequested(), markFinished: () => markFinished() };
}
async function signal(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for a fixture request.")), 10000); })]); }
  finally { clearTimeout(timer); }
}
function server(rows = sampleCatalog()) {
  return { rows: new Map(rows.map(row => [row.id, clone(row)])), calls: [], errors: [], failures: new Map(), responses: new Map(), artworkAvailable: true, held: new Map(), unauthorized: new Set(), nextConflict: false, nextId: 20 };
}
async function fixture(browser, state, { admin = false, signedIn = true, hash = "explore?filter=discovered", width = 1280, fastReadDeadline = false, captureExpiry = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  let authenticated = signedIn;
  const errors = [];
  try {
    // The baseline ribbon intro is covered separately; this is only a device
    // presentation preference, with no role or account authority.
    await context.addInitScript(key => localStorage.setItem(key, "seen"), introKey);
    if (fastReadDeadline) await context.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => original(callback, delay === 30000 ? 200 : delay, ...args);
    });
    if (captureExpiry) await context.addInitScript(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = (callback, delay, ...args) => {
        if (delay > 3500000 && delay <= 3600000) window.expireFixtureSession = callback;
        return original(callback, delay, ...args);
      };
    });
    if (signedIn) await context.addCookies([{ name: "spinarium_session", value: cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.route("**/spinarium/config.js*", route => route.fulfill({ status: 200, contentType: "text/javascript",
      body: 'export const spinariumConfig = Object.freeze({previewEnabled:false,backend:"cloudflare",authProvider:"password",apiBase:"/api",signupEnabled:false});' }));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), headers = request.headers(), method = request.method();
      state.calls.push({ path: url.pathname, method, admin, csrf: headers["x-csrf-token"], ifMatch: headers["if-match"], authorization: headers.authorization,
        body: request.postData(), contentType: headers["content-type"], url: request.url() });
      const respond = (value, status = 200, responseHeaders = {}) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store", ...responseHeaders }, body: JSON.stringify(value) });
      try {
        if (url.pathname === "/api/auth/session" && method === "GET") return authenticated
          ? respond({ user, csrfToken: csrf, expiresAt: new Date(Date.now() + 3600000).toISOString() }) : respond({ code: "UNAUTHORIZED" }, 401);
        if (!authenticated) return respond({ code: "UNAUTHORIZED" }, 401);
        assert(headers.cookie?.includes(cookie), "Private API requests must carry the session cookie.");
        if (method !== "GET") assert.equal(headers["x-csrf-token"], csrf);
        if (url.pathname === "/api/auth/logout" && method === "POST") {
          assert.equal(request.postData(), "{}"); authenticated = false;
          return respond({ signedOut: true }, 200, { "set-cookie": "spinarium_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
        }
        if (url.pathname === `/api/artwork/${uuid(80)}` && method === "GET") {
          if (!admin && ![...state.rows.values()].some(row => row.publication?.artworkUrl === url.pathname)) return respond({ code: "NOT_FOUND" }, 404);
          return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" },
            body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUc0thYGBgYmBgYGBgAAAJRADMgBbzgwAAAABJRU5ErkJggg==", "base64") });
        }
        const hold = state.held.get(url.pathname);
        if (hold) { state.held.delete(url.pathname); hold.markRequested(); await hold.wait; }
        try {
          if (state.unauthorized.has(url.pathname)) return await respond({ code: "UNAUTHORIZED" }, 401);
          if (state.responses.has(url.pathname)) {
            const response = state.responses.get(url.pathname); state.responses.delete(url.pathname);
            return await respond({ code: response.code, message: privateMessage }, response.status);
          }
          if (state.failures.get(url.pathname)) {
            state.failures.set(url.pathname, state.failures.get(url.pathname) - 1);
            return await respond({ code: "UNAVAILABLE", message: privateMessage }, 503);
          }
          if (url.pathname === "/api/dashboard" && method === "GET") return await respond(emptyDashboard());
          if (url.pathname === "/api/admin/access" && method === "GET") return await respond({ admin, role: admin ? "admin" : null });
          if (url.pathname === "/api/admin/artwork-status" && method === "GET") return await respond(admin
            ? { available: state.artworkAvailable, maxBytes: 8388608, acceptedTypes: ["image/png", "image/jpeg", "image/webp"] }
            : { code: "ADMIN_REQUIRED" }, admin ? 200 : 403);
          if (url.pathname === "/api/admin/accounts/summary" && method === "GET" && admin)
            return await respond({ total: 0, active: 0, disabled: 0, admins: 0, owners: 0, currentActorRole: "admin" });
          if (url.pathname === "/api/admin/accounts" && method === "GET" && admin)
            return await respond({ accounts: [], limit: Number(url.searchParams.get("limit")), nextCursor: null });
          if (url.pathname === "/api/showcase" && method === "GET") return await respond({ schemaVersion: "1", mode: "live", veilings: [...state.rows.values()].map(publicSnapshot).filter(Boolean) });
          const detail = /^\/api\/showcase\/([^/]+)$/.exec(url.pathname);
          if (detail && method === "GET") {
            const row = state.rows.get(detail[1]);
            return await respond(row?.publication ? { schemaVersion: "1", mode: "live", veiling: publicSnapshot(row) } : { code: "NOT_FOUND", message: privateMessage }, row?.publication ? 200 : 404);
          }
          if (url.pathname.startsWith("/api/admin/veilings")) {
            if (!admin) return await respond({ code: "ADMIN_REQUIRED" }, 403);
            if (url.pathname === "/api/admin/veilings" && method === "GET") {
              const trashed = url.searchParams.get("trashed") === "true";
              return await respond([...state.rows.values()].filter(row => Boolean(row.trashedAt) === trashed).map(clone));
            }
            if (url.pathname === "/api/admin/veilings" && method === "POST") {
              const input = request.postDataJSON();
              assert(!("publication" in input), "Saving a draft cannot approve member content.");
              const row = { ...draft(uuid(state.nextId++), input.name), description: input.description, character_number: input.number,
                status: input.status, rarity: input.rarity, edition: input.edition };
              state.rows.set(row.id, row); return await respond(clone(row), 201);
            }
            const match = /^\/api\/admin\/veilings\/([^/]+)(\/(?:publication|trash|restore))?$/.exec(url.pathname);
            if (match) {
              const row = state.rows.get(match[1]);
              if (!row) return await respond({ code: "NOT_FOUND" }, 404);
              assert.equal(headers["if-match"], `"${row.revision}"`, "Mutations must use the loaded revision.");
              if (state.nextConflict) {
                state.nextConflict = false; row.revision++; row.name = "Concurrent server draft";
                return await respond({ code: "CATALOG_CHANGED", message: privateMessage }, 409);
              }
              if (["/trash", "/restore"].includes(match[2]) && method === "POST") {
                assert.equal(request.postData(), null, "Trash and restore must send no request body.");
                assert.equal(headers["content-type"], undefined, "Bodyless mutations must not set a Content-Type.");
                if (match[2] === "/trash") {
                  if (row.trashedAt || !row.canTrash || row.publication) return await respond({ code: "DRAFT_NOT_TRASHABLE" }, 409);
                  row.trashedAt = fixtureDate; row.canTrash = false;
                } else {
                  if (!row.trashedAt) return await respond({ code: "DRAFT_NOT_TRASHED" }, 409);
                  row.trashedAt = null; row.canTrash = true;
                }
                row.revision++;
                return await respond(clone(row));
              }
              if (row.trashedAt) return await respond({ code: "DRAFT_TRASHED" }, 409);
              const input = request.postDataJSON();
              if (!match[2] && method === "PATCH") {
                Object.assign(row, { name: input.name, description: input.description, character_number: input.number,
                  status: input.status, rarity: input.rarity, edition: input.edition, revision: row.revision + 1 });
                return await respond(clone(row));
              }
              if (match[2] === "/publication" && method === "POST") {
                assert.deepEqual(Object.keys(input).sort(), ["releaseDate", "useSavedDraft", "visibility"]);
                assert(["public", "upcoming", "private"].includes(input.visibility));
                assert.equal(typeof input.useSavedDraft, "boolean");
                assert(input.releaseDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.releaseDate));
                assert(input.visibility === "upcoming" || input.releaseDate === null);
                assert(input.visibility !== "private" || input.useSavedDraft === false);
                if (input.visibility !== "private" && !input.useSavedDraft && !row.publication) return await respond({ code: "PUBLICATION_REQUIRED" }, 409);
                row.revision++; row.canTrash = false;
                if (input.visibility === "private") row.publication = null;
                else if (input.useSavedDraft) row.publication = snapshot(row, input.visibility, input.releaseDate, row.revision);
                else row.publication = { ...row.publication, visibility: input.visibility, releaseDate: input.releaseDate, updatedAt: fixtureDate,
                  sourceRevision: row.publication.sourceRevision === row.revision - 1 ? row.revision : row.publication.sourceRevision };
                return await respond(clone(row));
              }
            }
          }
          state.errors.push(`Unexpected fixture API: ${method} ${url.pathname}`);
          return await respond({ code: "UNEXPECTED_FIXTURE_ENDPOINT" }, 500);
        } finally { hold?.markFinished(); }
      } catch (error) {
        if (!request.failure() && !/closed|abort|cancel/i.test(error.message)) {
          state.errors.push(error.stack || error.message);
          await respond({ code: "FIXTURE_ASSERTION_FAILED" }, 500).catch(() => {});
        }
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/spinarium/#${hash}`, { waitUntil: "load", timeout: 30000 });
    await page.bringToFront();
    if (signedIn) await page.waitForFunction(() => !document.body.classList.contains("auth-gated"));
    else await page.waitForSelector("#auth-view:not([hidden])");
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors };
  } catch (error) { await context.close(); throw error; }
}
async function withFixtures(browser, state, options, run) {
  const fixtures = [];
  try {
    for (const option of options) fixtures.push(await fixture(browser, state, option));
    await run(...fixtures);
    assert.deepEqual(state.errors, [], "API fixture assertions failed.");
    for (const current of fixtures) {
      assert.deepEqual(current.errors, [], "Unexpected browser script errors.");
      assert.deepEqual(await current.page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie })),
        { local: { [introKey]: "seen" }, session: {}, cookie: "" });
    }
    assert(state.calls.every(call => !call.authorization && !call.url.includes(cookie) && !call.url.includes(csrf)), "Requests must not carry browser bearer tokens or URL credentials.");
    assert(state.calls.every(call => !/ownerships|claims|grants/.test(call.path)), "Showcase/studio work must never grant ownership or load ownership details.");
  } finally {
    for (const hold of state.held.values()) hold.release();
    await Promise.all(fixtures.map(current => current.context.close()));
  }
}
const navigate = (page, hash) => page.evaluate(next => { location.hash = next; }, hash);
async function checkAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
  assert.deepEqual(result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })), []);
}
async function checkOverflow(page) {
  for (const width of [320, 390, 1280]) for (const scale of [100, 200]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(value => { document.documentElement.style.fontSize = `${value}%`; }, scale);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}px/${scale}% text.`);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
}
async function screenshot(page, name) {
  if (!screenshotDir) return;
  fs.mkdirSync(screenshotDir, { recursive: true });
  const measure = () => page.evaluate(() => {
    const link = document.querySelector(".skip-link"), rect = link.getBoundingClientRect();
    return { scrollY, active: document.activeElement?.id || document.activeElement?.tagName,
      skip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, transform: getComputedStyle(link).transform,
        inViewport: rect.bottom > 0 && rect.top < innerHeight } };
  });
  const before = await measure();
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const after = await measure();
  fs.appendFileSync(path.join(screenshotDir, "screenshot-metrics.jsonl"), JSON.stringify({ name, before, after }) + "\n");
  await page.screenshot({ path: path.join(screenshotDir, name), fullPage: true });
}
let passed = 0;
const issues = [];
async function test(name, run) {
  if (testFilter && !testFilter.test(name)) return;
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { issues.push(name); console.error(`FAIL ${name}: ${error.stack || error.message}`); }
}
const memberCard = id => `#showcase-grid a[href="#showcase/${id}"]`;
const studioItem = id => `#studio-list [data-veiling-id="${id}"]`;
async function waitShowcase(page) {
  await page.waitForSelector("#showcase-search");
  await page.waitForSelector("#showcase-grid", { state: "attached" });
}
async function waitStudio(page) { await page.waitForSelector("#studio-create:not([disabled])"); }
async function waitMemberDetail(page, name) {
  await page.waitForSelector("#route-content .showcase-detail");
  assert.equal(await page.locator("#route-title").textContent(), name);
}
async function refreshMember(page, route = "explore?filter=discovered") {
  await navigate(page, "dashboard");
  await page.waitForSelector("#hub-view:not([hidden])");
  await navigate(page, route);
  await waitShowcase(page);
}
async function saveDraft(page) {
  await page.locator("#studio-save").click();
  await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.startsWith("Draft saved.") && !document.querySelector("#studio-save").disabled);
}
const artworkFile = () => ({ name: "test-only.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUc0thYGBgYmBgYGBgAAAJRADMgBbzgwAAAABJRU5ErkJggg==", "base64") });
const trashCalls = state => state.calls.filter(call => /\/(trash|restore)$/.test(call.path));
async function openTrash(page) {
  await page.locator("#studio-trash").click();
  await page.waitForSelector("#studio-publish-dialog[open]");
  assert.match(await page.locator("#studio-publish-confirm").textContent(), /Trash draft/i);
}
async function waitTrashed(page) {
  await page.waitForSelector("#studio-restore:not([disabled])");
  assert.equal(await page.locator("#studio-editor-form, #studio-artwork, #studio-save, [data-studio-action]").count(), 0,
    "A trashed draft must be read-only, without editing, upload or publication controls.");
  assert.equal(await page.locator('[data-filter="trash"]').getAttribute("aria-pressed"), "true");
}
async function confirmTrash(page) {
  await openTrash(page);
  await page.locator("#studio-publish-confirm").click();
  await waitTrashed(page);
}
async function publish(page, state, action, expected, expectedName) {
  const before = state.calls.filter(call => call.path.endsWith("/publication")).length;
  await page.locator(`[data-studio-action="${action}"]`).click();
  await page.waitForSelector("#studio-publish-dialog[open]");
  assert.equal(state.calls.filter(call => call.path.endsWith("/publication")).length, before, "A preview must not mutate publication before confirmation.");
  if (expectedName) assert.equal(await page.locator("#studio-publish-dialog h4").textContent(), expectedName);
  await page.locator("#studio-publish-confirm").click();
  await page.waitForFunction(() => !document.querySelector("#studio-publish-dialog").open && !document.querySelector("#studio-save").disabled);
  const calls = state.calls.filter(call => call.path.endsWith("/publication"));
  assert.equal(calls.length, before + 1);
  assert.deepEqual(JSON.parse(calls.at(-1).body), expected);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"] });
  try {
    await test("a member with zero ownership sees approved showcase content but no private draft", async () => {
      const state = server();
      await withFixtures(browser, state, [{}], async ({ page }) => {
        await waitShowcase(page);
        assert.equal(await page.locator("#showcase-grid .showcase-card").count(), 1);
        assert(await page.locator(memberCard(uuid(1))).isVisible());
        assert(!(await page.locator("body").textContent()).includes(draftName));
        assert(!state.calls.some(call => call.path.startsWith("/api/admin/veilings")));
        await navigate(page, "collection?filter=owned");
        await page.waitForSelector("#dashboard-view:not([hidden])");
        assert.equal(await page.locator("#collection-grid [data-card-id]").count(), 0);
        assert.equal(await page.locator("#stats .stat-card strong").first().textContent(), "0");
        await refreshMember(page);
        await page.locator("#showcase-search").fill("041");
        assert.equal(await page.locator("#showcase-grid .showcase-card").count(), 1);
        await page.locator(memberCard(uuid(1))).click();
        await waitMemberDetail(page, publicName);
        assert.equal(await page.locator(".showcase-ownership").textContent(), "Not in your collection");
        assert.equal(await page.locator("#route-content .ownership-record-link, #route-content .ownership-id").count(), 0);
        assert.equal(await page.locator('#route-content a[href="#collection?filter=owned"]').count(), 0);
        assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
      });
    });
    await test("Upcoming shows Coming soon and exact dates, and a past date never publishes automatically", async () => {
      const state = server();
      await withFixtures(browser, state, [{ hash: "upcoming" }], async ({ page }) => {
        await waitShowcase(page);
        assert.equal(await page.locator("#showcase-grid .showcase-card").count(), 3);
        assert.equal(await page.locator(`${memberCard(uuid(2))} .showcase-release`).textContent(), "Coming soon");
        assert.equal(await page.locator(`${memberCard(uuid(3))} time`).getAttribute("datetime"), "2099-07-21");
        assert.equal(await page.locator(`${memberCard(uuid(4))} time`).getAttribute("datetime"), "2001-02-03");
        await page.locator(memberCard(uuid(4))).click();
        await waitMemberDetail(page, "Approved Waiting Ember");
        assert.match(await page.locator(".showcase-detail").textContent(), /Upcoming/);
        await page.reload({ waitUntil: "load" });
        await waitMemberDetail(page, "Approved Waiting Ember");
        assert.equal(state.rows.get(uuid(4)).publication.visibility, "upcoming");
        await refreshMember(page);
        assert.equal(await page.locator(memberCard(uuid(4))).count(), 0);
        assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
      });
    });
    await test("a fresh hidden detail response removes former member content and later list reads stay private", async () => {
      const state = server();
      await withFixtures(browser, state, [{ hash: `showcase/${uuid(1)}` }], async ({ page }) => {
        await waitMemberDetail(page, publicName);
        await page.waitForFunction(() => document.querySelector(".showcase-detail-artwork")?.naturalWidth > 0);
        state.rows.get(uuid(1)).publication = null;
        await navigate(page, "dashboard");
        await page.waitForSelector("#hub-view:not([hidden])");
        await navigate(page, `showcase/${uuid(1)}`);
        await page.waitForFunction(() => document.querySelector("#route-title")?.textContent === "Veiling unavailable");
        assert(!(await page.locator("body").textContent()).includes(publicName));
        assert(!(await page.locator("body").textContent()).includes(privateMessage));
        assert.equal(await page.locator('img[src*="/api/artwork/"]').count(), 0);
        await page.locator(".showcase-back").click();
        await waitShowcase(page);
        assert.equal(await page.locator("#showcase-grid .showcase-card").count(), 0);
        assert(!(await page.locator("body").textContent()).includes(publicName));
      });
    });
    await test("anonymous showcase routes stay gated and malformed or private IDs expose no draft", async () => {
      const state = server();
      await withFixtures(browser, state, [{ signedIn: false, hash: `showcase/${uuid(1)}` }, {}], async (anonymous, member) => {
        assert.equal(new URL(anonymous.page.url()).hash, "#signin");
        assert.equal(await anonymous.page.locator("#route-content").textContent(), "");
        await waitShowcase(member.page);
        for (const id of [uuid(5), uuid(99), "not-a-uuid"]) {
          await navigate(member.page, `showcase/${id}`);
          await member.page.waitForFunction(() => document.querySelector("#route-title")?.textContent === "Veiling unavailable");
          const text = await member.page.locator("#route-content").textContent();
          assert(!text.includes(draftName) && !text.includes(privateMessage) && !text.includes(id));
        }
        assert(!state.calls.some(call => call.path.endsWith("not-a-uuid")));
      });
    });
    await test("showcase failures retry and delayed responses cannot return after sign-out", async () => {
      const state = server(); state.failures.set("/api/showcase", 1);
      await withFixtures(browser, state, [{}], async ({ page }) => {
        await page.locator('[data-action="retry-showcase"]').click();
        await waitShowcase(page);
        assert(!(await page.locator("body").textContent()).includes(privateMessage));
        const hold = deferred(); state.held.set(`/api/showcase/${uuid(1)}`, hold);
        await page.locator(memberCard(uuid(1))).click(); await signal(hold.requested);
        await page.locator("#sign-out").click();
        await page.waitForSelector("#auth-view:not([hidden])");
        hold.release(); await signal(hold.finished);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator("#route-content").textContent(), "");
        assert(!(await page.locator("body").textContent()).includes(publicName));
      });
    });
    await test("Create and Save Draft remain private until a confirmed publication; later edits need Publish changes", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }, {}], async ({ page }, member) => {
        await waitStudio(page); await waitShowcase(member.page);
        assert.equal(await page.locator("#studio-editor-form").count(), 0);
        await page.locator("#studio-create").click();
        await page.locator("#studio-name").fill("Name-only draft");
        assert(await page.locator('[data-studio-action="public"]').isDisabled());
        await saveDraft(page);
        const row = state.rows.get(uuid(20));
        assert.equal(row.description, ""); assert.equal(row.publication, null);
        assert.equal(await page.locator("#studio-list .studio-list-item").count(), 1);
        await refreshMember(member.page);
        assert.equal(await member.page.locator("#showcase-grid .showcase-card").count(), 0);
        await page.locator('[data-studio-action="public"]').click();
        await page.waitForSelector("#studio-publish-dialog[open]");
        await page.locator("#studio-publish-cancel").click();
        assert.equal(state.calls.filter(call => call.path.endsWith("/publication")).length, 0);
        await publish(page, state, "public", { visibility: "public", releaseDate: null, useSavedDraft: true }, "Name-only draft");
        await refreshMember(member.page); assert(await member.page.locator(memberCard(uuid(20))).isVisible());
        await page.locator("#studio-name").fill("Privately revised name");
        await page.locator("#studio-description").fill("Private saved draft lore");
        assert(await page.locator('[data-studio-action="changes"]').isDisabled());
        await saveDraft(page);
        assert.equal(row.publication.name, "Name-only draft");
        await refreshMember(member.page);
        assert((await member.page.locator("#route-content").textContent()).includes("Name-only draft"));
        assert(!(await member.page.locator("body").textContent()).includes("Privately revised name"));
        assert.match(await page.locator(studioItem(row.id)).textContent(), /Draft changes/);
        await publish(page, state, "changes", { visibility: "public", releaseDate: null, useSavedDraft: true }, "Privately revised name");
        assert.equal(row.publication.description, "Private saved draft lore");
        await refreshMember(member.page);
        await member.page.locator(memberCard(row.id)).click();
        await waitMemberDetail(member.page, "Privately revised name");
        assert.equal(await member.page.locator(".showcase-description").textContent(), "Private saved draft lore");
      });
    });
    await test("visibility and date changes keep the approved version until explicit draft publication", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }, {}], async ({ page }, member) => {
        await waitStudio(page); await waitShowcase(member.page);
        await page.locator(studioItem(uuid(1))).click();
        await publish(page, state, "upcoming", { visibility: "upcoming", releaseDate: null, useSavedDraft: false }, publicName);
        assert.doesNotMatch(await page.locator(studioItem(uuid(1))).textContent(), /Draft changes/);
        assert(await page.locator('[data-studio-action="changes"]').isDisabled());
        await publish(page, state, "public", { visibility: "public", releaseDate: null, useSavedDraft: false }, publicName);
        await page.locator("#studio-name").fill("Pending private name"); await saveDraft(page);
        await page.locator("#studio-date-mode").selectOption("date");
        await page.locator("#studio-release-date").fill("2099-07-21");
        await publish(page, state, "upcoming", { visibility: "upcoming", releaseDate: "2099-07-21", useSavedDraft: false }, publicName);
        assert.equal(state.rows.get(uuid(1)).publication.name, publicName);
        await refreshMember(member.page, "upcoming");
        assert.equal(await member.page.locator(`${memberCard(uuid(1))} time`).getAttribute("datetime"), "2099-07-21");
        assert(!(await member.page.locator("body").textContent()).includes("Pending private name"));
        await publish(page, state, "public", { visibility: "public", releaseDate: null, useSavedDraft: false }, publicName);
        assert.equal(state.rows.get(uuid(1)).publication.releaseDate, null);
        await page.locator("#studio-date-mode").selectOption("coming-soon");
        await publish(page, state, "upcoming", { visibility: "upcoming", releaseDate: null, useSavedDraft: false }, publicName);
        await refreshMember(member.page, "upcoming");
        assert.equal(await member.page.locator(`${memberCard(uuid(1))} .showcase-release`).textContent(), "Coming soon");
        await page.locator("#studio-date-mode").selectOption("date");
        await page.locator("#studio-release-date").fill("2001-02-03");
        await publish(page, state, "date", { visibility: "upcoming", releaseDate: "2001-02-03", useSavedDraft: false }, publicName);
        assert.equal(state.rows.get(uuid(1)).publication.visibility, "upcoming");
        await publish(page, state, "private", { visibility: "private", releaseDate: null, useSavedDraft: false }, publicName);
        assert.equal(state.rows.get(uuid(1)).publication, null);
        assert.equal(state.rows.get(uuid(1)).name, "Pending private name");
        await refreshMember(member.page, "upcoming");
        assert.equal(await member.page.locator(memberCard(uuid(1))).count(), 0);
      });
    });
    await test("studio filters distinguish private drafts, pending changes, Public and Upcoming without changing data", async () => {
      const rows = sampleCatalog(); rows[0].name = "Pending saved content";
      const state = server(rows);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page);
        const ids = () => page.locator("#studio-list [data-veiling-id]").evaluateAll(nodes => nodes.map(node => node.dataset.veilingId).sort());
        for (const [filter, expected] of [["draft", [uuid(1), uuid(5)]], ["public", [uuid(1)]], ["upcoming", [uuid(2), uuid(3), uuid(4)]], ["all", rows.map(row => row.id)]]) {
          await page.locator(`.studio-filter[data-filter="${filter}"]`).click(); assert.deepEqual(await ids(), expected.sort());
        }
        await page.locator("#studio-search").fill(uuid(5).toUpperCase()); assert.deepEqual(await ids(), [uuid(5)]);
        await page.locator("#studio-search").fill("41"); assert.deepEqual(await ids(), [uuid(1)]);
        assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
      });
    });
    await test("stale publication requires a fresh saved draft review and never silently approves competing changes", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        state.nextConflict = true;
        await page.locator('[data-studio-action="public"]').click();
        await page.locator("#studio-publish-confirm").click();
        await page.waitForFunction(() => !document.querySelector("#studio-publish-dialog").open && document.querySelector("#studio-editor-feedback")?.textContent.includes("changed elsewhere"));
        assert.equal(state.rows.get(uuid(5)).publication, null);
        assert(await page.locator("#studio-save").isDisabled());
        assert(await page.locator('[data-studio-action="public"]').isDisabled());
        assert.equal(await page.locator("#studio-name").inputValue(), draftName);
        await page.locator("#studio-discard").click();
        await page.waitForFunction(() => document.querySelector("#studio-name")?.value === "Concurrent server draft" && !document.querySelector("#studio-save").disabled);
        await publish(page, state, "public", { visibility: "public", releaseDate: null, useSavedDraft: true }, "Concurrent server draft");
        assert.equal(state.rows.get(uuid(5)).publication.name, "Concurrent server draft");
      });
    });
    await test("a failed draft artwork upload remains pending and cannot be accidentally published", async () => {
      const state = server(); state.failures.set(`/api/admin/veilings/${uuid(5)}/artwork`, 1);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await page.locator("#studio-description").fill("Saved words before the image upload.");
        await page.locator("#studio-artwork").setInputFiles({ name: "test-only.png", mimeType: "image/png",
          buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUc0thYGBgYmBgYGBgAAAJRADMgBbzgwAAAABJRU5ErkJggg==", "base64") });
        assert(await page.locator('[data-studio-action="public"]').isDisabled());
        await page.locator("#studio-save").click();
        await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.includes("artwork was not uploaded") && !document.querySelector("#studio-save").disabled);
        assert.equal(state.rows.get(uuid(5)).description, "Saved words before the image upload.");
        assert.equal(state.rows.get(uuid(5)).publication, null);
        assert.equal(await page.locator("#studio-artwork").evaluate(node => node.files.length), 1);
        assert(await page.locator('[data-studio-action="public"]').isDisabled());
        assert(!state.calls.some(call => call.path.endsWith("/publication")));
        await page.locator("#studio-clear-artwork").click();
        assert.equal(await page.locator("#studio-artwork").evaluate(node => node.files.length), 0);
        assert(!(await page.locator('[data-studio-action="public"]').isDisabled()));
        assert.equal(state.calls.filter(call => call.path.endsWith("/artwork") && call.method === "POST").length, 1);
      });
    });
    await test("Trash is limited to eligible saved drafts and blocks unsaved text and artwork", async () => {
      const history = draft(uuid(6), "Previously published private draft"); history.canTrash = false;
      const state = server([...sampleCatalog(), history]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page);
        await page.locator("#studio-create").click();
        assert.equal(await page.locator("#studio-trash").count(), 0);
        for (const id of [uuid(1), uuid(2), history.id]) {
          await page.locator(studioItem(id)).click();
          assert.equal(await page.locator("#studio-trash").count(), 0, "Published and publication-history records cannot offer draft trash.");
        }
        await page.locator(studioItem(uuid(5))).click();
        assert(!(await page.locator("#studio-trash").isDisabled()));
        await page.locator("#studio-name").fill("Unsaved trash candidate");
        assert(await page.locator("#studio-trash").isDisabled());
        await page.locator("#studio-trash").evaluate(node => node.click());
        assert.equal(await page.locator("#studio-publish-dialog[open]").count(), 0);
        await page.locator('[data-filter="trash"]').click();
        assert.equal(await page.locator('[data-filter="all"]').getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator("#studio-name").inputValue(), "Unsaved trash candidate");
        assert(!state.calls.some(call => call.path === "/api/admin/veilings" && new URL(call.url).searchParams.has("trashed")),
          "Changing to Trash cannot discard a dirty editor.");
        await page.locator("#studio-discard").click();
        assert.equal(await page.locator("#studio-name").inputValue(), draftName);
        await page.locator("#studio-artwork").setInputFiles(artworkFile());
        assert(await page.locator("#studio-trash").isDisabled());
        await page.locator("#studio-clear-artwork").click();
        assert(!(await page.locator("#studio-trash").isDisabled()));
        assert.equal(trashCalls(state).length, 0);
      });
    });
    await test("Trash confirmation cancels safely and repeated trash or restore clicks mutate once", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        const saved = clone(state.rows.get(uuid(5)));
        await openTrash(page);
        assert((await page.locator("#studio-publish-dialog").textContent()).includes(draftName));
        assert.equal(trashCalls(state).length, 0, "Opening a trash preview must not mutate.");
        await page.locator("#studio-publish-cancel").click();
        await page.waitForSelector("#studio-publish-dialog", { state: "hidden" });
        assert(await page.locator("#studio-trash").evaluate(node => document.activeElement === node));
        await openTrash(page); await page.keyboard.press("Escape");
        await page.waitForSelector("#studio-publish-dialog", { state: "hidden" });
        assert.equal(trashCalls(state).length, 0);
        assert(await page.locator("#studio-trash").evaluate(node => document.activeElement === node));
        const hold = deferred(); state.held.set(`/api/admin/veilings/${uuid(5)}/trash`, hold);
        await openTrash(page);
        await page.locator("#studio-publish-confirm").evaluate(node => { node.click(); node.click(); });
        await signal(hold.requested);
        assert(await page.locator("#studio-publish-confirm").isDisabled());
        assert(await page.locator("#studio-publish-cancel").isDisabled());
        await page.keyboard.press("Escape");
        assert(await page.locator("#studio-publish-dialog").isVisible());
        await navigate(page, "collection"); await page.waitForFunction(() => location.hash === "#admin");
        assert.equal(trashCalls(state).length, 1);
        hold.release(); await signal(hold.finished); await waitTrashed(page);
        assert.equal(state.rows.get(uuid(5)).trashedAt, fixtureDate);
        assert.equal(state.rows.get(uuid(5)).revision, saved.revision + 1);
        assert.equal(state.rows.get(uuid(5)).description, saved.description);
        assert.equal(state.rows.get(uuid(5)).publication, null);
        assert.equal(await page.locator("#studio-list [data-veiling-id]").count(), 1);
        const restore = deferred(); state.held.set(`/api/admin/veilings/${uuid(5)}/restore`, restore);
        await page.locator("#studio-restore").evaluate(node => { node.click(); node.click(); });
        await signal(restore.requested);
        assert(await page.locator("#studio-restore").isDisabled());
        assert.equal(trashCalls(state).length, 2);
        restore.release(); await signal(restore.finished);
        await page.waitForSelector("#studio-trash:not([disabled])");
        assert.equal(await page.locator('[data-filter="all"]').getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator("#studio-name").inputValue(), saved.name);
        assert.equal(state.rows.get(uuid(5)).trashedAt, null);
        assert.equal(state.rows.get(uuid(5)).revision, saved.revision + 2);
        assert.deepEqual(trashCalls(state).map(call => ({ method: call.method, ifMatch: call.ifMatch, body: call.body, contentType: call.contentType })),
          [{ method: "POST", ifMatch: '"1"', body: null, contentType: undefined }, { method: "POST", ifMatch: '"2"', body: null, contentType: undefined }]);
        assert(!state.calls.some(call => call.path.endsWith("/publication")));
      });
    });
    await test("Trash filter loads only recoverable drafts and restores retained content after reload", async () => {
      const archived = draft(uuid(6), "Recoverable glass moth");
      Object.assign(archived, { canTrash: false, trashedAt: fixtureDate, revision: 7, artworkUrl: `/api/artwork/${uuid(80)}`,
        character_number: 72, rarity: "Rare", edition: "First" });
      const state = server([...sampleCatalog(), archived]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }, {}], async ({ page }, member) => {
        await waitStudio(page); await waitShowcase(member.page);
        assert.equal(await page.locator(studioItem(archived.id)).count(), 0);
        await page.locator('[data-filter="trash"]').click();
        await page.waitForSelector(studioItem(archived.id));
        assert.equal(await page.locator("#studio-list [data-veiling-id]").count(), 1);
        await page.locator(studioItem(archived.id)).click(); await waitTrashed(page);
        assert((await page.locator("#studio-editor").textContent()).includes(archived.description));
        await page.waitForFunction(() => document.querySelector("#studio-editor img")?.naturalWidth > 0);
        await page.reload({ waitUntil: "load" }); await waitStudio(page);
        assert.equal(await page.locator(studioItem(archived.id)).count(), 0);
        await page.locator('[data-filter="trash"]').click();
        await page.waitForSelector(studioItem(archived.id)); await page.locator(studioItem(archived.id)).click();
        await waitTrashed(page);
        assert(state.calls.some(call => call.path === "/api/admin/veilings" && new URL(call.url).searchParams.get("trashed") === "true"));
        await page.locator("#studio-restore").click(); await page.waitForSelector("#studio-trash:not([disabled])");
        assert.equal(await page.locator("#studio-name").inputValue(), archived.name);
        assert.equal(await page.locator("#studio-number").inputValue(), "72");
        assert.equal(await page.locator("#studio-rarity").inputValue(), "Rare");
        assert.equal(await page.locator("#studio-edition").inputValue(), "First");
        await refreshMember(member.page);
        assert.equal(await member.page.locator(memberCard(archived.id)).count(), 0, "Restoring a draft must not publish it.");
      });
    });
    await test("stale Trash and Restore revisions require reload before retry", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        state.nextConflict = true;
        await openTrash(page); await page.locator("#studio-publish-confirm").click();
        await page.waitForFunction(() => !document.querySelector("#studio-publish-dialog").open && document.querySelector("#studio-editor-feedback")?.textContent.includes("changed elsewhere"));
        assert.equal(state.rows.get(uuid(5)).trashedAt, null);
        assert(await page.locator("#studio-trash").isDisabled());
        assert(await page.locator("#studio-save").isDisabled());
        assert.equal(await page.locator("#studio-name").inputValue(), draftName);
        assert(!(await page.locator("body").textContent()).includes(privateMessage));
        await page.locator("#studio-discard").click();
        await page.waitForFunction(() => document.querySelector("#studio-name")?.value === "Concurrent server draft" && !document.querySelector("#studio-trash").disabled);
        await confirmTrash(page);
        state.nextConflict = true;
        await page.locator("#studio-restore").click();
        await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.includes("changed elsewhere"));
        assert(state.rows.get(uuid(5)).trashedAt);
        assert(await page.locator("#studio-restore").isDisabled());
        await page.locator("#studio-discard").click(); await waitTrashed(page);
        await page.locator("#studio-restore").click(); await page.waitForSelector("#studio-trash:not([disabled])");
        assert.deepEqual(trashCalls(state).map(call => call.ifMatch), ['"1"', '"2"', '"3"', '"4"']);
        assert.equal(state.rows.get(uuid(5)).revision, 5);
      });
    });
    await test("server eligibility rejection prevents Trash until a fresh catalog review", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        state.rows.get(uuid(5)).canTrash = false;
        await openTrash(page); await page.locator("#studio-publish-confirm").click();
        await page.waitForFunction(() => !document.querySelector("#studio-publish-dialog").open && !document.querySelector("#studio-discard").hidden);
        assert(await page.locator("#studio-trash").isDisabled());
        assert.equal(state.rows.get(uuid(5)).trashedAt, null);
        assert.equal(state.rows.get(uuid(5)).revision, 1);
        await page.locator("#studio-discard").click();
        await page.waitForFunction(() => document.querySelector("#studio-save")?.disabled === false && !document.querySelector("#studio-trash"));
        assert.equal(trashCalls(state).length, 1);
      });
    });
    await test("Trash and Restore failures remain recoverable without claiming success", async () => {
      const state = server(); state.failures.set(`/api/admin/veilings/${uuid(5)}/trash`, 1);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await openTrash(page); await page.locator("#studio-publish-confirm").click();
        await page.waitForFunction(() => document.querySelector("#studio-publish-feedback")?.textContent.includes("could not be completed") && !document.querySelector("#studio-publish-confirm").disabled);
        assert(await page.locator("#studio-publish-dialog").isVisible());
        assert.equal(state.rows.get(uuid(5)).trashedAt, null);
        assert(!(await page.locator("body").textContent()).includes(privateMessage));
        await page.locator("#studio-publish-confirm").click(); await waitTrashed(page);
        state.failures.set(`/api/admin/veilings/${uuid(5)}/restore`, 1);
        await page.locator("#studio-restore").click();
        await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.includes("could not be completed") && !document.querySelector("#studio-restore").disabled);
        assert(state.rows.get(uuid(5)).trashedAt);
        await page.locator("#studio-restore").click(); await page.waitForSelector("#studio-trash:not([disabled])");
        assert.equal(state.rows.get(uuid(5)).revision, 3, "Failed mutations must not advance the saved revision.");
      });
    });
    await test("confirmed Trash and Restore keep catalog refresh retry available without repeating the mutation", async () => {
      for (const action of ["trash", "restore"]) {
        const rows = sampleCatalog();
        const other = draft(uuid(6), "Another recoverable draft");
        Object.assign(other, { canTrash: false, trashedAt: fixtureDate });
        if (action === "restore") Object.assign(rows[4], { canTrash: false, trashedAt: fixtureDate });
        const state = server([...rows, other]);
        await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
          await waitStudio(page);
          if (action === "restore") {
            await page.locator('[data-filter="trash"]').click();
            await page.waitForSelector(studioItem(uuid(5)));
          }
          await page.locator(studioItem(uuid(5))).click();
          // The initial catalog is already loaded. Only the post-mutation
          // reconciliation GET fails; the confirmed mutation must stay saved.
          state.failures.set("/api/admin/veilings", 1);
          if (action === "trash") await confirmTrash(page);
          else {
            await page.locator("#studio-restore").click();
            await page.waitForSelector("#studio-trash:not([disabled])");
          }
          await page.waitForSelector("#studio-list-feedback #studio-retry:not([disabled])");
          assert.match(await page.locator("#studio-list-feedback").textContent(), /could not be completed/);
          assert.match(await page.locator("#studio-editor-feedback").textContent(), action === "trash" ? /moved to Trash/ : /restored as a private draft/);
          assert.equal(state.rows.get(uuid(5)).revision, 2);
          assert.equal(Boolean(state.rows.get(uuid(5)).trashedAt), action === "trash");
          assert.equal(trashCalls(state).length, 1);
          assert.equal(await page.locator("#studio-list [data-veiling-id]").count(), 1, "Keep the confirmed row while the full list is unavailable.");
          if (action === "restore") {
            const reads = state.calls.filter(call => call.path === "/api/admin/veilings" && call.method === "GET").length;
            await page.locator("#studio-description").fill("Unsaved words after restoration must survive Retry.");
            await page.locator("#studio-retry").click();
            await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.includes("Save or discard your changes"));
            assert.equal(await page.locator("#studio-description").inputValue(), "Unsaved words after restoration must survive Retry.");
            assert.equal(state.calls.filter(call => call.path === "/api/admin/veilings" && call.method === "GET").length, reads,
              "Retry must not refresh away unsaved edits in the restored draft.");
            assert(await page.locator("#studio-retry").isVisible());
            await page.locator("#studio-discard").click();
            assert.equal(await page.locator("#studio-description").inputValue(), rows[4].description);
          }
          await page.locator("#studio-retry").click();
          await waitStudio(page);
          const ids = await page.locator("#studio-list [data-veiling-id]").evaluateAll(nodes => nodes.map(node => node.dataset.veilingId).sort());
          assert.deepEqual(ids, action === "trash" ? [uuid(5), uuid(6)] : rows.map(row => row.id).sort());
          assert.equal(await page.locator("#studio-retry").count(), 0);
          assert.equal(trashCalls(state).length, 1, "Refreshing the catalog must not repeat Trash or Restore.");
          assert.equal(state.rows.get(uuid(5)).revision, 2);
          assert.equal(await page.locator(`[data-filter="${action === "trash" ? "trash" : "all"}"]`).getAttribute("aria-pressed"), "true");
          if (action === "trash") await waitTrashed(page);
          else assert.equal(await page.locator("#studio-name").inputValue(), draftName);
        });
      }
    });
    await test("a confirmed Trash or Restore permits leaving during the following catalog read", async () => {
      for (const action of ["trash", "restore"]) {
        const row = draft(uuid(5), draftName);
        if (action === "restore") Object.assign(row, { canTrash: false, trashedAt: fixtureDate });
        const state = server([row]);
        await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
          await waitStudio(page);
          if (action === "restore") {
            await page.locator('[data-filter="trash"]').click();
            await page.waitForSelector(studioItem(row.id));
          }
          await page.locator(studioItem(row.id)).click();
          const hold = deferred(); state.held.set("/api/admin/veilings", hold);
          if (action === "trash") { await openTrash(page); await page.locator("#studio-publish-confirm").click(); }
          else await page.locator("#studio-restore").click();
          await signal(hold.requested);
          assert.equal(state.rows.get(row.id).revision, 2);
          assert.equal(Boolean(state.rows.get(row.id).trashedAt), action === "trash");
          await navigate(page, "collection"); await page.waitForSelector("#dashboard-view:not([hidden])");
          assert.equal(await page.locator("#studio-leave-dialog[open]").count(), 0);
          hold.release(); await signal(hold.finished);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(new URL(page.url()).hash, "#collection");
          assert(await page.locator("#dashboard-view").isVisible());
          assert.equal(await page.locator("#veiling-studio-content").textContent(), "");
          assert.equal(trashCalls(state).length, 1);
        });
      }
    });
    await test("post-Trash catalog timeout restores controls and ignores its late response before a safe retry", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin", fastReadDeadline: true }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        const hold = deferred(); state.held.set("/api/admin/veilings", hold);
        await openTrash(page); await page.locator("#studio-publish-confirm").click(); await signal(hold.requested);
        await page.waitForSelector("#studio-list-feedback #studio-retry:not([disabled])");
        await waitTrashed(page); await waitStudio(page);
        assert.match(await page.locator("#studio-list-feedback").textContent(), /took too long/);
        assert.equal(state.rows.get(uuid(5)).revision, 2);
        assert.equal(trashCalls(state).length, 1);
        const laterName = "Later server draft after the read deadline";
        state.rows.get(uuid(5)).name = laterName;
        state.rows.get(uuid(5)).revision++;
        hold.release(); await signal(hold.finished);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert((await page.locator("#studio-editor").textContent()).includes(draftName));
        assert(!(await page.locator("#studio-editor").textContent()).includes(laterName), "An expired catalog request must not overwrite the confirmed row.");
        assert(await page.locator("#studio-retry").isVisible());
        await page.locator("#studio-retry").click(); await waitTrashed(page); await waitStudio(page);
        assert((await page.locator("#studio-editor").textContent()).includes(laterName));
        assert.equal(await page.locator("#studio-retry").count(), 0);
        assert.equal(trashCalls(state).length, 1);
      });
    });
    await test("creating a new draft from Trash switches to the active catalog and leaves trashed records recoverable", async () => {
      const archived = draft(uuid(5), draftName);
      Object.assign(archived, { canTrash: false, trashedAt: fixtureDate });
      const state = server([archived]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page);
        await page.locator('[data-filter="trash"]').click();
        await page.waitForSelector(studioItem(archived.id));
        await page.locator(studioItem(archived.id)).click(); await waitTrashed(page);
        await page.locator("#studio-create").click(); await waitStudio(page);
        assert.equal(await page.locator('[data-filter="all"]').getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator("#studio-restore, #studio-trash").count(), 0);
        await page.locator("#studio-name").fill("Fresh draft created from Trash"); await saveDraft(page);
        assert.equal(state.rows.get(uuid(20)).trashedAt, null);
        assert.equal(state.rows.get(uuid(20)).canTrash, true);
        assert.equal(state.rows.get(uuid(20)).publication, null);
        assert(await page.locator(studioItem(uuid(20))).isVisible());
        assert.equal(await page.locator(studioItem(archived.id)).count(), 0);
        await page.locator('[data-filter="trash"]').click();
        await page.waitForSelector(studioItem(archived.id));
        assert.equal(await page.locator(studioItem(uuid(20))).count(), 0);
        assert.equal(state.rows.get(archived.id).trashedAt, fixtureDate);
        assert.equal(trashCalls(state).length, 0);
      });
    });
    await test("Trash confirmation closes on navigation without mutating or reopening on Back", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "dashboard" }], async ({ page }) => {
        await page.waitForSelector("#hub-view:not([hidden])");
        await navigate(page, "admin"); await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await openTrash(page); await navigate(page, "collection");
        await page.waitForSelector("#dashboard-view:not([hidden])");
        assert.equal(await page.locator("#studio-publish-dialog[open]").count(), 0);
        assert.equal(trashCalls(state).length, 0);
        await page.goBack(); await waitStudio(page);
        assert.equal(await page.locator("#studio-publish-dialog[open]").count(), 0);
        assert.equal(trashCalls(state).length, 0);
      });
    });
    await test("late Trash and Restore responses cannot revive Studio after session expiry", async () => {
      for (const action of ["trash", "restore"]) {
        const row = draft(uuid(5), "Session-bound recoverable draft");
        if (action === "restore") Object.assign(row, { canTrash: false, trashedAt: fixtureDate });
        const state = server([row]);
        await withFixtures(browser, state, [{ admin: true, hash: "admin", captureExpiry: true }], async ({ page }) => {
          await waitStudio(page);
          if (action === "restore") { await page.locator('[data-filter="trash"]').click(); await page.waitForSelector(studioItem(row.id)); }
          await page.locator(studioItem(row.id)).click();
          const hold = deferred(); state.held.set(`/api/admin/veilings/${row.id}/${action}`, hold);
          if (action === "trash") { await openTrash(page); await page.locator("#studio-publish-confirm").click(); }
          else await page.locator("#studio-restore").click();
          await signal(hold.requested);
          await page.evaluate(() => window.expireFixtureSession());
          await page.waitForSelector("#auth-view:not([hidden])");
          hold.release(); await signal(hold.finished);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          assert.equal(new URL(page.url()).hash, "#signin");
          assert.equal(await page.locator("#veiling-studio-content").textContent(), "");
          assert.equal(await page.locator("#studio-publish-dialog[open], #studio-restore").count(), 0);
          assert(!(await page.locator("body").textContent()).includes(row.name));
        });
      }
    });
    await test("unavailable artwork storage disables uploads while text drafts remain usable", async () => {
      const state = server(); state.artworkAvailable = false;
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await page.waitForFunction(() => document.querySelector("#studio-artwork-hint")?.textContent.includes("not configured"));
        assert(await page.locator("#studio-artwork").isDisabled());
        assert(!(await page.locator("#studio-save").isDisabled()));
        await page.locator("#studio-description").fill("Text saves without artwork storage."); await saveDraft(page);
        assert.equal(state.rows.get(uuid(5)).description, "Text saves without artwork storage.");
        assert(await page.locator("#studio-artwork").isDisabled());
        assert(!(await page.locator("#studio-trash").isDisabled()));
        assert(!state.calls.some(call => call.path.endsWith("/artwork") && call.method === "POST"));
        await checkAxe(page); await checkOverflow(page);
      });
    });
    await test("artwork capability probe failure is safe and does not block draft saving", async () => {
      const state = server(); state.failures.set("/api/admin/artwork-status", 1);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await page.waitForFunction(() => document.querySelector("#studio-artwork-hint")?.textContent.includes("could not be checked"));
        assert(!(await page.locator("#studio-artwork").isDisabled()));
        assert(!(await page.locator("body").textContent()).includes(privateMessage));
        await page.locator("#studio-description").fill("Probe failures do not lose text."); await saveDraft(page);
        assert.equal(state.rows.get(uuid(5)).description, "Probe failures do not lose text.");
        assert.equal(state.calls.filter(call => call.path === "/api/admin/artwork-status").length, 1);
      });
    });
    await test("artwork storage loss preserves the partial text save and pending file until cleared", async () => {
      const state = server();
      state.responses.set(`/api/admin/veilings/${uuid(5)}/artwork`, { code: "ARTWORK_UNAVAILABLE", status: 503 });
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await page.locator("#studio-description").fill("Confirmed text survives missing storage.");
        await page.locator("#studio-artwork").setInputFiles(artworkFile());
        await page.locator("#studio-save").click();
        await page.waitForFunction(() => document.querySelector("#studio-editor-feedback")?.textContent.includes("Draft saved, but artwork storage is not configured") && document.querySelector("#studio-artwork").disabled);
        assert.equal(state.rows.get(uuid(5)).description, "Confirmed text survives missing storage.");
        assert.equal(state.rows.get(uuid(5)).revision, 2);
        assert.equal(await page.locator("#studio-artwork").evaluate(node => node.files.length), 1);
        assert(await page.locator("#studio-save").isDisabled());
        assert(await page.locator("#studio-trash").isDisabled());
        assert(await page.locator('[data-studio-action="public"]').isDisabled());
        assert(!(await page.locator("#studio-clear-artwork").isDisabled()));
        await page.locator("#studio-clear-artwork").click();
        assert(!(await page.locator("#studio-save").isDisabled()));
        assert(!(await page.locator("#studio-trash").isDisabled()));
        assert(await page.locator("#studio-artwork").isDisabled());
        assert.equal(await page.locator("#studio-artwork").evaluate(node => node.files.length), 0);
        assert.equal(state.calls.filter(call => call.path.endsWith("/artwork") && call.method === "POST").length, 1);
        assert(!state.calls.some(call => call.path.endsWith("/publication")));
      });
    });
    await test("Trash confirmation and read-only recovery stay keyboard accessible on mobile", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin", width: 390 }], async ({ page }) => {
        await waitStudio(page); await page.locator(studioItem(uuid(5))).click();
        await page.locator("#studio-trash").focus(); await page.keyboard.press("Enter");
        await page.waitForSelector("#studio-publish-dialog[open]");
        assert(await page.locator("#studio-publish-cancel").evaluate(node => document.activeElement === node));
        await checkAxe(page); await checkOverflow(page);
        await page.locator("#studio-publish-confirm").click(); await waitTrashed(page);
        await checkAxe(page); await checkOverflow(page);
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 900 }); await screenshot(page, `studio-trash-${width}px.png`);
        }
        await page.locator("#studio-restore").focus(); await page.keyboard.press("Enter");
        await page.waitForSelector("#studio-trash:not([disabled])");
        assert.equal(state.rows.get(uuid(5)).trashedAt, null);
      });
    });
    await test("dirty Studio survives every route, repeated navigation, Back and Forward cancellation", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "dashboard" }], async ({ page }) => {
        await page.waitForSelector("#hub-view:not([hidden])");
        await navigate(page, "admin"); await waitStudio(page);
        await page.locator("#studio-create").click();
        await page.locator("#studio-name").fill("Unsaved route draft");
        const lore = "Private unsaved lore. ".repeat(80);
        await page.locator("#studio-description").fill(lore);
        for (const destination of ["dashboard", "collection", "explore", "upcoming", "accounts", "settings", "reset-password"]) {
          await navigate(page, destination);
          await page.waitForSelector("#studio-leave-dialog[open]");
          assert.equal(await page.locator("#studio-name").inputValue(), "Unsaved route draft");
          await page.locator("#studio-leave-keep").click();
          await page.waitForFunction(() => location.hash === "#admin");
          assert.equal(await page.locator("#studio-description").inputValue(), lore);
        }
        await navigate(page, "collection"); await page.waitForSelector("#studio-leave-dialog[open]");
        await navigate(page, "settings");
        assert.equal(await page.locator("#studio-leave-dialog[open]").count(), 1);
        await page.keyboard.press("Escape"); await page.waitForFunction(() => location.hash === "#admin");
        assert.equal(await page.locator("#studio-description").inputValue(), lore);
        await page.goBack(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-keep").click(); await page.waitForFunction(() => location.hash === "#admin");
        await page.goBack(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-discard").click(); await page.waitForSelector("#hub-view:not([hidden])");
        await page.goForward(); await waitStudio(page);
        assert.equal(await page.locator("#studio-editor-form").count(), 0);
        await navigate(page, "settings"); await page.waitForSelector("#signed-in-account:not([hidden])");
        await page.goBack(); await waitStudio(page);
        await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Forward draft");
        await page.goForward(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-keep").click(); await page.waitForFunction(() => location.hash === "#admin");
        assert.equal(await page.locator("#studio-name").inputValue(), "Forward draft");
        assert.equal(state.calls.filter(call => call.method !== "GET").length, 0);
      });
    });
    await test("Studio saves privately before leaving and failed saves keep the draft", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator("#studio-create").click();
        await page.locator("#studio-name").fill("Saved before navigating");
        await page.locator("#navigation-toggle").click();
        await page.locator('#sidebar-nav a[data-nav="collection"]').click();
        await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-save").click();
        await page.waitForSelector("#dashboard-view:not([hidden])");
        assert.equal(state.rows.get(uuid(20)).name, "Saved before navigating");
        assert.equal(state.rows.get(uuid(20)).publication, null);
        await navigate(page, "admin"); await waitStudio(page); await page.locator(studioItem(uuid(20))).click();
        await page.locator("#studio-description").fill("These words must survive a failed save.");
        state.failures.set(`/api/admin/veilings/${uuid(20)}`, 1);
        await navigate(page, "dashboard"); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-save").click();
        await page.waitForFunction(() => document.querySelector("#studio-leave-feedback")?.textContent.includes("could not be completed"));
        assert(await page.locator("#studio-leave-dialog").isVisible());
        await page.locator("#studio-leave-keep").click(); await page.waitForFunction(() => location.hash === "#admin");
        assert.equal(await page.locator("#studio-description").inputValue(), "These words must survive a failed save.");
        assert.equal(state.rows.get(uuid(20)).description, "");
        assert(!state.calls.some(call => call.path.endsWith("/publication")));
      });
    });
    await test("Studio guards sign-out and external navigation, warns on unload, and clears private drafts on sign-out", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Sign-out draft");
        assert(await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
        }));
        await page.locator("a.brand").click(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-keep").click();
        assert.equal(new URL(page.url()).hash, "#admin");
        await page.locator("#sign-out").click(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-keep").click();
        assert(!state.calls.some(call => call.path === "/api/auth/logout"));
        await page.locator("#sign-out").click(); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-save").click(); await page.waitForSelector("#auth-view:not([hidden])");
        assert.equal(state.rows.get(uuid(20)).name, "Sign-out draft");
        assert.equal(state.rows.get(uuid(20)).publication, null);
        assert.equal(await page.locator("#veiling-studio-content").textContent(), "");
        assert.equal(state.calls.filter(call => call.path === "/api/auth/logout").length, 1);
        assert(!(await page.locator("body").textContent()).includes("Sign-out draft"));
      });
    });
    await test("forced 401 and session expiry clear Studio drafts even while a leave confirmation is open", async () => {
      for (const expired of [false, true]) {
        const state = server([]);
        await withFixtures(browser, state, [{ admin: true, hash: "admin", captureExpiry: expired }], async ({ page }) => {
          await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Session-bound private draft");
          await navigate(page, "collection"); await page.waitForSelector("#studio-leave-dialog[open]");
          if (expired) await page.evaluate(() => window.expireFixtureSession());
          else {
            state.unauthorized.add("/api/admin/veilings");
            await page.locator("#studio-leave-save").click();
          }
          await page.waitForSelector("#auth-view:not([hidden])");
          await page.waitForFunction(() => location.hash === "#signin");
          assert.equal(await page.locator("#studio-leave-dialog").count(), 0);
          assert.equal(await page.locator("#veiling-studio-content").textContent(), "");
          assert(!(await page.locator("body").textContent()).includes("Session-bound private draft"));
          assert.equal(state.rows.size, 0);
        });
      }
    });
    await test("a saved response arriving after session expiry cannot restore the private Studio", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin", captureExpiry: true }], async ({ page }) => {
        await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Late private result");
        const hold = deferred(); state.held.set("/api/admin/veilings", hold);
        await navigate(page, "collection"); await page.waitForSelector("#studio-leave-dialog[open]");
        await page.locator("#studio-leave-save").click(); await signal(hold.requested);
        await page.evaluate(() => window.expireFixtureSession());
        await page.waitForSelector("#auth-view:not([hidden])");
        hold.release(); await signal(hold.finished);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(new URL(page.url()).hash, "#signin");
        assert.equal(await page.locator("#studio-leave-dialog").count(), 0);
        assert.equal(await page.locator("#veiling-studio-content").textContent(), "");
        assert(!(await page.locator("body").textContent()).includes("Late private result"));
      });
    });
    await test("Studio blocks departure during a save and allows it after the save settles", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("In-flight draft");
        const hold = deferred(); state.held.set("/api/admin/veilings", hold);
        await page.locator("#studio-save").click(); await signal(hold.requested);
        await navigate(page, "collection"); await page.waitForFunction(() => location.hash === "#admin");
        await page.locator("#sign-out").click();
        assert(!state.calls.some(call => call.path === "/api/auth/logout"));
        hold.release(); await signal(hold.finished);
        await page.waitForFunction(() => document.querySelector("#studio-save")?.disabled === false);
        await navigate(page, "collection"); await page.waitForSelector("#dashboard-view:not([hidden])");
        assert.equal(state.rows.get(uuid(20)).name, "In-flight draft");
      });
    });
    await test("keyboard skip link preserves every main destination and unsaved Studio content", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "dashboard" }], async ({ page }) => {
        for (const destination of ["dashboard", "collection", "explore", "upcoming", "accounts", "settings", "admin"]) {
          await navigate(page, destination);
          if (destination === "admin") {
            await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Skip-safe draft");
          } else if (["explore", "upcoming"].includes(destination)) await waitShowcase(page);
          else await page.waitForFunction(hash => location.hash === `#${hash}`, destination);
          const url = page.url();
          await page.locator(".skip-link").focus(); await page.keyboard.press("Enter");
          assert.equal(page.url(), url);
          assert(await page.locator("#main-content").evaluate(node => document.activeElement === node));
          assert.equal(await page.locator("#studio-leave-dialog").count(), 0);
          if (destination === "admin") assert.equal(await page.locator("#studio-name").inputValue(), "Skip-safe draft");
        }
      });
    });
    await test("admin discovery failure or timeout never blocks a healthy personal collection", async () => {
      for (const timeout of [false, true]) {
        const state = server();
        const hold = timeout ? deferred() : null;
        if (hold) state.held.set("/api/admin/access", hold);
        else state.failures.set("/api/admin/access", 1);
        await withFixtures(browser, state, [{ admin: true, hash: "collection", fastReadDeadline: timeout }], async ({ page }) => {
          await page.waitForSelector("#dashboard-view:not([hidden])");
          await page.waitForSelector("#admin-access-status:not([hidden])");
          assert(await page.locator("#loading-status").isHidden());
          assert(await page.locator("#admin-nav").isHidden());
          if (hold) { hold.release(); await signal(hold.finished); }
          await page.locator("#admin-access-status button").click();
          await page.waitForFunction(() => document.querySelector("#admin-nav").hidden === false);
          assert(await page.locator("#dashboard-view").isVisible());
          assert(await page.locator("#admin-access-status").isHidden());
        });
      }
    });
    await test("collection refresh errors settle loading and preserve the last successful snapshot", async () => {
      const state = server([]);
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }], async ({ page }) => {
        await waitStudio(page); await page.locator("#studio-create").click(); await page.locator("#studio-name").fill("Refresh fixture");
        state.failures.set("/api/dashboard", 1);
        await saveDraft(page);
        await page.waitForFunction(() => document.querySelector("#loading-status")?.textContent.includes("last loaded collection"));
        await navigate(page, "collection"); await page.waitForSelector("#dashboard-view:not([hidden])");
        assert.match(await page.locator("#loading-status").textContent(), /couldn’t refresh/);
        assert.equal(await page.locator("#collection-filter").count(), 0);
        assert.equal(await page.locator("#catalog-search").getAttribute("placeholder"), "Search my collection…");
        await page.locator("#loading-status button").click();
        await page.waitForSelector("#loading-status", { state: "hidden" });
        assert(await page.locator("#dashboard-view").isVisible());
      });
    });
    await test("showcase and studio are keyboard accessible and fit mobile with enlarged text", async () => {
      const state = server();
      await withFixtures(browser, state, [{ admin: true, hash: "admin" }, {}], async ({ page }, member) => {
        await waitStudio(page); await waitShowcase(member.page);
        await page.locator(studioItem(uuid(5))).focus(); await page.keyboard.press("Enter");
        assert(await page.locator("#studio-name").evaluate(node => document.activeElement === node));
        await checkAxe(page); await checkOverflow(page);
        await page.locator('[data-studio-action="public"]').focus(); await page.keyboard.press("Enter");
        await page.waitForSelector("#studio-publish-dialog[open]");
        assert(await page.locator("#studio-publish-cancel").evaluate(node => document.activeElement === node));
        await checkAxe(page); await checkOverflow(page);
        await page.keyboard.press("Escape");
        assert(await page.locator('[data-studio-action="public"]').evaluate(node => document.activeElement === node));
        assert.equal(state.calls.filter(call => call.path.endsWith("/publication")).length, 0);
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 900 }); await screenshot(page, `studio-${width}px.png`);
          await member.page.setViewportSize({ width, height: 900 }); await checkAxe(member.page); await screenshot(member.page, `showcase-${width}px.png`);
        }
        await checkOverflow(member.page);
        await member.page.locator(memberCard(uuid(1))).focus(); await member.page.keyboard.press("Enter");
        await waitMemberDetail(member.page, publicName);
        await checkAxe(member.page); await checkOverflow(member.page);
      });
    });
  } finally { await browser.close(); }
  assert(passed > 0 || issues.length > 0, "No showcase browser checks matched TEST_FILTER.");
  if (issues.length) { console.error(`\n${issues.length} showcase browser checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${passed} local showcase browser checks passed. Hosted publication and authorization were not tested.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
