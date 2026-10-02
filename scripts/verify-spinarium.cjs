// Browser checks intercept only local, test-only Worker responses. They do not
// verify Cloudflare account access, deployment, DNS, or hosted cookies.
// NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = (process.env.BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const root = path.resolve(__dirname, "..");
const preservationRef = process.env.PRESERVATION_REF || "a7e1dad";
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const issues = [];
let passed = 0;
const introKey = "spinarium.preview.introduction.v3";
const fixtureCookie = "spinarium-browser-test-only-session";
const fixtureCsrf = "spinarium_test_only_csrf_12345678901234567890";
const fixturePassword = "Test-only-passphrase42!";
const fixtureUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  displayName: "QA Collector",
  email: "collector@example.test",
  memberSince: "2026-10-01T12:00:00Z",
  // Editable identity claims never grant a browser administrator authority.
  role: "superadmin", is_admin: true,
};
const emptySnapshot = () => ({
  schemaVersion: "1", mode: "live",
  profile: { id: fixtureUser.id, displayName: fixtureUser.displayName, memberSince: fixtureUser.memberSince, avatarSrc: null },
  veilings: [], series: [], editions: [], variants: [], rarities: [],
  physicalCards: [], ownerships: [], discoveries: [], achievements: [],
  userAchievements: [], collections: [], news: [], events: [],
});
function ownedSnapshot() {
  const snapshot = emptySnapshot();
  const veilingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  snapshot.veilings.push({
    id: veilingId, number: 1, name: "Browser Fixture Veiling", type: "Fixture",
    origin: "Local browser verification", editionIds: [], artwork: [],
    lore: [{ id: "fixture-lore", locale: "en", title: "Fixture story", preview: "Test-only preview.", text: "Test-only story supplied by the intercepted API.", status: "published", version: 1 }],
    releaseDate: "2026-10-01", contentStatus: "published",
  });
  snapshot.ownerships.push({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", userId: fixtureUser.id,
    veilingId, acquisition: "server_grant", physicalCardId: null,
    editionId: null, variantId: null, acquiredAt: "2026-10-01T12:00:00Z",
  });
  snapshot.discoveries.push({
    veilingId, status: "revealed", firstDiscoveredAt: "2026-10-01T12:00:00Z",
    firstDiscovererId: null, publicDiscovererName: null, revealKind: "launch",
  });
  return snapshot;
}
const test = async (name, fn) => {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { issues.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); }
};
function observe(page) {
  const errors = [], failedResponses = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push({
    url: request.url(), method: request.method(), hasBody: request.postData() !== null,
    authorization: request.headers().authorization || null,
  }));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  return { errors, failedResponses, requests };
}
async function assertBlankCards(page, scope, expectedCount) {
  const cards = page.locator(`${scope} .blank-card`);
  assert.equal(await cards.count(), expectedCount);
  const invalid = await cards.evaluateAll((nodes) => nodes.flatMap((node, index) => {
    const style = getComputedStyle(node);
    const pseudo = [getComputedStyle(node, "::before"), getComputedStyle(node, "::after")];
    const valid = style.backgroundColor === "rgb(0, 0, 0)" &&
      style.backgroundImage === "none" && style.maskImage === "none" &&
      pseudo.every((value) => value.content === "none" || value.content === "normal") &&
      node.querySelectorAll("img, svg, picture, canvas, video").length === 0 &&
      node.textContent.trim() === "" && !node.hasAttribute("data-card-id") &&
      !node.hasAttribute("data-card-number");
    return valid ? [] : [index];
  }));
  assert.deepEqual(invalid, [], "Placeholders must be plain black without character data");
}
function assertNoDemoRequests(requests) {
  assert.deepEqual(requests.filter(({ url }) => /demo-service|\/assets\/spinarium\/(?:ashenling|duskspore|lumenkit|crysthale|embercoil|zephyryn|silhouette)\b/i.test(new URL(url).pathname)), [], "The app requested demo data or concept characters");
}
function assertNoSecretsInURLs(requests) {
  assert.deepEqual(requests.filter(({ url }) => {
    const parsed = new URL(url);
    return [...parsed.searchParams.keys()].some((key) => /^(?:password|access_token|refresh_token|claim_code|claim_token)$/i.test(key)) || url.includes(fixtureCookie) || url.includes(fixtureCsrf) || url.includes(fixturePassword);
  }), [], "A credential was placed in a request URL");
}
async function storage(page) {
  return page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
}
async function assertNoBrowserCredentials(page) {
  const actual = await storage(page);
  // This browser-local presentation preference never represents identity or authority.
  if (actual.local[introKey] !== undefined) {
    assert.equal(actual.local[introKey], "seen");
    delete actual.local[introKey];
  }
  assert.deepEqual(actual, { local: {}, session: {}, cookie: "" });
}
async function checkAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
  assert.deepEqual(result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })), []);
}
async function checkOverflow(page, width, scale) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%`; }, scale);
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert(size.document <= size.viewport + 1, JSON.stringify(size));
}
async function createFixture(browser, { scenario = "empty", signedIn = false, signupEnabled = false, apiBase = "/api", reducedMotion = "reduce", mockSpeech = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion });
  if (mockSpeech) await context.addInitScript(() => {
    window.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(line) { window.__spoken.push(line.text); setTimeout(() => line.onend?.(), 20); } } });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(text) { this.text = text; } } });
  });
  const calls = [];
  const state = { signedIn, admin: scenario === "admin", expireDashboard: false, adminRows: [], nextConflict: false, holdSave: false, releaseSave: null };
  if (signedIn) await context.addCookies([{ name: "spinarium_session", value: fixtureCookie, url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.route("**/spinarium/config.js*", (route) => route.fulfill({
    status: 200, contentType: "text/javascript",
    body: `export const spinariumConfig = Object.freeze(${JSON.stringify({ previewEnabled: false, backend: "cloudflare", authProvider: "password", apiBase, signupEnabled })});`,
  }));
  await context.route("**/api/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = request.headers();
    calls.push({ path: url.pathname, method, csrf: headers["x-csrf-token"], authorization: headers.authorization, body: request.postData(), cookie: headers.cookie || "" });
    const respond = (value, status = 200, responseHeaders = {}) => route.fulfill({ status, headers: { "cache-control": "no-store", ...responseHeaders }, contentType: "application/json", body: status === 204 ? "" : JSON.stringify(value) });
    if (url.pathname === "/api/auth/session" && method === "GET") {
      if (scenario === "unavailable") return respond({ error: "Private provider detail must never be rendered" }, 503);
      if (scenario === "malformed") return respond({ user: { ...fixtureUser, id: "invalid-id" }, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() });
      if (!state.signedIn) return respond({ error: "UNAUTHORIZED" }, 401);
      assert(headers.cookie?.includes(fixtureCookie));
      return respond({ user: fixtureUser, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() });
    }
    if (url.pathname === "/api/auth/login" && method === "POST") {
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ["email", "password"]);
      assert.equal(body.email, fixtureUser.email);
      if (scenario === "invalid-login" || body.password !== fixturePassword)
        return respond({ code: "INVALID_CREDENTIALS", message: `Private backend detail: ${body.password}` }, 401);
      state.signedIn = true;
      return respond({ user: fixtureUser, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 200,
        { "set-cookie": `spinarium_session=${fixtureCookie}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (url.pathname === "/api/auth/signup" && method === "POST") {
      const body = request.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ["displayName", "email", "password"]);
      assert.deepEqual(body, { email: fixtureUser.email, password: fixturePassword, displayName: fixtureUser.displayName });
      if (scenario === "duplicate-signup")
        return respond({ code: "ACCOUNT_UNAVAILABLE", message: `Private backend detail: ${body.password}` }, 400);
      state.signedIn = true;
      return respond({ user: fixtureUser, csrfToken: fixtureCsrf, expiresAt: new Date(Date.now() + 3600000).toISOString() }, 201,
        { "set-cookie": `spinarium_session=${fixtureCookie}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (url.pathname === "/api/auth/logout" && method === "POST") {
      assert.equal(headers["x-csrf-token"], fixtureCsrf);
      assert.equal(request.postData(), "{}");
      state.signedIn = false;
      return respond({ signedOut: true }, 200, { "set-cookie": "spinarium_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    }
    if (!state.signedIn) return respond({ error: "UNAUTHORIZED" }, 401);
    assert(headers.cookie?.includes(fixtureCookie));
    if (url.pathname === "/api/dashboard" && method === "GET") return state.expireDashboard ? respond({ error: "UNAUTHORIZED" }, 401) : respond(scenario === "owned" ? ownedSnapshot() : emptySnapshot());
    if (url.pathname === "/api/admin/access" && method === "GET") return respond({ admin: state.admin });
    if (url.pathname === "/api/admin/veilings" && method === "GET") return state.admin ? respond(state.adminRows) : respond({ error: "FORBIDDEN" }, 403);
    if (url.pathname === "/api/admin/veilings" && method === "POST") {
      if (!state.admin) return respond({ error: "FORBIDDEN" }, 403);
      assert.equal(headers["x-csrf-token"], fixtureCsrf);
      const input = request.postDataJSON();
      const row = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: input.name, description: input.description, character_number: input.number, status: input.status, rarity: input.rarity, edition: input.edition, artworkUrl: null, revision: 1 };
      state.adminRows = [row];
      return respond(row, 201);
    }
    if (/^\/api\/admin\/veilings\/[0-9a-f-]+$/.test(url.pathname) && method === "PATCH") {
      if (!state.admin) return respond({ error: "FORBIDDEN" }, 403);
      assert.equal(headers["x-csrf-token"], fixtureCsrf);
      if (state.holdSave) await new Promise((resolve) => { state.releaseSave = resolve; });
      const existing = state.adminRows[0];
      assert.equal(headers["if-match"], `"${existing.revision}"`);
      if (state.nextConflict) {
        state.nextConflict = false;
        state.adminRows = [{ ...existing, name: "Concurrent server change", revision: existing.revision + 1 }];
        return respond({ error: "STALE_REVISION" }, 409);
      }
      const input = request.postDataJSON();
      const row = { ...existing, name: input.name, description: input.description, revision: existing.revision + 1 };
      state.adminRows = [row];
      return respond(row);
    }
    return respond({ error: "Unexpected test-only Worker endpoint" }, 400);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const observed = observe(page);
  const sessionResponse = apiBase === "/api"
    ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session")
    : null;
  await page.goto(`${base}/spinarium/#signin`, { waitUntil: "commit", timeout: 30000 });
  if (sessionResponse) await sessionResponse;
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !document.body.classList.contains("static-preview") &&
    document.querySelector("#auth-email")?.type === "email" &&
    !document.querySelector("#auth-password-group")?.hidden);
  if (signedIn && !["unavailable", "malformed"].includes(scenario)) {
    await page.waitForSelector("#hub-view:not([hidden])");
    await page.waitForFunction(() => !document.querySelector("#first-login-intro").open);
  }
  if (["unavailable", "malformed"].includes(scenario))
    await page.waitForFunction(() => document.querySelector("#auth-feedback")?.textContent.trim());
  await page.evaluate(() => document.fonts.ready);
  return { context, page, calls, state, observed };
}
async function previewSignIn(page, password = "1234") {
  await page.locator("#auth-email").fill("admin");
  await page.locator("#auth-password").fill(password);
  await page.locator("#auth-password").press("Enter");
}
async function passwordSignIn(page, password = fixturePassword) {
  await page.locator("#auth-email").fill(fixtureUser.email);
  await page.locator("#auth-password").fill(password);
  await page.locator("#auth-submit").click();
}
async function passwordSignup(page) {
  await page.locator("#signup-tab").click();
  await page.waitForFunction(() => location.hash === "#signup" && document.querySelector("#auth-submit").textContent === "Create account");
  await page.locator("#auth-display-name").fill(fixtureUser.displayName);
  await page.locator("#auth-email").fill(fixtureUser.email);
  await page.locator("#auth-password").fill(fixturePassword);
  await page.locator("#auth-confirm-password").fill(fixturePassword);
  await page.locator("#auth-submit").click();
}
async function openCollection(page) {
  await page.locator('#hub-view a[href="#collection?filter=owned"]').click();
  await page.waitForSelector("#dashboard-view:not([hidden])");
}
async function assertEmptyCollection(page, memberSince) {
  assert.equal(await page.locator("#collection-grid [data-card-id]").count(), 0);
  assert.match(await page.locator("#collection-status").innerText(), /collection is empty/i);
  assert.deepEqual(await page.locator("#stats .stat-card strong").allTextContents(), ["0", "0", "0", "0", memberSince]);
  assert(await page.locator("#detail-panel").isHidden());
  await assertBlankCards(page, "#collection-grid", 10);
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
  const contexts = [];
  try {
    await test("homepage, artwork, shared styles, and GitHub Pages configuration remain unchanged from main", async () => {
      // The migration intentionally changes Spinarium adapters, verification,
      // and migration docs. Account/storage disclosure updates are also expected;
      // homepage, artwork, shared styles, and current hosting remain byte-for-byte.
      for (const file of git("ls-tree", "-r", "--name-only", preservationRef).toString().trim().split("\n")) {
        assert(fs.existsSync(path.join(root, file)), `Original file removed: ${file}`);
        if (file.startsWith("spinarium/") || file.startsWith("docs/") || file.startsWith("scripts/verify-spinarium") || [".gitignore", "README.md", "VERIFICATION.md", "privacy.html", "terms.html"].includes(file)) continue;
        assert(fs.readFileSync(path.join(root, file)).equals(git("show", `${preservationRef}:${file}`)), `Original file changed: ${file}`);
      }
    });
    const previewContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    contexts.push(previewContext);
    const preview = await previewContext.newPage();
    preview.setDefaultTimeout(10000);
    const observedPreview = observe(preview);
    await preview.goto(base, { waitUntil: "networkidle" });
    await test("homepage View Spinarium opens the preserved explicit preview login", async () => {
      await preview.locator('a[href*="spinarium"]').first().click();
      await preview.waitForSelector("#auth-view");
      assert.equal(await preview.locator("#auth-title").innerText(), "Spinarium login");
      assert.match(await preview.locator("#auth-availability").innerText(), /admin.*1234/);
      assert(await preview.locator("#hub-view").isHidden());
      assert(await preview.locator("#signup-tab").isHidden());
      assert(await preview.locator("#forgot-password").isHidden());
      await assertBlankCards(preview, "#auth-view", 3);
      assertNoDemoRequests(observedPreview.requests);
    });
    await test("fabricated browser identity and admin flags cannot bypass preview entry", async () => {
      await preview.evaluate(() => {
        localStorage.setItem("spinarium-authenticated", "true");
        localStorage.setItem("spinarium-admin", "true");
        localStorage.setItem("spinarium-owned", JSON.stringify([{ name: "Fabricated ownership" }]));
      });
      try {
        for (const route of ["dashboard", "collection", "achievements", "discoveries", "admin", "settings"]) {
          await preview.goto(`${base}/spinarium/#${route}`, { waitUntil: "networkidle" });
          await preview.waitForFunction(() => location.hash === "#signin");
          assert.equal(new URL(preview.url()).hash, "#signin");
          assert(await preview.locator("#auth-view").isVisible());
          assert(await preview.locator("#admin-view").isHidden());
          assert.equal(await preview.locator("#collection-grid [data-card-id]").count(), 0);
        }
      } finally { await preview.evaluate(() => localStorage.clear()); }
    });
    await test("incorrect preview credentials remain gated and make no backend request", async () => {
      const count = observedPreview.requests.length;
      await previewSignIn(preview, "incorrect");
      await preview.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("Preview login failed"));
      assert(await preview.locator("#auth-view").isVisible());
      assert.equal(await preview.locator("#auth-password").inputValue(), "");
      assert(observedPreview.requests.slice(count).every((request) => request.method === "GET" && !request.hasBody));
    });
    for (const width of [320, 390, 768, 1280]) for (const scale of [100, 200]) await test(`preview entry fits ${width}px at ${scale}% text`, () => checkOverflow(preview, width, scale));
    await preview.evaluate(() => { document.documentElement.style.fontSize = ""; });
    for (const width of [390, 1280]) await test(`preview entry WCAG 2.1 AA at ${width}px`, async () => { await preview.setViewportSize({ width, height: 900 }); await checkAxe(preview); });
    await test("reduced-motion entry completes automatically and displays exactly the two collector choices", async () => {
      await previewSignIn(preview);
      await preview.waitForSelector("#first-login-intro[open]");
      assert.equal(await preview.locator("#first-login-intro").getAttribute("data-reduced"), "true");
      assert.equal(await preview.locator('#first-login-intro button').filter({ hasText: /skip/i }).count(), 0);
      await preview.waitForFunction(() => !document.querySelector("#first-login-intro").open);
      await preview.waitForSelector("#hub-view:not([hidden])");
      assert.deepEqual(await preview.locator("#hub-view h3").allTextContents(), ["My Collection", "Explore Veilings"]);
      assert(await preview.locator("#dashboard-view").isHidden());
      assert(await preview.locator("#welcome-ribbon-dock svg").isVisible());
      assert.equal(await preview.evaluate((key) => localStorage.getItem(key), introKey), "seen");
    });
    await test("preview collection stays empty, contains no character details, and never grants admin authority", async () => {
      await openCollection(preview);
      await assertEmptyCollection(preview, "—");
      assert(await preview.locator("#admin-nav").isHidden());
      assert.doesNotMatch(await preview.locator("body").innerText(), /Ashenling|Duskspore|Lumenkit|Crysthale|Embercoil|Zephyryn|Demo collector|Sample ownership/i);
      await assertNoBrowserCredentials(preview);
      assertNoDemoRequests(observedPreview.requests);
    });
    await test("empty preview search, filters, and sorting do not invent records", async () => {
      await preview.locator("#collection-search").fill("no such card");
      await assertBlankCards(preview, "#collection-grid", 10);
      await preview.locator("#collection-search").fill("");
      for (const filter of ["all", "owned", "discovered", "unowned", "undiscovered"]) {
        await preview.locator("#collection-filter").selectOption(filter);
        await preview.waitForFunction((value) => location.hash.includes(`filter=${value}`), filter);
        await assertBlankCards(preview, "#collection-grid", 10);
      }
      for (const sort of ["number", "name", "rarity", "release"]) await preview.locator("#collection-sort").selectOption(sort);
      await preview.locator("#collection-filter").selectOption("owned");
      await preview.locator("#collection-sort").selectOption("number");
    });
    await test("registration remains disabled, cannot accept a claim, and cannot change ownership", async () => {
      const count = observedPreview.requests.length;
      await preview.locator("#claim-open").click();
      assert(await preview.locator("#claim-dialog").isVisible());
      assert(await preview.locator("#claim-code").isDisabled());
      assert(await preview.locator("#claim-submit").isDisabled());
      assert.equal(await preview.locator("#claim-code").inputValue(), "");
      await checkAxe(preview);
      await preview.keyboard.press("Escape");
      assert(await preview.locator("#claim-dialog").isHidden());
      assert.equal(observedPreview.requests.length, count);
      await assertEmptyCollection(preview, "—");
    });
    for (const width of [320, 390, 768, 1280]) for (const scale of [100, 200]) await test(`empty preview collection fits ${width}px at ${scale}% text`, () => checkOverflow(preview, width, scale));
    await preview.evaluate(() => { document.documentElement.style.fontSize = ""; });
    for (const width of [390, 1280]) await test(`empty preview collection WCAG 2.1 AA at ${width}px`, async () => { await preview.setViewportSize({ width, height: 900 }); await checkAxe(preview); });
    await test("secondary navigation opens only through Menu and closes with Escape or route selection", async () => {
      for (const width of [390, 1280]) {
        await preview.evaluate(() => { location.hash = "dashboard"; });
        await preview.waitForSelector("#hub-view:not([hidden])");
        await preview.setViewportSize({ width, height: 900 });
        const toggle = preview.locator("#navigation-toggle");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        assert(await preview.locator("#sidebar-nav").evaluate((node) => node.inert));
        await toggle.click();
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        await preview.keyboard.press("Escape");
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        await toggle.click();
        await preview.locator('#sidebar-nav a[href="#achievements"]').click();
        await preview.waitForFunction(() => document.querySelector("#navigation-toggle").getAttribute("aria-expanded") === "false");
        assert(await preview.locator("#route-view").isVisible());
      }
      await preview.evaluate(() => { location.hash = "dashboard"; });
      await preview.waitForSelector("#hub-view:not([hidden])");
    });
    await test("preview sign-out clears collection and later browser-local entry bypasses the introduction", async () => {
      await preview.locator("#sign-out").click();
      await preview.waitForSelector("#auth-view:not([hidden])");
      assert.equal(await preview.locator("#collection-grid").innerText(), "");
      await previewSignIn(preview);
      await preview.waitForSelector("#hub-view:not([hidden])");
      assert(!(await preview.locator("#first-login-intro").evaluate((node) => node.open)));
      await preview.reload({ waitUntil: "networkidle" });
      assert(await preview.locator("#auth-view").isVisible());
      await assertNoBrowserCredentials(preview);
    });
    await test("normal-motion introduction unfurls, voices the welcome, docks, and completes without Skip", async () => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
      contexts.push(context);
      await context.addInitScript(() => {
        window.__spoken = [];
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { cancel() {}, speak(line) { window.__spoken.push(line.text); setTimeout(() => line.onend?.(), 20); } } });
        Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: class { constructor(text) { this.text = text; } } });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      await page.goto(`${base}/spinarium/`, { waitUntil: "networkidle" });
      await previewSignIn(page);
      await page.waitForSelector('#first-login-intro[data-phase="dark"]');
      assert.equal(await page.locator('#first-login-intro button').filter({ hasText: /skip/i }).count(), 0);
      await page.keyboard.press("Escape");
      assert(await page.locator("#first-login-intro").evaluate((node) => node.open));
      await page.waitForSelector('#first-login-intro[data-phase="unfurl"]');
      await page.waitForSelector('#first-login-intro[data-phase="lettering"]');
      assert.deepEqual(await page.evaluate(() => window.__spoken), ["Welcome to your Spinarium."]);
      await page.waitForSelector('#first-login-intro[data-phase="dock"]');
      await page.waitForSelector('#first-login-intro[data-phase="reveal"]');
      await page.waitForFunction(() => !document.querySelector("#first-login-intro").open);
      assert(await page.locator("#welcome-ribbon-dock svg").isVisible());
      assert(await page.locator("#hub-view").isVisible());
    });
    const unconfigured = await createFixture(browser, { apiBase: "" }); contexts.push(unconfigured.context);
    await test("disabled Cloudflare connection fails closed without network calls or password collection", async () => {
      assert(await unconfigured.page.locator("#auth-submit").isDisabled());
      assert(await unconfigured.page.locator("#auth-email").isDisabled());
      assert(await unconfigured.page.locator("#auth-password").isDisabled());
      assert(await unconfigured.page.locator("#auth-availability").isVisible());
      await unconfigured.page.evaluate(() => document.querySelector("#auth-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      assert.deepEqual(unconfigured.calls, []);
      await assertNoBrowserCredentials(unconfigured.page);
    });
    const configured = await createFixture(browser); contexts.push(configured.context);
    const { page, calls, observed } = configured;
    await test("configured anonymous browser only checks the Worker session before private access", async () => {
      assert(await page.locator("#auth-view").isVisible());
      assert(await page.locator("#hub-view").isHidden());
      assert.deepEqual(calls.map((call) => [call.method, call.path]), [["GET", "/api/auth/session"]]);
      assert(await page.locator("#auth-email").isVisible());
      assert(await page.locator("#auth-password").isVisible());
      assert(await page.locator("#auth-email").isEnabled());
      assert(await page.locator("#auth-password").isEnabled());
      assert.equal(await page.locator("#auth-submit").innerText(), "Sign in");
      assert(await page.locator("#signup-tab").isHidden());
      assert(await page.locator("#forgot-password").isHidden());
      await assertBlankCards(page, "#auth-view", 3);
      assert(await page.locator("#auth-recovery-note").isVisible());
      assert.match(await page.locator("#auth-recovery-note").innerText(), /Password reset is not available yet/);
      await checkAxe(page);
    });
    for (const width of [320, 390]) for (const scale of [100, 200])
      await test(`password sign-in entry fits ${width}px at ${scale}% text`, () => checkOverflow(page, width, scale));
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await test("password sign-in entry WCAG 2.1 AA on mobile", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await checkAxe(page);
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await test("direct registration creates a cookie session immediately with an empty collection and no email verification step", async () => {
      const fixture = await createFixture(browser, { signupEnabled: true }); contexts.push(fixture.context);
      assert(await fixture.page.locator("#signup-tab").isVisible());
      await fixture.page.locator("#signup-tab").click();
      await fixture.page.waitForFunction(() => location.hash === "#signup" && document.querySelector("#auth-submit").textContent === "Create account");
      for (const id of ["auth-display-name", "auth-email", "auth-password", "auth-confirm-password"])
        assert(await fixture.page.locator(`#${id}`).isVisible());
      assert(await fixture.page.locator("#auth-password-hint").isVisible());
      assert.match(await fixture.page.locator("#auth-password-hint").innerText(), /15 to 128/);
      await checkOverflow(fixture.page, 390, 200);
      await fixture.page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      await checkAxe(fixture.page);
      await fixture.page.setViewportSize({ width: 1280, height: 900 });
      await passwordSignup(fixture.page);
      await fixture.page.waitForSelector("#hub-view:not([hidden])");
      await fixture.page.waitForFunction(() => !document.querySelector("#first-login-intro").open);
      assert(fixture.calls.some((call) => call.path === "/api/auth/signup" && call.method === "POST"));
      assert.equal(await fixture.page.locator("#auth-password").inputValue(), "");
      assert.equal(await fixture.page.locator("#auth-confirm-password").inputValue(), "");
      assert.equal(await fixture.page.locator("#profile-name").innerText(), fixtureUser.displayName);
      assert.doesNotMatch(await fixture.page.locator("body").innerText(), /verify your email|confirmation link/i);
      await openCollection(fixture.page);
      await assertEmptyCollection(fixture.page, "2026");
      await assertNoBrowserCredentials(fixture.page);
    });
    await test("incorrect password stays gated, clears submitted credentials, and hides backend detail", async () => {
      const fixture = await createFixture(browser, { scenario: "invalid-login" }); contexts.push(fixture.context);
      await passwordSignIn(fixture.page);
      await fixture.page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("Sign-in failed"));
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert.equal(await fixture.page.locator("#auth-password").inputValue(), "");
      assert.doesNotMatch(await fixture.page.locator("#auth-feedback").innerText(), /Private backend|Test-only-passphrase/);
      assert(!fixture.calls.some((call) => call.path === "/api/dashboard"));
      await assertNoBrowserCredentials(fixture.page);
    });
    await test("signup validation and duplicate rejection clear passwords without granting access", async () => {
      const fixture = await createFixture(browser, { signupEnabled: true, scenario: "duplicate-signup" }); contexts.push(fixture.context);
      await fixture.page.locator("#signup-tab").click();
      await fixture.page.waitForFunction(() => location.hash === "#signup" && document.querySelector("#auth-submit").textContent === "Create account");
      await fixture.page.locator("#auth-display-name").fill(fixtureUser.displayName);
      await fixture.page.locator("#auth-email").fill(fixtureUser.email);
      await fixture.page.locator("#auth-password").fill(fixturePassword);
      await fixture.page.locator("#auth-confirm-password").fill("Mismatched-test-password42!");
      await fixture.page.locator("#auth-submit").click();
      await fixture.page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("passwords do not match"));
      assert(!fixture.calls.some((call) => call.path === "/api/auth/signup"));
      for (const value of ["short-password", "x".repeat(129)]) {
        await fixture.page.locator("#auth-password").fill(value);
        await fixture.page.locator("#auth-confirm-password").fill(value);
        // Bypass native validity to also verify the adapter's character bounds.
        await fixture.page.evaluate(() => document.querySelector("#auth-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        await fixture.page.waitForFunction(() => document.querySelector("#auth-password").value === "");
        assert.match(await fixture.page.locator("#auth-feedback").innerText(), /15 to 128/);
        assert(!fixture.calls.some((call) => call.path === "/api/auth/signup"));
      }
      await passwordSignup(fixture.page);
      await fixture.page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("account could not be created"));
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert.equal(await fixture.page.locator("#auth-password").inputValue(), "");
      assert.equal(await fixture.page.locator("#auth-confirm-password").inputValue(), "");
      assert.doesNotMatch(await fixture.page.locator("#auth-feedback").innerText(), /Private backend|Test-only-passphrase/);
      assert(!fixture.calls.some((call) => call.path === "/api/dashboard"));
      await assertNoBrowserCredentials(fixture.page);
    });
    await test("sign-in follows the Worker boundary and hydrates an empty cookie session without browser tokens", async () => {
      await passwordSignIn(page);
      await page.waitForSelector("#hub-view:not([hidden])");
      assert(calls.some((call) => call.path === "/api/auth/login" && call.method === "POST"));
      assert.equal(await page.locator("#auth-password").inputValue(), "");
      assert(calls.some((call) => call.path === "/api/dashboard" && call.method === "GET"));
      assert(calls.some((call) => call.path === "/api/admin/access" && call.method === "GET"));
      assert(calls.filter((call) => ["/api/dashboard", "/api/admin/access"].includes(call.path)).every((call) => !call.authorization && call.cookie.includes(fixtureCookie)));
      assert.equal(await page.locator("#profile-name").innerText(), fixtureUser.displayName);
      await openCollection(page);
      await assertEmptyCollection(page, "2026");
      await assertNoBrowserCredentials(page);
      assertNoDemoRequests(observed.requests);
      assertNoSecretsInURLs(observed.requests);
    });
    await test("reload restores the same cookie identity without resubmitting a password", async () => {
      const loginCount = calls.filter((call) => call.path === "/api/auth/login").length;
      const restoredSession = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session");
      await page.reload({ waitUntil: "commit" });
      await restoredSession;
      await page.waitForSelector("#dashboard-view:not([hidden])");
      assert.equal(calls.filter((call) => call.path === "/api/auth/login").length, loginCount);
      assert.equal(await page.locator("#profile-name").innerText(), fixtureUser.displayName);
      assert.equal(await page.locator("#auth-password").inputValue(), "");
      await assertEmptyCollection(page, "2026");
      await assertNoBrowserCredentials(page);
    });
    await test("real account first entry keeps reduced-motion onboarding, and later entries remember only the browser preference", async () => {
      const fixture = await createFixture(browser); contexts.push(fixture.context);
      await passwordSignIn(fixture.page);
      await fixture.page.waitForSelector("#first-login-intro[open]");
      assert.equal(await fixture.page.locator("#first-login-intro").getAttribute("data-reduced"), "true");
      assert.equal(await fixture.page.locator('#first-login-intro button').filter({ hasText: /skip/i }).count(), 0);
      await fixture.page.waitForFunction(() => !document.querySelector("#first-login-intro").open);
      assert(await fixture.page.locator("#hub-view").isVisible());
      assert(await fixture.page.locator("#welcome-ribbon-dock svg").isVisible());
      assert.equal(await fixture.page.evaluate((key) => localStorage.getItem(key), introKey), "seen");
      await assertNoBrowserCredentials(fixture.page);
      await fixture.page.locator("#sign-out").click();
      await fixture.page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("signed out"));
      const anonymousSession = fixture.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session");
      await fixture.page.reload({ waitUntil: "commit" });
      await anonymousSession;
      await fixture.page.waitForLoadState("load");
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert.equal(await fixture.page.evaluate((key) => localStorage.getItem(key), introKey), "seen");
      await passwordSignIn(fixture.page);
      await fixture.page.waitForSelector("#hub-view:not([hidden])");
      assert(!(await fixture.page.locator("#first-login-intro").evaluate((node) => node.open)));
      await openCollection(fixture.page);
      await assertEmptyCollection(fixture.page, "2026");
      await assertNoBrowserCredentials(fixture.page);
    });
    await test("real account normal-motion entry preserves the voiced cinematic and automatically docks the ribbon", async () => {
      const fixture = await createFixture(browser, { reducedMotion: "no-preference", mockSpeech: true }); contexts.push(fixture.context);
      fixture.page.setDefaultTimeout(12000);
      await passwordSignIn(fixture.page);
      await fixture.page.waitForSelector('#first-login-intro[data-phase="dark"][open]');
      assert.equal(await fixture.page.locator("#first-login-intro").getAttribute("data-reduced"), "false");
      assert.equal(await fixture.page.locator('#first-login-intro button').filter({ hasText: /skip/i }).count(), 0);
      await fixture.page.keyboard.press("Escape");
      assert(await fixture.page.locator("#first-login-intro").evaluate((node) => node.open));
      await fixture.page.waitForSelector('#first-login-intro[data-phase="unfurl"]');
      await fixture.page.waitForSelector('#first-login-intro[data-phase="lettering"]');
      assert.deepEqual(await fixture.page.evaluate(() => window.__spoken), ["Welcome to your Spinarium."]);
      await fixture.page.waitForSelector('#first-login-intro[data-phase="dock"]');
      await fixture.page.waitForSelector('#first-login-intro[data-phase="reveal"]');
      await fixture.page.waitForFunction(() => !document.querySelector("#first-login-intro").open);
      assert(await fixture.page.locator("#welcome-ribbon-dock svg").isVisible());
      assert(await fixture.page.locator("#hub-view").isVisible());
      await assertNoBrowserCredentials(fixture.page);
      assertNoDemoRequests(fixture.observed.requests);
    });
    await test("server admin denial overrides editable claims and fabricated local privileges", async () => {
      assert(await page.locator("#admin-nav").isHidden());
      await page.evaluate(() => { localStorage.setItem("spinarium-admin", "true"); location.hash = "admin"; });
      await page.waitForSelector("#route-title");
      assert.match(await page.locator("#route-title").innerText(), /admin access required/i);
      assert(await page.locator("#admin-view").isHidden());
      await page.evaluate(() => document.querySelector("#admin-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      assert(!calls.some((call) => call.path === "/api/admin/veilings"));
      await page.evaluate(() => { localStorage.clear(); location.hash = "collection?filter=owned"; });
      await page.waitForSelector("#dashboard-view:not([hidden])");
    });
    for (const width of [390, 1280]) await test(`cookie-backed empty collection WCAG 2.1 AA at ${width}px`, async () => { await page.setViewportSize({ width, height: 900 }); await checkAxe(page); });
    await test("logout sends CSRF, clears private views, and reload remains anonymous", async () => {
      await page.locator("#sign-out").click();
      await page.waitForSelector("#auth-view:not([hidden])");
      assert.equal(await page.locator("#stats").innerText(), "");
      assert.equal(await page.locator("#collection-grid").innerText(), "");
      await page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("signed out"));
      const logout = calls.find((call) => call.path === "/api/auth/logout");
      assert.equal(logout.method, "POST"); assert.equal(logout.csrf, fixtureCsrf);
      const anonymousSession = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/session");
      await page.reload({ waitUntil: "commit" });
      await anonymousSession;
      await page.waitForFunction(() => !document.body.classList.contains("static-preview"));
      assert(await page.locator("#auth-view").isVisible());
      assert(await page.locator("#hub-view").isHidden());
      await assertNoBrowserCredentials(page);
    });
    await test("mobile Menu exposes keyboard sign-out, revokes the cookie, and clears private content", async () => {
      const fixture = await createFixture(browser, { signedIn: true }); contexts.push(fixture.context);
      await fixture.page.setViewportSize({ width: 390, height: 844 });
      assert(await fixture.page.locator("#menu-sign-out").isHidden());
      await fixture.page.locator("#navigation-toggle").click();
      assert(await fixture.page.locator("#menu-sign-out").isVisible());
      await fixture.page.locator("#menu-sign-out").focus();
      assert(await fixture.page.locator("#menu-sign-out").evaluate((node) => node === document.activeElement));
      await fixture.page.keyboard.press("Enter");
      await fixture.page.waitForFunction(() => document.querySelector("#auth-feedback").textContent.includes("signed out"));
      const logout = fixture.calls.find((call) => call.path === "/api/auth/logout");
      assert.equal(logout?.method, "POST");
      assert.equal(logout?.csrf, fixtureCsrf);
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert.equal(await fixture.page.locator("#collection-grid").innerText(), "");
      assert.equal(await fixture.page.locator("#navigation-toggle").getAttribute("aria-expanded"), "false");
      assert.equal((await fixture.context.cookies()).filter((cookie) => cookie.name === "spinarium_session").length, 0);
      await assertNoBrowserCredentials(fixture.page);
    });
    for (const scenario of ["unavailable", "malformed"]) await test(`${scenario} session fails closed and does not expose provider details or sample content`, async () => {
      const fixture = await createFixture(browser, { scenario }); contexts.push(fixture.context);
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert(!fixture.calls.some((call) => call.path === "/api/dashboard"));
      assert.doesNotMatch(await fixture.page.locator("#auth-feedback").innerText(), /Private provider|invalid-id/);
      assert.match(await fixture.page.locator("#auth-feedback").innerText(), /(?:not available|could not complete)/i);
      await assertNoBrowserCredentials(fixture.page);
    });
    await test("private API session rejection clears protected views instead of substituting sample data", async () => {
      const fixture = await createFixture(browser, { signedIn: true }); contexts.push(fixture.context);
      await fixture.page.waitForSelector("#hub-view:not([hidden])");
      fixture.state.expireDashboard = true;
      const rejectedDashboard = fixture.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dashboard" && response.status() === 401);
      await fixture.page.reload({ waitUntil: "commit" });
      await rejectedDashboard;
      await fixture.page.waitForSelector("#auth-view:not([hidden])");
      assert(await fixture.page.locator("#auth-view").isVisible());
      assert(await fixture.page.locator("#hub-view").isHidden());
      assert.equal(await fixture.page.locator("#collection-grid [data-card-id]").count(), 0);
    });
    await test("test-only owned card details remain hidden until selection; mobile opens the full detail dialog", async () => {
      const fixture = await createFixture(browser, { signedIn: true, scenario: "owned" }); contexts.push(fixture.context);
      await fixture.page.waitForSelector("#hub-view:not([hidden])");
      await openCollection(fixture.page);
      assert(await fixture.page.locator("#detail-panel").isHidden());
      assert.equal(await fixture.page.locator("#collection-grid [data-card-id]").count(), 1);
      await fixture.page.locator("#collection-grid [data-card-id]").click();
      assert(await fixture.page.locator("#detail-panel").isVisible());
      assert.equal(await fixture.page.locator("#selected-name").textContent(), "Browser Fixture Veiling");
      await fixture.page.locator('#detail-panel [data-action="details"]').first().click();
      assert(await fixture.page.locator("#veiling-dialog").isVisible());
      await checkAxe(fixture.page);
      await fixture.page.keyboard.press("Escape");
      await fixture.page.setViewportSize({ width: 390, height: 844 });
      await fixture.page.locator("#collection-grid [data-card-id]").click();
      assert(await fixture.page.locator("#veiling-dialog").isVisible());
      await fixture.page.keyboard.press("Escape");
      assert(await fixture.page.locator("#collection-grid [data-card-id]").evaluate((node) => document.activeElement === node));
      assertNoDemoRequests(fixture.observed.requests);
    });
    await test("server-authorized catalog creation sends CSRF and never grants collector ownership", async () => {
      const fixture = await createFixture(browser, { signedIn: true, scenario: "admin" }); contexts.push(fixture.context);
      await fixture.page.waitForSelector("#hub-view:not([hidden])");
      assert(!(await fixture.page.locator("#admin-nav").evaluate((node) => node.hidden)));
      await fixture.page.evaluate(() => { location.hash = "admin"; });
      await fixture.page.waitForSelector("#admin-view:not([hidden])");
      await fixture.page.locator("#admin-name").fill("Test-only catalog entry");
      await fixture.page.locator("#admin-description").fill("Test-only catalog description");
      await fixture.page.locator("#admin-save").click();
      await fixture.page.waitForFunction(() => document.querySelector("#admin-feedback").textContent.includes("No collector ownership has been changed"));
      assert(fixture.calls.some((call) => call.path === "/api/admin/veilings" && call.method === "POST" && call.csrf === fixtureCsrf));
      assert.equal(await fixture.page.locator("#admin-list .admin-catalog-item").count(), 1);
      await fixture.page.locator("#admin-list .admin-catalog-item").click();
      await fixture.page.locator("#admin-name").fill("Unsaved administrator edit");
      fixture.state.nextConflict = true;
      await fixture.page.locator("#admin-save").click();
      await fixture.page.waitForFunction(() => document.querySelector("#admin-feedback").textContent.includes("Select its current catalog entry"));
      await fixture.page.waitForFunction(() => !document.querySelector("#admin-save").disabled);
      assert.equal(await fixture.page.locator("#admin-name").inputValue(), "Unsaved administrator edit");
      assert.equal(await fixture.page.locator("#admin-list strong").innerText(), "Concurrent server change");
      await fixture.page.locator("#admin-list .admin-catalog-item").click();
      assert.equal(await fixture.page.locator("#admin-name").inputValue(), "Concurrent server change");
      await fixture.page.locator("#admin-name").fill("Administrator retry");
      fixture.state.holdSave = true;
      await fixture.page.locator("#admin-save").click();
      await fixture.page.waitForFunction(() => document.querySelector("#admin-new").disabled);
      assert(await fixture.page.locator("#admin-name").isDisabled());
      assert(await fixture.page.locator("#admin-list .admin-catalog-item").isDisabled());
      await fixture.page.evaluate(() => {
        document.querySelector("#admin-new").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.querySelector("#admin-list .admin-catalog-item").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      assert.equal(await fixture.page.locator("#admin-name").inputValue(), "Administrator retry");
      assert.equal(await fixture.page.locator("#admin-id").inputValue(), "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
      assert.equal(typeof fixture.state.releaseSave, "function");
      fixture.state.releaseSave();
      await fixture.page.waitForFunction(() => !document.querySelector("#admin-save").disabled);
      assert.equal(await fixture.page.locator("#admin-list strong").innerText(), "Administrator retry");

      await fixture.page.evaluate(() => { location.hash = "collection?filter=owned"; });
      await fixture.page.waitForSelector("#dashboard-view:not([hidden])");
      await assertEmptyCollection(fixture.page, "2026");
    });
    await test("runtime has no demo imports, browser bearer tokens, script errors, or failed assets", async () => {
      for (const observed of [observedPreview, configured.observed, unconfigured.observed]) {
        assert.deepEqual(observed.errors, []);
        assert.deepEqual(observed.failedResponses.filter((response) => !/^401 \/api\/auth\/session$/.test(response)), []);
        assertNoDemoRequests(observed.requests);
        assertNoSecretsInURLs(observed.requests);
        assert(observed.requests.every((request) => !request.authorization));
      }
      assert(observedPreview.requests.every((request) => request.method === "GET" && !request.hasBody));
    });
    if (process.env.SCREENSHOT_DIR) {
      await preview.goto(`${base}/spinarium/#signin`, { waitUntil: "networkidle" });
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      for (const [name, width, height] of [["spinarium-signin-desktop", 1280, 900], ["spinarium-signin-mobile", 390, 844]]) {
        await preview.setViewportSize({ width, height });
        await preview.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
        await preview.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`), fullPage: true });
      }
    }
    await test("JavaScript-disabled entry stays gated and offers a working homepage link", async () => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } }); contexts.push(context);
      const page = await context.newPage(); await page.goto(`${base}/spinarium/`);
      assert(await page.locator("#dashboard-view").isHidden());
      assert(await page.locator("#auth-email").isDisabled());
      assert.match(await page.locator("noscript").innerText(), /JavaScript/i);
      await page.locator('a[href="../"]').first().click(); assert.match(await page.title(), /SpinDownGames/);
    });
  } finally { await Promise.all(contexts.map((context) => context.close())); await browser.close(); }
  if (issues.length) { console.error(`\n${issues.length} failed checks.`); process.exitCode = 1; }
  else console.log(`\nAll ${passed} local preview and test-only Worker browser checks passed. Hosted authentication was not tested.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
