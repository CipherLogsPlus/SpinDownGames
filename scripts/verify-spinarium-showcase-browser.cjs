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
  return { id, name, description: `${name}: saved draft description.`, character_number: null, status: "draft", rarity: null, edition: null, artworkUrl: null, revision: 1, publication: null };
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
  return { rows: new Map(rows.map(row => [row.id, clone(row)])), calls: [], errors: [], failures: new Map(), held: new Map(), nextConflict: false, nextId: 20 };
}
async function fixture(browser, state, { admin = false, signedIn = true, hash = "explore?filter=discovered", width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  let authenticated = signedIn;
  const errors = [];
  try {
    // The baseline ribbon intro is covered separately; this is only a device
    // presentation preference, with no role or account authority.
    await context.addInitScript(key => localStorage.setItem(key, "seen"), introKey);
    if (signedIn) await context.addCookies([{ name: "spinarium_session", value: cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.route("**/spinarium/config.js*", route => route.fulfill({ status: 200, contentType: "text/javascript",
      body: 'export const spinariumConfig = Object.freeze({previewEnabled:false,backend:"cloudflare",authProvider:"password",apiBase:"/api",signupEnabled:false});' }));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), headers = request.headers(), method = request.method();
      state.calls.push({ path: url.pathname, method, admin, csrf: headers["x-csrf-token"], ifMatch: headers["if-match"], authorization: headers.authorization,
        body: request.postData(), url: request.url() });
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
        if (url.pathname === "/api/dashboard" && method === "GET") return respond(emptyDashboard());
        if (url.pathname === "/api/admin/access" && method === "GET") return respond({ admin, role: admin ? "admin" : null });
        if (url.pathname === `/api/artwork/${uuid(80)}` && method === "GET") {
          if (!admin && ![...state.rows.values()].some(row => row.publication?.artworkUrl === url.pathname)) return respond({ code: "NOT_FOUND" }, 404);
          return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" },
            body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUc0thYGBgYmBgYGBgAAAJRADMgBbzgwAAAABJRU5ErkJggg==", "base64") });
        }
        const hold = state.held.get(url.pathname);
        if (hold) { state.held.delete(url.pathname); hold.markRequested(); await hold.wait; }
        try {
          if (state.failures.get(url.pathname)) {
            state.failures.set(url.pathname, state.failures.get(url.pathname) - 1);
            return await respond({ code: "UNAVAILABLE", message: privateMessage }, 503);
          }
          if (url.pathname === "/api/showcase" && method === "GET") return await respond({ schemaVersion: "1", mode: "live", veilings: [...state.rows.values()].map(publicSnapshot).filter(Boolean) });
          const detail = /^\/api\/showcase\/([^/]+)$/.exec(url.pathname);
          if (detail && method === "GET") {
            const row = state.rows.get(detail[1]);
            return await respond(row?.publication ? { schemaVersion: "1", mode: "live", veiling: publicSnapshot(row) } : { code: "NOT_FOUND", message: privateMessage }, row?.publication ? 200 : 404);
          }
          if (url.pathname.startsWith("/api/admin/veilings")) {
            if (!admin) return await respond({ code: "ADMIN_REQUIRED" }, 403);
            if (url.pathname === "/api/admin/veilings" && method === "GET") return await respond([...state.rows.values()].map(clone));
            if (url.pathname === "/api/admin/veilings" && method === "POST") {
              const input = request.postDataJSON();
              assert(!("publication" in input), "Saving a draft cannot approve member content.");
              const row = { ...draft(uuid(state.nextId++), input.name), description: input.description, character_number: input.number,
                status: input.status, rarity: input.rarity, edition: input.edition };
              state.rows.set(row.id, row); return await respond(clone(row), 201);
            }
            const match = /^\/api\/admin\/veilings\/([^/]+)(\/publication)?$/.exec(url.pathname);
            if (match) {
              const row = state.rows.get(match[1]);
              if (!row) return await respond({ code: "NOT_FOUND" }, 404);
              assert.equal(headers["if-match"], `"${row.revision}"`, "Mutations must use the loaded revision.");
              if (state.nextConflict) {
                state.nextConflict = false; row.revision++; row.name = "Concurrent server draft";
                return await respond({ code: "CATALOG_CHANGED", message: privateMessage }, 409);
              }
              const input = request.postDataJSON();
              if (!match[2] && method === "PATCH") {
                Object.assign(row, { name: input.name, description: input.description, character_number: input.number,
                  status: input.status, rarity: input.rarity, edition: input.edition, revision: row.revision + 1 });
                return await respond(clone(row));
              }
              if (match[2] && method === "POST") {
                assert.deepEqual(Object.keys(input).sort(), ["releaseDate", "useSavedDraft", "visibility"]);
                assert(["public", "upcoming", "private"].includes(input.visibility));
                assert.equal(typeof input.useSavedDraft, "boolean");
                assert(input.releaseDate === null || /^\d{4}-\d{2}-\d{2}$/.test(input.releaseDate));
                assert(input.visibility === "upcoming" || input.releaseDate === null);
                assert(input.visibility !== "private" || input.useSavedDraft === false);
                if (input.visibility !== "private" && !input.useSavedDraft && !row.publication) return await respond({ code: "PUBLICATION_REQUIRED" }, 409);
                row.revision++;
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
