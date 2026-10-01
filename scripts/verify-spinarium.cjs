// Browser verification uses test-only provider interception, never live credentials.
// NODE_PATH=/tmp/spindown-qa/node_modules BROWSER_PATH=/usr/bin/chromium node scripts/verify-spinarium.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = (process.env.BASE_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const root = path.resolve(__dirname, "..");
const preservationRef =
  process.env.PRESERVATION_REF || "89f701e7d1f999d1283cdae1944a69accfd5acda";
const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const issues = [];
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    issues.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
};
const fixtureOrigin = "https://spinarium-browser-fixture.supabase.co";
const fixtureKey = "sb_publishable_test_only_browser_fixture_1234567890";
const fixtureToken = "test-only-browser-access-token";
const fixturePassword = "test-only-password-12345";
const fixtureUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "collector@example.test",
  created_at: "2026-10-01T12:00:00Z",
  email_confirmed_at: "2026-10-01T12:01:00Z",
  // Provider verification strips editable privilege claims. The admin RPC alone
  // determines the separate backend permission in these tests.
  user_metadata: { role: "superadmin", is_admin: true },
  app_metadata: { role: "superadmin" },
};
const emptySnapshot = () => ({
  schemaVersion: "1",
  mode: "live",
  profile: {
    id: fixtureUser.id,
    displayName: "QA Collector",
    memberSince: fixtureUser.created_at,
    avatarSrc: null,
  },
  veilings: [],
  series: [],
  editions: [],
  variants: [],
  rarities: [],
  physicalCards: [],
  ownerships: [],
  discoveries: [],
  achievements: [],
  userAchievements: [],
  collections: [],
  news: [],
  events: [],
});
function observe(page) {
  const errors = [],
    failedResponses = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      hasBody: request.postData() !== null,
    }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push(
        `${response.status()} ${new URL(response.url()).pathname}`,
      );
  });
  return { errors, failedResponses, requests };
}
async function assertBlankCards(page, scope, expectedCount) {
  const cards = page.locator(`${scope} .blank-card`);
  assert.equal(await cards.count(), expectedCount);
  const invalid = await cards.evaluateAll((nodes) =>
    nodes
      .map((node, index) => {
        const style = getComputedStyle(node);
        const before = getComputedStyle(node, "::before");
        const after = getComputedStyle(node, "::after");
        return {
          index,
          black: style.backgroundColor === "rgb(0, 0, 0)",
          noImage:
            style.backgroundImage === "none" && style.maskImage === "none",
          noPseudo: [before.content, after.content].every(
            (content) => content === "none" || content === "normal",
          ),
          noArtwork:
            node.querySelectorAll("img, svg, picture, canvas, video").length ===
            0,
          noText: node.textContent.trim() === "",
          noRecord:
            !node.hasAttribute("data-card-id") &&
            !node.hasAttribute("data-card-number"),
        };
      })
      .filter(
        (card) =>
          !card.black ||
          !card.noImage ||
          !card.noPseudo ||
          !card.noArtwork ||
          !card.noText ||
          !card.noRecord,
      ),
  );
  assert.deepEqual(
    invalid,
    [],
    "Generic placeholders must be plain black and contain no character data",
  );
}
function assertNoDemoRequests(requests) {
  const disallowed = requests.filter(({ url }) =>
    /demo-service|\/assets\/spinarium\/(?:ashenling|duskspore|lumenkit|crysthale|embercoil|zephyryn|silhouette)\b/i.test(
      new URL(url).pathname,
    ),
  );
  assert.deepEqual(
    disallowed,
    [],
    "The public application requested demo data or concept characters",
  );
}
function assertNoSecretsInURLs(requests) {
  const invalid = requests.filter(({ url }) => {
    const parsed = new URL(url);
    return (
      [...parsed.searchParams.keys()].some((key) =>
        /^(?:password|access_token|refresh_token|claim_code|claim_token)$/i.test(
          key,
        ),
      ) ||
      url.includes(fixtureToken) ||
      url.includes(fixturePassword)
    );
  });
  assert.deepEqual(
    invalid,
    [],
    "A password or bearer token was placed in a request URL",
  );
}
async function storage(page) {
  return page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookie: document.cookie,
  }));
}
async function checkAxe(page) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(() =>
    axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }),
  );
  assert.deepEqual(
    result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
    [],
  );
}
async function checkOverflow(page, width, scale) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = `${value}%`;
  }, scale);
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert(size.document <= size.viewport + 1, JSON.stringify(size));
}
async function createFixture(browser, scenario = "empty") {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const calls = [];
  await context.route("**/spinarium/config.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: `export const spinariumConfig = Object.freeze(${JSON.stringify({ supabaseUrl: fixtureOrigin, supabasePublishableKey: fixtureKey })});`,
    }),
  );
  await context.route(`${fixtureOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      "access-control-allow-origin": new URL(base).origin,
      "access-control-allow-methods": "GET, POST, PATCH, PUT, OPTIONS",
      "access-control-allow-headers":
        "apikey, authorization, content-type, prefer",
    };
    const respond = (value, status = 200) =>
      route.fulfill({
        status,
        headers,
        contentType: "application/json",
        body: status === 204 ? "" : JSON.stringify(value),
      });
    if (method === "OPTIONS") return respond(null, 204);
    calls.push({
      path: url.pathname,
      method,
      hasAuthorization:
        request.headers().authorization === `Bearer ${fixtureToken}`,
    });
    if (url.pathname === "/auth/v1/token" && method === "POST") {
      const body = request.postDataJSON();
      assert.equal(body.email, fixtureUser.email);
      assert.equal(body.password, fixturePassword);
      if (scenario === "invalid-login")
        return respond(
          { msg: `Provider detail must not be displayed: ${fixturePassword}` },
          400,
        );
      return respond({
        access_token: fixtureToken,
        refresh_token: "test-only-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { ...fixtureUser, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      });
    }
    if (url.pathname === "/auth/v1/user" && method === "GET") {
      assert.equal(request.headers().authorization, `Bearer ${fixtureToken}`);
      return scenario === "unverified-user"
        ? respond({ error: "User not verified" }, 401)
        : respond(fixtureUser);
    }
    if (url.pathname === "/auth/v1/signup" && method === "POST")
      return respond({ ...fixtureUser, email_confirmed_at: null });
    if (url.pathname === "/auth/v1/logout" && method === "POST")
      return respond(null, 204);
    if (
      url.pathname === "/rest/v1/rpc/spinarium_dashboard" &&
      method === "POST"
    )
      return respond(emptySnapshot());
    if (url.pathname === "/rest/v1/rpc/is_spinarium_admin" && method === "POST")
      return respond(false);
    return respond({ error: "Unexpected test-only provider endpoint" }, 400);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const observed = observe(page);
  await page.goto(`${base}/spinarium/#signin`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => !document.querySelector("#auth-fields").disabled,
  );
  return { context, page, calls, observed };
}
async function signIn(page) {
  await page.locator("#auth-email").fill(fixtureUser.email);
  await page.locator("#auth-password").fill(fixturePassword);
  await page.locator("#auth-password").press("Enter");
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const contexts = [];
  try {
    await test("original website, branding, assets, legal pages, and hosting configuration are preserved", async () => {
      const exemptDocs = new Set([
        "README.md",
        "ARTWORK.md",
        "VERIFICATION.md",
      ]);
      for (const file of git("ls-tree", "-r", "--name-only", preservationRef)
        .toString()
        .trim()
        .split("\n")) {
        assert(
          fs.existsSync(path.join(root, file)),
          `Original file removed: ${file}`,
        );
        if (file === "index.html" || exemptDocs.has(file)) continue;
        const original = git("show", `${preservationRef}:${file}`);
        const current = fs.readFileSync(path.join(root, file));
        if (file === "scripts/verify.cjs") {
          const allowance =
            '            if (a.getAttribute("href") === "spinarium/")\n              return a.origin !== location.origin || a.target !== "";\n';
          assert.equal(
            current.toString().replace(allowance, ""),
            original.toString(),
          );
        } else
          assert(current.equals(original), `Original file changed: ${file}`);
      }
    });
    const guestContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    contexts.push(guestContext);
    const guest = await guestContext.newPage();
    guest.setDefaultTimeout(10_000);
    const observedGuest = observe(guest);
    await guest.goto(base, { waitUntil: "networkidle" });
    await test("existing homepage content and links are intact; View Spinarium opens account access", async () => {
      const original = git("show", `${preservationRef}:index.html`).toString();
      const current = fs.readFileSync(path.join(root, "index.html"), "utf8");
      const result = await guest.evaluate(
        ({ original, current }) => {
          const parse = (html) =>
            new DOMParser().parseFromString(html, "text/html");
          const before = parse(original),
            after = parse(current);
          const additions = [...after.querySelectorAll('a[href*="spinarium"]')];
          additions.forEach((link) => link.remove());
          const text = (doc) =>
            doc.body.textContent.replace(/\s+/g, " ").trim();
          const links = (doc) =>
            [...doc.querySelectorAll("a")].map((a) => [
              a.getAttribute("href"),
              a.getAttribute("target"),
              a.getAttribute("rel"),
              a.textContent.trim(),
            ]);
          return {
            before: text(before),
            after: text(after),
            beforeLinks: links(before),
            afterLinks: links(after),
            entries: additions.length,
          };
        },
        { original, current },
      );
      assert(result.entries > 0);
      assert.equal(result.after, result.before);
      assert.deepEqual(result.afterLinks, result.beforeLinks);
      await guest.locator('a[href*="spinarium"]').first().click();
      await guest.waitForSelector("#auth-view");
      assert(await guest.locator("#auth-form").isVisible());
      assert(await guest.locator("#dashboard-view").isHidden());
      assert.match(await guest.title(), /Sign in.*Spinarium/i);
    });
    await test("signed-out entry contains no demo characters or collection and only plain black decorative cards", async () => {
      assert(await guest.locator("#account-tools").isHidden());
      assert(await guest.locator("#sidebar-nav").isHidden());
      assert(await guest.locator("#claim-open").isHidden());
      assert.equal(
        await guest.locator("#collection-grid [data-card-id]").count(),
        0,
      );
      await assertBlankCards(guest, "#auth-view", 3);
      assert.doesNotMatch(
        await guest.locator("body").innerText(),
        /Ashenling|Duskspore|Lumenkit|Crysthale|Embercoil|Zephyryn|Demo collector|Sample ownership/i,
      );
      assertNoDemoRequests(observedGuest.requests);
    });
    await test("unconfigured sign-in and signup remain disabled and cannot submit a password", async () => {
      const before = await storage(guest);
      const requestCount = observedGuest.requests.length;
      assert(await guest.locator("#auth-email").isDisabled());
      assert(await guest.locator("#auth-password").isDisabled());
      assert(await guest.locator("#auth-submit").isDisabled());
      assert(await guest.locator("#auth-availability").isVisible());
      await guest.locator("#signup-tab").click();
      await guest.waitForFunction(
        () =>
          location.hash === "#signup" &&
          !document.querySelector("#auth-confirm-group").hidden,
      );
      assert(await guest.locator("#auth-confirm-password").isDisabled());
      await guest.evaluate(() => {
        document
          .querySelector("#auth-form")
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      assert(
        observedGuest.requests
          .slice(requestCount)
          .every((request) => request.method === "GET" && !request.hasBody),
      );
      assert.deepEqual(await storage(guest), before);
      await guest.locator("#signin-tab").click();
    });
    await test("protected collection and admin links plus fabricated browser flags do not bypass account access", async () => {
      await guest.evaluate(() => {
        localStorage.setItem("spinarium-authenticated", "true");
        localStorage.setItem("spinarium-admin", "true");
        localStorage.setItem(
          "spinarium-owned",
          JSON.stringify([{ name: "Fabricated ownership" }]),
        );
      });
      try {
        for (const route of [
          "dashboard",
          "collection",
          "achievements",
          "discoveries",
          "admin",
          "transfers",
          "settings",
          "update-password",
        ]) {
          await guest.goto(`${base}/spinarium/#${route}`, {
            waitUntil: "networkidle",
          });
          await guest.waitForFunction(
            () => !document.querySelector("#auth-view").hidden,
          );
          assert.equal(
            await guest.locator("#auth-title").innerText(),
            "Enter your Spinarium",
          );
          assert(await guest.locator("#auth-confirm-group").isHidden());
          if (route !== "update-password")
            assert.equal(new URL(guest.url()).hash, "#signin");
          assert(await guest.locator("#dashboard-view").isHidden());
          assert(await guest.locator("#admin-view").isHidden());
          assert.equal(
            await guest.locator("#collection-grid [data-card-id]").count(),
            0,
          );
        }
      } finally {
        await guest.evaluate(() => localStorage.clear());
      }
    });
    await test("unconfigured auth callbacks scrub credentials from the address before failing closed", async () => {
      await guest.goto(
        `${base}/spinarium/#access_token=${fixtureToken}&refresh_token=test-only-refresh-token&token_type=bearer&expires_in=3600`,
        { waitUntil: "networkidle" },
      );
      await guest.waitForFunction(
        () => !location.hash.includes("access_token"),
      );
      assert(!guest.url().includes(fixtureToken));
      assert(await guest.locator("#auth-view").isVisible());
      assert(await guest.locator("#dashboard-view").isHidden());
      assert.deepEqual(await storage(guest), {
        local: {},
        session: {},
        cookie: "",
      });
    });
    for (const width of [320, 390, 768, 1280]) {
      for (const scale of [100, 200])
        await test(`account entry fits ${width}px at ${scale}% text`, () =>
          checkOverflow(guest, width, scale));
    }
    await guest.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    for (const width of [390, 1280])
      await test(`account entry WCAG 2.1 AA at ${width}px`, async () => {
        await guest.setViewportSize({ width, height: 900 });
        await checkAxe(guest);
      });
    const configured = await createFixture(browser);
    contexts.push(configured.context);
    const { page, calls, observed } = configured;
    await test("configured public entry still requires authentication before any private API request", async () => {
      assert(await page.locator("#auth-view").isVisible());
      assert(await page.locator("#dashboard-view").isHidden());
      assert.equal(calls.length, 0);
      await assertBlankCards(page, "#auth-view", 3);
    });
    await test("provider-verified sign-in opens a genuinely empty account without fabricated ownership", async () => {
      await signIn(page);
      await page.waitForSelector("#dashboard-view:not([hidden])");
      assert(await page.locator("#auth-view").isHidden());
      assert.equal(
        await page.locator("#profile-name").innerText(),
        fixtureUser.email,
      );
      assert.deepEqual(
        await page.locator("#stats .stat-card strong").allTextContents(),
        ["0", "0", "0", "0", "2026"],
      );
      assert.equal(
        await page.locator("#collection-grid [data-card-id]").count(),
        0,
      );
      assert.match(
        await page.locator("#collection-status").innerText(),
        /collection is empty/i,
      );
      await assertBlankCards(page, "#collection-grid", 10);
      assert(
        calls.some(
          (call) => call.path === "/auth/v1/user" && call.hasAuthorization,
        ),
      );
      assert(
        calls.some(
          (call) =>
            call.path === "/rest/v1/rpc/spinarium_dashboard" &&
            call.hasAuthorization,
        ),
      );
      assert.deepEqual(await storage(page), {
        local: {},
        session: {},
        cookie: "",
      });
      assertNoDemoRequests(observed.requests);
      assertNoSecretsInURLs(observed.requests);
    });
    await test("empty collection search, filters, and all sorts preserve black slots without invented records", async () => {
      await page.locator("#collection-search").fill("no such card");
      await assertBlankCards(page, "#collection-grid", 10);
      await page.locator("#collection-search").fill("");
      for (const value of ["all", "owned", "discovered", "unowned"]) {
        await page
          .locator(`#collection-filter [data-filter="${value}"]`)
          .click();
        assert.equal(
          await page
            .locator(`#collection-filter [data-filter="${value}"]`)
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(
          await page.locator("#collection-grid [data-card-id]").count(),
          0,
        );
      }
      for (const value of ["number", "name", "rarity", "release"])
        await page.locator("#collection-sort").selectOption(value);
      await assertBlankCards(page, "#collection-grid", 10);
      await page.locator('#collection-filter [data-filter="owned"]').click();
      await page.locator("#collection-sort").selectOption("number");
    });
    await test("server-admin denial overrides provider metadata and prevents catalog access or writes", async () => {
      assert(await page.locator("#admin-nav").isHidden());
      await page.goto(`${base}/spinarium/#admin`, { waitUntil: "networkidle" });
      await page.waitForSelector("#route-title");
      assert.match(
        await page.locator("#route-title").innerText(),
        /admin access required/i,
      );
      assert(await page.locator("#admin-view").isHidden());
      await page.evaluate(() =>
        document
          .querySelector("#admin-form")
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      assert(
        !calls.some((call) => call.path === "/rest/v1/spinarium_veilings"),
      );
      await page.goto(`${base}/spinarium/#dashboard`, {
        waitUntil: "networkidle",
      });
    });
    await test("claim flow remains disabled, does not accept secrets, and cannot grant ownership", async () => {
      const before = await storage(page);
      const count = calls.length;
      await page.locator("#claim-open").click();
      assert(await page.locator("#claim-dialog").isVisible());
      assert(await page.locator("#claim-code").isDisabled());
      assert(await page.locator("#claim-submit").isDisabled());
      assert.equal(await page.locator("#claim-code").inputValue(), "");
      await checkAxe(page);
      await page.keyboard.press("Escape");
      assert(await page.locator("#claim-dialog").isHidden());
      assert.equal(calls.length, count);
      assert.deepEqual(await storage(page), before);
      assert.equal(
        await page.locator("#collection-grid [data-card-id]").count(),
        0,
      );
    });
    for (const width of [320, 390, 768, 1280]) {
      for (const scale of [100, 200])
        await test(`empty account fits ${width}px at ${scale}% text`, () =>
          checkOverflow(page, width, scale));
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await test("authenticated mobile navigation closes with Escape and after selecting a route", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.locator("#navigation-toggle");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
      await page.locator('#sidebar-nav a[href="#achievements"]').click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#navigation-toggle")
            .getAttribute("aria-expanded") === "false",
      );
      await page.goto(`${base}/spinarium/#dashboard`, {
        waitUntil: "networkidle",
      });
    });
    for (const width of [390, 1280])
      await test(`empty account WCAG 2.1 AA at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await checkAxe(page);
      });
    await test("sign-out clears private content and tokens; reload requires sign-in", async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator("#sign-out").click();
      await page.waitForSelector("#auth-view:not([hidden])");
      assert(await page.locator("#dashboard-view").isHidden());
      assert.equal(await page.locator("#stats").innerText(), "");
      assert.equal(await page.locator("#collection-grid").innerText(), "");
      assert.deepEqual(await storage(page), {
        local: {},
        session: {},
        cookie: "",
      });
      await page.reload({ waitUntil: "networkidle" });
      assert(await page.locator("#auth-view").isVisible());
      assert(await page.locator("#dashboard-view").isHidden());
      assertNoSecretsInURLs(observed.requests);
    });
    for (const scenario of ["invalid-login", "unverified-user"])
      await test(`${scenario} cannot open a collection or expose provider errors`, async () => {
        const rejected = await createFixture(browser, scenario);
        contexts.push(rejected.context);
        await signIn(rejected.page);
        await rejected.page.waitForFunction(
          () =>
            !document.querySelector("#auth-fields").disabled &&
            document.querySelector("#auth-feedback").textContent !==
              "Please wait…",
        );
        assert(await rejected.page.locator("#auth-view").isVisible());
        assert(await rejected.page.locator("#dashboard-view").isHidden());
        assert(!rejected.calls.some((call) => call.path.startsWith("/rest/")));
        assert.doesNotMatch(
          await rejected.page.locator("#auth-feedback").innerText(),
          /test-only-password|Provider detail/,
        );
        assert.equal(
          await rejected.page.locator("#auth-password").inputValue(),
          "",
        );
        assert.deepEqual(await storage(rejected.page), {
          local: {},
          session: {},
          cookie: "",
        });
      });
    await test("signup awaiting email confirmation never creates an authenticated collection", async () => {
      const signup = await createFixture(browser, "signup");
      contexts.push(signup.context);
      await signup.page.locator("#signup-tab").click();
      await signup.page.waitForFunction(
        () => !document.querySelector("#auth-confirm-group").hidden,
      );
      await signup.page.locator("#auth-email").fill(fixtureUser.email);
      await signup.page.locator("#auth-password").fill(fixturePassword);
      await signup.page.locator("#auth-confirm-password").fill(fixturePassword);
      await signup.page.locator("#auth-submit").click();
      await signup.page.waitForFunction(() =>
        document
          .querySelector("#auth-feedback")
          .textContent.includes("Check your email"),
      );
      assert(await signup.page.locator("#auth-view").isVisible());
      assert(await signup.page.locator("#dashboard-view").isHidden());
      assert(!signup.calls.some((call) => call.path.startsWith("/rest/")));
      assert.equal(
        await signup.page.locator("#auth-password").inputValue(),
        "",
      );
      assert.equal(
        await signup.page.locator("#auth-confirm-password").inputValue(),
        "",
      );
      assert.deepEqual(await storage(signup.page), {
        local: {},
        session: {},
        cookie: "",
      });
    });
    await test("runtime has no demo requests, persistent sessions, script errors, or unexpected failed assets", async () => {
      assert.deepEqual(observedGuest.errors, []);
      assert.deepEqual(observedGuest.failedResponses, []);
      assert.deepEqual(observed.errors, []);
      assert.deepEqual(observed.failedResponses, []);
      assertNoDemoRequests([...observedGuest.requests, ...observed.requests]);
      assertNoSecretsInURLs([...observedGuest.requests, ...observed.requests]);
      assert(
        observedGuest.requests.every(
          (request) => request.method === "GET" && !request.hasBody,
        ),
      );
    });
    if (process.env.SCREENSHOT_DIR) {
      await guest.goto(`${base}/spinarium/#signin`, {
        waitUntil: "networkidle",
      });
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      for (const [name, width, height] of [
        ["spinarium-signin-desktop", 1280, 900],
        ["spinarium-signin-mobile", 390, 844],
      ]) {
        await guest.setViewportSize({ width, height });
        await guest.evaluate(() => {
          document.activeElement?.blur();
          scrollTo(0, 0);
        });
        await guest.screenshot({
          path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`),
          fullPage: true,
        });
      }
    }
    await test("JavaScript-disabled account entry stays gated and offers a home link", async () => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 320, height: 800 },
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`${base}/spinarium/`);
      assert(await page.locator("#dashboard-view").isHidden());
      assert(await page.locator("#auth-email").isDisabled());
      assert.match(await page.locator("noscript").innerText(), /JavaScript/i);
      await page.locator('a[href="../"]').first().click();
      assert.match(await page.title(), /SpinDownGames/);
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
  if (issues.length) {
    console.error(`\n${issues.length} failed checks.`);
    process.exitCode = 1;
  } else console.log("\nAll account-gated Spinarium checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
