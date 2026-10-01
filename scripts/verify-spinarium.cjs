// Test tools stay outside the public site; see spinarium/README.md for setup.
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
const issues = [];
let pageForCleanup = null;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    issues.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  } finally {
    // Keep a failing dialog assertion from blocking unrelated later checks.
    if (pageForCleanup && !pageForCleanup.isClosed()) {
      await pageForCleanup
        .evaluate(() =>
          document
            .querySelectorAll("dialog[open]")
            .forEach((dialog) => dialog.close()),
        )
        .catch(() => {});
    }
  }
};
const git = (...args) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const cards = (page) => page.locator("#collection-grid button[data-card-id]");
const cardIDs = (page) =>
  cards(page).evaluateAll((nodes) => nodes.map((node) => node.dataset.cardId));
const selectSort = async (page, pattern) => {
  const option = await page
    .locator("#collection-sort option")
    .evaluateAll((nodes, source) => {
      const match = nodes.find((node) =>
        new RegExp(source, "i").test(node.textContent),
      );
      return match?.value;
    }, pattern.source);
  assert(option, `Missing sort option ${pattern}`);
  await page.locator("#collection-sort").selectOption(option);
};
const filter = async (page, value) => {
  const control = page.locator(`#collection-filter [data-filter="${value}"]`);
  await control.click();
  assert.equal(await control.getAttribute("aria-pressed"), "true");
};
const overflow = (page) =>
  page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return (
          getComputedStyle(node).position !== "fixed" &&
          rect.width > 0 &&
          rect.right > innerWidth + 1
        );
      })
      .slice(0, 8)
      .map(
        (node) =>
          `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${node.className}`,
      ),
  }));
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 853 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  pageForCleanup = page;
  const errors = [],
    failedResponses = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push(`${response.status()} ${response.url()}`);
  });
  try {
    await test("original runtime, legal pages, branding, assets, and hosting configuration are preserved", async () => {
      const exemptDocs = new Set([
        "README.md",
        "ARTWORK.md",
        "VERIFICATION.md",
      ]);
      const originalFiles = git("ls-tree", "-r", "--name-only", preservationRef)
        .toString()
        .trim()
        .split("\n");
      for (const file of originalFiles) {
        assert(
          fs.existsSync(path.join(root, file)),
          `Original file removed: ${file}`,
        );
        if (file === "index.html" || exemptDocs.has(file)) continue;
        const original = git("show", `${preservationRef}:${file}`);
        const current = fs.readFileSync(path.join(root, file));
        if (file === "scripts/verify.cjs") {
          // A narrow additive whitelist keeps the original suite runnable.
          const allowance =
            '            if (a.getAttribute("href") === "spinarium/")\n              return a.origin !== location.origin || a.target !== "";\n';
          assert.equal(
            current.toString().replace(allowance, ""),
            original.toString(),
            "Original verification changed beyond the Spinarium link allowance",
          );
        } else {
          assert(current.equals(original), `Original file changed: ${file}`);
        }
      }
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await test("existing homepage content is intact and provides a Spinarium entry", async () => {
      const original = git("show", `${preservationRef}:index.html`).toString();
      const current = fs.readFileSync(path.join(root, "index.html"), "utf8");
      const result = await page.evaluate(
        ({ original, current }) => {
          const parser = new DOMParser();
          const before = parser.parseFromString(original, "text/html");
          const after = parser.parseFromString(current, "text/html");
          const additions = [...after.querySelectorAll('a[href*="spinarium"]')];
          additions.forEach((link) => link.remove());
          const normalize = (document) =>
            document.body.textContent.replace(/\s+/g, " ").trim();
          const links = (document) =>
            [...document.querySelectorAll("a")].map((link) => [
              link.getAttribute("href"),
              link.getAttribute("target"),
              link.getAttribute("rel"),
              link.textContent.trim(),
            ]);
          return {
            beforeText: normalize(before),
            afterText: normalize(after),
            beforeLinks: links(before),
            afterLinks: links(after),
            entryCount: additions.length,
          };
        },
        { original, current },
      );
      assert(result.entryCount > 0, "Missing Spinarium entry link");
      assert.equal(
        result.afterText,
        result.beforeText,
        "Original homepage text changed",
      );
      assert.deepEqual(
        result.afterLinks,
        result.beforeLinks,
        "Original link destination or safety attributes changed",
      );
      const entry = page.locator('a[href*="spinarium"]').first();
      await entry.click();
      assert.match(
        new URL(page.url()).pathname,
        /\/spinarium\/(?:index\.html)?$/,
      );
    });
    await page.waitForSelector("#collection-grid button[data-card-id]");
    await page.evaluate(() => document.fonts.ready);
    let allIds;
    await test("dashboard is a clearly disclosed collection preview with real selectable cards", async () => {
      assert.match(
        await page.title(),
        /Spinarium.*SpinDownGames|SpinDownGames.*Spinarium/i,
      );
      assert.match(
        await page.locator("body").innerText(),
        /preview|sample|demonstration/i,
      );
      assert.equal(await page.locator("h1").count(), 1);
      allIds = await cardIDs(page);
      assert.equal(
        allIds.length,
        10,
        "Preview fixture must provide two full collection rows",
      );
      assert.equal(new Set(allIds).size, allIds.length, "Duplicate card IDs");
      assert.match(
        await page.locator("#selected-name").textContent(),
        /Ashenling/i,
      );
    });
    await test("preview projection redacts undiscovered lore and artwork and isolates reader mutations", async () => {
      const result = await page.evaluate(async () => {
        const { demoSpinariumService } = await import("./data/demo-service.js");
        const snapshot = await demoSpinariumService.getDashboard();
        const hidden = snapshot.discoveries
          .filter((entry) => entry.status === "undiscovered")
          .map((entry) =>
            snapshot.veilings.find((veiling) => veiling.id === entry.veilingId),
          );
        const before = snapshot.ownerships.length;
        snapshot.ownerships.length = 0;
        return {
          hidden,
          before,
          after: (await demoSpinariumService.getDashboard()).ownerships.length,
          capabilities: demoSpinariumService.getCapabilities(),
        };
      });
      assert.equal(result.hidden.length, 4);
      for (const veiling of result.hidden) {
        assert.equal(veiling.name, null);
        assert.equal(veiling.type, null);
        assert.equal(veiling.origin, null);
        assert.equal(veiling.releaseDate, null);
        assert.deepEqual(veiling.artwork, []);
        assert.deepEqual(veiling.lore, []);
        assert.deepEqual(veiling.editionIds, []);
      }
      assert.equal(
        result.after,
        result.before,
        "Reader mutations persisted demo ownership",
      );
      assert.equal(result.capabilities.claims, false);
      assert.equal(result.capabilities.authentication, false);
      assert.equal(result.capabilities.transfers, false);
    });
    await test("collection search finds a known Veiling and reports an empty result", async () => {
      await page.locator("#collection-search").fill("ashEnLiNg");
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#collection-grid button[data-card-id]")
            .length === 1,
      );
      assert.match(await cards(page).first().innerText(), /Ashenling/i);
      await page.locator("#collection-search").fill("no-such-veiling-918237");
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#collection-grid button[data-card-id]")
            .length === 0,
      );
      assert.match(
        await page
          .locator("#collection-grid, #collection-status")
          .allInnerTexts()
          .then((texts) => texts.join(" ")),
        /no|nothing|found/i,
      );
      await page.locator("#collection-search").fill("");
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll("#collection-grid button[data-card-id]")
            .length === count,
        allIds.length,
      );
    });
    await test("top navigation search enters the collection with a real query", async () => {
      await page.locator("#catalog-search").fill("Crysthale");
      await page.locator("#catalog-search").press("Enter");
      await page.waitForFunction(
        () =>
          location.hash === "#collection" &&
          document.querySelectorAll("#collection-grid button[data-card-id]")
            .length === 1,
      );
      assert.equal(
        await cards(page).first().getAttribute("data-card-id"),
        "crysthale",
      );
      assert.equal(
        await page.locator("#collection-search").inputValue(),
        "Crysthale",
      );
      await page.locator("#collection-search").fill("");
      await page.locator("#catalog-search").fill("");
      await page.goto(`${base}/spinarium/#dashboard`, {
        waitUntil: "networkidle",
      });
    });
    await test("owned, discovered, and undiscovered filters are independent of selection", async () => {
      const values = await page
        .locator("#collection-filter [data-filter]")
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.filter));
      assert(
        values.includes("all") &&
          values.includes("owned") &&
          values.includes("discovered"),
      );
      const unknownValue = values.find((value) =>
        /unknown|undiscovered|unowned/.test(value),
      );
      assert(unknownValue, "Missing unowned/undiscovered filter");
      const initialSelected = await page
        .locator("#selected-name")
        .textContent();
      await filter(page, "owned");
      const owned = await cardIDs(page);
      assert.equal(
        owned.length,
        5,
        "Preview should contain five owned Veilings",
      );
      assert.equal(
        await page.locator("#selected-name").textContent(),
        initialSelected,
      );
      await filter(page, "discovered");
      const discovered = await cardIDs(page);
      assert.equal(
        discovered.length,
        6,
        "Discovered must include globally revealed owned and unowned Veilings",
      );
      await filter(page, unknownValue);
      assert(
        (await cardIDs(page)).length > 0,
        "Missing unknown collection state",
      );
      assert.match(
        await page.locator("#collection-grid").innerText(),
        /\?\?\?|unowned|not discovered|undiscovered/i,
      );
      await filter(page, "all");
      assert.deepEqual((await cardIDs(page)).sort(), [...allIds].sort());
    });
    await test("number and name sorting reorder the collection without losing records", async () => {
      await selectSort(page, /name/);
      const byName = await cardIDs(page);
      assert.deepEqual([...byName].sort(), [...allIds].sort());
      assert.deepEqual(
        byName.filter((id) => !id.startsWith("unknown-")),
        [
          "ashenling",
          "crysthale",
          "duskspore",
          "embercoil",
          "lumenkit",
          "zephyryn",
        ],
        "Revealed names should sort alphabetically",
      );
      await selectSort(page, /number/);
      const byNumber = await cardIDs(page);
      assert.deepEqual([...byNumber].sort(), [...allIds].sort());
      assert.notDeepEqual(
        byName,
        byNumber,
        "Name sort did not change the order",
      );
      assert.deepEqual(byNumber, [
        "ashenling",
        "unknown-2",
        "duskspore",
        "lumenkit",
        "crysthale",
        "unknown-6",
        "embercoil",
        "unknown-8",
        "zephyryn",
        "unknown-10",
      ]);
      for (const pattern of [/rarity/, /release/]) {
        await selectSort(page, pattern);
        const sorted = await cardIDs(page);
        assert.equal(
          sorted[0],
          pattern.source === "rarity" ? "embercoil" : "zephyryn",
          "Sort did not prioritize the preview rarity/release metadata",
        );
        assert.deepEqual([...sorted].sort(), [...allIds].sort());
      }
      await selectSort(page, /number/);
    });
    await test("keyboard selection updates details and unknown cards stay obscured", async () => {
      const unknown = cards(page)
        .filter({ hasText: /\?\?\?/ })
        .first();
      assert(await unknown.count(), "Missing undiscovered silhouette");
      const unknownID = await unknown.getAttribute("data-card-id");
      await unknown.focus();
      await page.keyboard.press("Enter");
      assert.match(
        await page.locator("#selected-name").textContent(),
        /\?\?\?|undiscovered|unknown/i,
      );
      const detail = await page.locator("#detail-panel").innerText();
      assert.match(detail, /not discovered|undiscovered|unknown/i);
      assert(
        !/Physical Serial\s+[A-Z]\d{3}-\d+/.test(detail),
        "Unknown card leaks a physical serial",
      );
      const selected = page.locator(
        `#collection-grid [data-card-id="${unknownID}"]`,
      );
      assert.equal(await selected.getAttribute("aria-pressed"), "true");
      const ashenling = cards(page)
        .filter({ hasText: /Ashenling/i })
        .first();
      await ashenling.focus();
      await page.keyboard.press("Space");
      assert.match(
        await page.locator("#selected-name").textContent(),
        /Ashenling/i,
      );
    });
    await test("full detail dialog opens, traps focus, closes with Escape, and restores focus", async () => {
      const open = page
        .locator("#detail-panel")
        .getByRole("button", { name: /view full details/i });
      await open.click();
      const dialog = page.locator("#veiling-dialog");
      assert(await dialog.isVisible());
      assert(await dialog.evaluate((node) => node.open));
      assert.match(await dialog.innerText(), /Ashenling/i);
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        // Native dialogs may cycle through browser chrome (activeElement=body).
        // They must never put focus on a background application control.
        assert(
          await dialog.evaluate(
            (node) =>
              node.contains(document.activeElement) ||
              document.activeElement === document.body,
          ),
        );
      }
      assert(
        await page.evaluate(() => {
          document.querySelector("#claim-open").focus();
          return (
            document.activeElement !== document.querySelector("#claim-open")
          );
        }),
        "Background controls can steal modal focus",
      );
      await dialog
        .getByRole("button", { name: /close Veiling details/i })
        .focus();
      await page.keyboard.press("Escape");
      assert(await dialog.isHidden());
      assert(await open.evaluate((node) => node === document.activeElement));
    });
    await test("claim flow explains the unavailable service and cannot mutate ownership or submit secrets", async () => {
      const before = await page.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookies: document.cookie,
      }));
      const beforeCards = await cardIDs(page);
      const offset = requests.length;
      const opener = page.locator("#claim-open");
      await opener.click();
      const dialog = page.locator("#claim-dialog");
      assert(await dialog.isVisible());
      assert.match(
        await dialog.innerText(),
        /not (?:yet )?(?:available|connected|enabled)|coming|unavailable|disabled|requires.*server|server.*required/i,
      );
      assert(await page.locator("#claim-code").isDisabled());
      assert(await page.locator("#claim-submit").isDisabled());
      assert(
        (await page.locator("#claim-code").inputValue()) === "",
        "Claim field should not contain a sample secret",
      );
      await page.keyboard.press("Escape");
      assert(await dialog.isHidden());
      assert(await opener.evaluate((node) => node === document.activeElement));
      assert.deepEqual(await cardIDs(page), beforeCards);
      assert.deepEqual(
        await page.evaluate(() => ({
          local: { ...localStorage },
          session: { ...sessionStorage },
          cookies: document.cookie,
        })),
        before,
      );
      assert(
        requests
          .slice(offset)
          .every((request) => request.method === "GET" && !request.body),
        "Claim UI submitted a request",
      );
    });
    await test("sidebar routes and direct links expose independent sections", async () => {
      for (const route of [
        "collection",
        "achievements",
        "discoveries",
        "transfers",
        "settings",
        "collections",
        "events",
        "news",
      ]) {
        await page.goto(`${base}/spinarium/#${route}`, {
          waitUntil: "networkidle",
        });
        assert(new URL(page.url()).hash === `#${route}`);
        if (route === "collection") {
          assert(
            await page.locator("#collection-grid").isVisible(),
            "Collection route did not show the collection",
          );
        } else {
          assert(
            await page.locator("#route-title").isVisible(),
            `Missing heading for ${route}`,
          );
          assert.match(
            await page.locator("#route-title").textContent(),
            new RegExp(
              route === "discoveries"
                ? "discovery|discoveries"
                : route === "events"
                  ? "events|gatherings"
                  : route === "news"
                    ? "news|archive"
                    : route,
              "i",
            ),
          );
        }
      }
      await page.goto(`${base}/spinarium/#dashboard`, {
        waitUntil: "networkidle",
      });
      await page.locator('#sidebar-nav a[href="#collection"]').click();
      assert.equal(new URL(page.url()).hash, "#collection");
      await page.goBack();
      assert.equal(new URL(page.url()).hash, "#dashboard");
    });
    for (const width of [320, 390, 768, 1280]) {
      for (const textScale of [100, 200]) {
        await test(`dashboard fits ${width}px at ${textScale}% text`, async () => {
          await page.setViewportSize({ width, height: 853 });
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${scale}%`;
          }, textScale);
          const size = await overflow(page);
          assert(size.document <= size.viewport + 1, JSON.stringify(size));
        });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await test("mobile navigation supports Escape and route selection", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const toggle = page.locator("#navigation-toggle");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#navigation-toggle")
            .getAttribute("aria-expanded") === "false",
      );
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert(await toggle.evaluate((node) => node === document.activeElement));
      await toggle.click();
      await page.locator('#sidebar-nav a[href="#achievements"]').click();
      assert.equal(new URL(page.url()).hash, "#achievements");
      await page.waitForFunction(
        () =>
          document
            .querySelector("#navigation-toggle")
            .getAttribute("aria-expanded") === "false",
      );
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await page.goto(`${base}/spinarium/#dashboard`, {
        waitUntil: "networkidle",
      });
    });
    await test("mobile card selection opens an accessible detail sheet for a discovered unowned Veiling", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const crystal = page.locator(
        '#collection-grid [data-card-id="crysthale"]',
      );
      await crystal.click();
      const dialog = page.locator("#veiling-dialog");
      assert(await dialog.isVisible());
      assert.match(await dialog.innerText(), /Crysthale/);
      assert.match(await dialog.innerText(), /Not owned/);
      assert.match(await dialog.innerText(), /Not claimed/);
      await page.addScriptTag({ path: axePath });
      const result = await page.evaluate(() =>
        axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        }),
      );
      assert.deepEqual(
        result.violations.map((violation) => ({
          id: violation.id,
          targets: violation.nodes.map((node) => node.target),
        })),
        [],
      );
      await page.keyboard.press("Escape");
      assert(await dialog.isHidden());
      assert(await crystal.evaluate((node) => node === document.activeElement));
      const ash = page.locator('#collection-grid [data-card-id="ashenling"]');
      await ash.click();
      await page.keyboard.press("Escape");
      assert(await dialog.isHidden());
      assert(
        await page
          .locator("#detail-panel")
          .getByRole("button", { name: /View in 3D/ })
          .isDisabled(),
      );
    });
    for (const width of [390, 1280]) {
      await test(`WCAG 2.1 AA automated checks at ${width}px with reduced motion`, async () => {
        await page.setViewportSize({ width, height: 853 });
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
        const prolonged = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((node) => {
              const style = getComputedStyle(node);
              return (
                style.animationName !== "none" &&
                style.animationDuration
                  .split(",")
                  .some((duration) => parseFloat(duration) > 0.01)
              );
            })
            .map((node) => node.id || node.className),
        );
        assert.deepEqual(
          prolonged,
          [],
          "Motion continues despite reduced-motion preference",
        );
      });
    }
    await test("claim dialog passes automated accessibility checks", async () => {
      await page.locator("#claim-open").click();
      const result = await page.evaluate(() =>
        axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        }),
      );
      assert.deepEqual(
        result.violations.map((violation) => ({
          id: violation.id,
          targets: violation.nodes.map((node) => node.target),
        })),
        [],
      );
      await page.keyboard.press("Escape");
    });
    await test("all runtime requests are local read-only assets with no script errors", async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(failedResponses, []);
      assert(
        requests.every(
          (request) => new URL(request.url).origin === new URL(base).origin,
        ),
        "Third-party runtime request",
      );
      assert(
        requests.every((request) => request.method === "GET" && !request.body),
        "Unexpected state-changing request",
      );
    });
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      for (const [name, width, height] of [
        ["spinarium-desktop", 1280, 853],
        ["spinarium-mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => {
          document.activeElement?.blur();
          scrollTo(0, 0);
        });
        await page.screenshot({
          path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`),
          fullPage: true,
        });
      }
    }
    await test("JavaScript-disabled page communicates preview limitations and links home", async () => {
      const fallback = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 320, height: 800 },
      });
      const fallbackPage = await fallback.newPage();
      try {
        await fallbackPage.goto(`${base}/spinarium/`);
        assert.match(
          await fallbackPage.locator("noscript").innerText(),
          /JavaScript/i,
        );
        const home = fallbackPage
          .locator('a[href="../"], a[href="../index.html"]')
          .first();
        assert(await home.count(), "No return-home link");
        await home.click();
        assert.equal(new URL(fallbackPage.url()).pathname, "/");
        assert.match(await fallbackPage.title(), /SpinDownGames/);
      } finally {
        await fallback.close();
      }
    });
  } finally {
    await context.close();
    await browser.close();
  }
  if (issues.length) {
    console.error(`\n${issues.length} failed checks.`);
    process.exitCode = 1;
  } else console.log("\nAll Spinarium checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
