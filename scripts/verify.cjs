// Run against a local or deployed site. Test dependencies are not shipped to visitors.
// npm install --no-save playwright axe-core
// BASE_URL=http://127.0.0.1:8000 BROWSER_PATH=/path/to/chrome node scripts/verify.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.BASE_URL || "http://127.0.0.1:8000";
const screenshotDir = process.env.SCREENSHOT_DIR;
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
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || undefined,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [],
      requests = [],
      failures = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await test("initial load defers coin model and uses self-hosted assets", async () => {
      assert(
        !requests.some((url) => url.endsWith("/coin.glb")),
        "Coin model loaded above the fold",
      );
      assert(
        requests.every((url) => new URL(url).origin === new URL(base).origin),
        "Third-party runtime request",
      );
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(
        await page.title(),
        "SpinDownGames — Big plays. Better company.",
      );
    });
    await test("navigation destinations and external link safety", async () => {
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll("a")]
          .filter((a) => {
            if (a.getAttribute("href").startsWith("#"))
              return !document.getElementById(a.hash.slice(1));
            const expected = a.matches(
              "#contact .contact-copy a, .path-card.collector",
            )
              ? "https://discord.gg/CK7rKFJVPX"
              : "https://www.instagram.com/spindowngamingco/";
            return (
              a.href !== expected ||
              a.target !== "_blank" ||
              !a.rel.includes("noopener") ||
              !a.rel.includes("noreferrer")
            );
          })
          .map((a) => a.outerHTML),
      );
      assert.deepEqual(bad, []);
      assert.equal(
        await page.getByRole("link", { name: /Join us on Discord/ }).count(),
        1,
      );
      assert.equal(
        await page.getByText("This Saturday", { exact: true }).count(),
        0,
      );
    });
    for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
      for (const textScale of [100, 200]) {
        await test(`${width}px layout at ${textScale}% text`, async () => {
          await page.setViewportSize({ width, height: 1000 });
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = `${scale}%`;
          }, textScale);
          const size = await page.evaluate(() => ({
            viewport: innerWidth,
            content: document.documentElement.scrollWidth,
          }));
          assert(size.content <= size.viewport, JSON.stringify(size));
        });
      }
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "";
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await test("mobile menu keyboard and anchor navigation", async () => {
      const menu = page.getByRole("button", { name: /Menu/ });
      await menu.click();
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert(await menu.evaluate((el) => el === document.activeElement));
      await menu.click();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "The meetups" })
        .click();
      assert.equal(new URL(page.url()).hash, "#events");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "events",
      );
    });
    await test("past event archive expands and closes", async () => {
      const details = page.locator(".event-archive");
      await details.locator("summary").click();
      assert(await details.evaluate((el) => el.open));
      assert(
        await page.locator(".event-archive > div > p").first().isVisible(),
      );
      assert.match((await details.innerText()).replace(/\s+/g, " "), /not current offers or a report/);
      await details.locator("summary").click();
      assert(!(await details.evaluate((el) => el.open)));
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await test("D20 and D6 roll endpoints, history cap, and accessible result", async () => {
      await page.evaluate(() => {
        window.__rollSeed = 0;
        Object.defineProperty(crypto, "getRandomValues", {
          configurable: true,
          value: (array) => {
            array[0] = window.__rollSeed;
            return array;
          },
        });
      });
      const rollButton = page.locator("#roll-button");
      await rollButton.click();
      assert.equal(await page.locator("#die-value").textContent(), "1");
      assert.match(await page.locator("#roll-result").textContent(), /D20: 1/);
      await page.evaluate(() => {
        window.__rollSeed = 19;
      });
      await rollButton.click();
      assert.equal(await page.locator("#die-value").textContent(), "20");
      assert.match(
        await page.locator("#roll-result").textContent(),
        /Natural 20/,
      );
      await page.getByRole("radio", { name: "D6", exact: true }).check();
      assert.match(await rollButton.textContent(), /Roll the D6/);
      await page.evaluate(() => {
        window.__rollSeed = 5;
      });
      for (let i = 0; i < 7; i++) await rollButton.click();
      assert.equal(await page.locator("#die-value").textContent(), "6");
      assert.match(await page.locator("#roll-result").textContent(), /D6: 6/);
      assert.equal(await page.locator(".roll-chip").count(), 5);
      assert.equal(
        await page.locator("#roll-result").getAttribute("role"),
        "status",
      );
      assert.equal(await page.locator(".is-rolling").count(), 0);
    });
    await test("animated roll blocks repeat clicks and die changes", async () => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.evaluate(() => {
        window.__rollSeed = 2;
      });
      await page.locator("#roll-button").click();
      assert(await page.locator("#roll-button").isDisabled());
      assert(
        await page
          .getByRole("radio", { name: "D20", exact: true })
          .isDisabled(),
      );
      await page.evaluate(() =>
        document
          .querySelector("#roll-button")
          .dispatchEvent(new MouseEvent("click")),
      );
      await page.waitForFunction(
        () => !document.querySelector("#roll-button").disabled,
      );
      assert.equal(
        await page.locator(".roll-chip").first().textContent(),
        "D6: 3",
      );
      assert.equal(
        await page.locator(".roll-chip").nth(1).textContent(),
        "D6: 6",
      );
    });
    await test("coin loads on approach and supports keyboard and pause controls", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.locator("#coin-stage").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelector("#coin-stage").dataset.state === "ready",
        { timeout: 15000 },
      );
      const toggle = page.locator("#coin-toggle");
      assert.equal(await toggle.textContent(), "Start rotation");
      await toggle.click();
      assert.equal(await toggle.textContent(), "Pause rotation");
      await page.locator("#coin-canvas").focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await toggle.textContent(), "Start rotation");
      await page.keyboard.press("Home");
      await page.keyboard.press("Space");
      assert.equal(await toggle.textContent(), "Pause rotation");
      await toggle.click();
    });
    for (const width of [390, 1440]) {
      await test(`WCAG 2.1 AA automated accessibility at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addScriptTag({ path: axePath });
        const results = await page.evaluate(() =>
          axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          }),
        );
        assert.deepEqual(
          results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
          [],
        );
      });
    }
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["mobile", 390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `${screenshotDir}/${name}.png`,
          fullPage: true,
        });
        await page.screenshot({ path: `${screenshotDir}/${name}-hero.png` });
      }
    }
    await test("no script errors or failed assets", async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(failures, []);
    });
    await test("JavaScript-disabled navigation, event archive, and coin poster", async () => {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 320, height: 800 },
      });
      const fallback = await context.newPage();
      await fallback.goto(base, { waitUntil: "networkidle" });
      await fallback
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "The meetups" })
        .click();
      assert.equal(new URL(fallback.url()).hash, "#events");
      await fallback.locator(".event-archive summary").click();
      assert(
        await fallback.locator(".event-archive > div > p").first().isVisible(),
      );
      await fallback.locator(".coin-poster").scrollIntoViewIfNeeded();
      await fallback.waitForFunction(
        () => document.querySelector(".coin-poster").naturalWidth > 0,
      );
      assert(await fallback.locator(".coin-poster").isVisible());
      assert(await fallback.locator("#roll-button").isDisabled());
      await context.close();
    });
    await test("unavailable WebGL keeps a usable still preview", async () => {
      const fallback = await browser.newPage({ reducedMotion: "reduce" });
      await fallback.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === "webgl" ? null : getContext.call(this, type, ...args);
        };
      });
      await fallback.goto(base);
      await fallback.locator("#coin-stage").scrollIntoViewIfNeeded();
      await fallback.waitForFunction(
        () =>
          document.querySelector("#coin-stage").dataset.state === "fallback",
      );
      assert(await fallback.locator(".coin-poster").isVisible());
      assert(await fallback.locator("#coin-toggle").isHidden());
      await fallback.close();
    });
    await test("missing coin model keeps the poster and the rest of the page usable", async () => {
      const fallback = await browser.newPage({ reducedMotion: "reduce" });
      await fallback.route("**/coin.glb", (route) =>
        route.fulfill({ status: 404, body: "Not found" }),
      );
      await fallback.goto(base);
      await fallback.locator("#coin-stage").scrollIntoViewIfNeeded();
      await fallback.waitForFunction(
        () =>
          document.querySelector("#coin-stage").dataset.state === "fallback",
      );
      assert(await fallback.locator(".coin-poster").isVisible());
      await fallback.locator("#roll-button").click();
      assert.match(
        await fallback.locator("#roll-result").textContent(),
        /^D20: /,
      );
      await fallback.close();
    });
  } finally {
    await browser.close();
  }
  if (issues.length) {
    console.error(`\n${issues.length} failed checks.`);
    process.exitCode = 1;
  } else console.log("\nAll checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
