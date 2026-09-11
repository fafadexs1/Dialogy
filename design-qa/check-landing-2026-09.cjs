const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const results = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("http://localhost:9002", {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  assert.equal(response.status(), 200);
  await page.locator("h1").waitFor();
  await page.screenshot({
    path: path.join(__dirname, "dialogy-september-desktop.png"),
  });
  for (const width of [1440, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ["Inbox unificado", "Agentes de IA", "CRM de vendas"]) {
      await page.getByRole("tab", { name }).click();
      assert.equal(
        await page.getByRole("tab", { name }).getAttribute("aria-selected"),
        "true",
      );
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(
        dimensions.document <= width && dimensions.body <= width,
        JSON.stringify({ name, dimensions }),
      );
      results.push({ width, tab: name, ...dimensions });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Inbox unificado" }).click();
  await page.getByRole("button", { name: /Rafael Lima/ }).click();
  await page
    .locator('[class*="incoming"]')
    .filter({ hasText: "Olá! Vi vocês no Instagram." })
    .waitFor();
  await page.getByRole("button", { name: /Luiza Martins/ }).click();
  await page
    .locator('[class*="incoming"]')
    .filter({ hasText: "Preciso de ajuda para configurar meu primeiro canal." })
    .waitFor();
  await page.getByRole("button", { name: /Marina Costa/ }).click();
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Navegação mobile", exact: true })
    .getByRole("link", { name: "Inteligência artificial" })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Abrir menu", exact: true })
      .getAttribute("aria-expanded"),
    "false",
  );
  assert.ok(page.url().endsWith("#ia"));
  const question = page.locator("summary").first();
  await question.click();
  assert.equal(await page.locator("details").first().getAttribute("open"), "");
  await question.click();
  await page.getByRole("tab", { name: "Inbox unificado" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Agentes de IA" })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: "Inbox unificado" }).click();
  const logo = await page
    .locator("header img")
    .evaluate((el) => ({
      loaded: el.complete && el.naturalWidth > 0,
      src: el.getAttribute("src"),
    }));
  assert.ok(logo.loaded);
  for (const [width, label] of [
    [1440, "desktop"],
    [390, "mobile"],
  ]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(async () => {
      const el = document.scrollingElement;
      for (let top = 0; top < el.scrollHeight; top += 550) {
        window.scrollTo(0, top);
        document.body.scrollTop = top;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
    });
    await page.waitForTimeout(900);
    await page.screenshot({
      path: path.join(__dirname, `dialogy-september-${label}.png`),
    });
    await page.screenshot({
      path: path.join(__dirname, `dialogy-september-${label}-full.png`),
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page
    .locator('[class*="floatingChannel"]')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(motion, "none");
  const routes = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [label, pathname] of [
    ["Começar minha experiência", "/register"],
    ["Entrar", "/login"],
    ["Encontrar meu plano", "/pricing"],
  ]) {
    await page.goto("http://localhost:9002", { waitUntil: "networkidle" });
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(`**${pathname}`, { timeout: 60000 });
    await page.locator(pathname === "/pricing" ? "main" : "form").first().waitFor({ timeout: 60000 });
    routes.push({ pathname, url: page.url(), contentVisible: true });
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(
    path.join(__dirname, "dialogy-september-checks.json"),
    JSON.stringify(
      {
        results,
        logo,
        routes,
        reducedMotion: motion,
        errors,
        interactions: [
          "contact switching",
          "three product tabs",
          "keyboard tabs",
          "mobile navigation",
          "FAQ expansion",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ checks: results.length, logo, errors, status: "passed" }),
  );
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
