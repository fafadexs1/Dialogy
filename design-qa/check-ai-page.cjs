const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const results = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('http://localhost:9002/ia', { waitUntil: 'networkidle', timeout: 120000 });
  assert.equal(response.status(), 200);
  await expect(page.locator('h1')).toHaveCount(1);
  assert.match(await page.title(), /Inteligência artificial.*Dialogy/);
  assert.equal(await page.locator('link[rel="canonical"]').count(), 1);
  assert.equal(await page.locator('#dialogy-ai-faq').count(), 1);
  // Suppress only Next's development indicator in saved review images.
  await page.addStyleTag({ content: 'nextjs-portal { display:none; }' });
  await page.screenshot({ path: path.join(__dirname, 'ai-desktop.png') });

  for (const width of [1440, 1024, 768, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Vender melhor', 'Dar suporte', 'Organizar o financeiro']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
      assert.ok(dimensions.document <= width && dimensions.body <= width, JSON.stringify({ width, name, dimensions }));
      results.push({ width, scenario: name, ...dimensions });
    }
  }
  await expect(page.getByText('Encontrei sua fatura no sistema conectado.', { exact: false })).toBeVisible();
  for (const [name, text] of [['Descontraído', 'Opa, chegou no lugar certo!'], ['Acolhedor', 'Que bom ter você aqui.'], ['Objetivo', 'Posso tirar dúvidas']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[class*="toneMessage"]')).toContainText(text);
  }
  await page.getByRole('button', { name: 'Ver transcrição de exemplo', exact: true }).click();
  await expect(page.locator('#audio-transcript')).toContainText('equipe de oito pessoas');
  await page.getByRole('button', { name: 'Ocultar transcrição de exemplo', exact: true }).click();
  await expect(page.locator('#audio-transcript')).toHaveCount(0);
  for (const name of ['Entende o pedido', 'Consulta o que sabe', 'Coloca a mão na massa', 'Dá o próximo passo']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.locator('[class*="stepContent"] h3')).toHaveText(`${name}.`);
  }
  await page.getByRole('button', { name: 'Ver a passagem para a equipe' }).click();
  await expect(page.getByText('Ju, da equipe. Com o contexto em mãos.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rever exemplo' }).click();
  for (const detail of await page.locator('details').all()) {
    await detail.locator('summary').click();
    await expect(detail).toHaveAttribute('open', '');
    await expect(detail.locator('p')).toBeVisible();
    await detail.locator('summary').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(__dirname, 'ai-mobile.png') });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação mobile', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Navegação mobile', exact: true }).getByRole('link', { name: 'Do seu jeito' }).click();
  await expect(page.getByRole('button', { name: 'Abrir menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
  assert.equal(new URL(page.url()).hash, '#personalidade');
  // Native buttons remain operable from a keyboard.
  await page.getByRole('button', { name: 'Acolhedor', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Acolhedor', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  assert.equal(await page.locator('[class*="face"] i').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const id of ['possibilidades', 'personalidade', 'como-funciona']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(__dirname, `ai-${id}-${width}.png`) });
    }
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: path.join(__dirname, `ai-full-${width}.png`), fullPage: true });
  }
  await page.getByRole('link', { name: 'Explorar planos e recursos' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page.goto('http://localhost:9002/ia', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Quero essa IA no meu time' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.goto('http://localhost:9002', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'nextjs-portal { display:none; }' });
  await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Navegação mobile', exact: true }).getByRole('link', { name: 'Inteligência artificial' }).click();
  await expect(page).toHaveURL(/\/ia$/);
  await expect(page.locator('h1')).toContainText('Carisma natural.');

  assert.deepEqual(errors, []);
  const report = { checkedAt: new Date().toISOString(), results, interactions: ['3 cenários', '3 tons de voz', 'transcrição abre/fecha', '4 etapas', 'transferência/reinício', '6 FAQs', 'menu mobile', 'teclado', 'movimento reduzido', 'CTA cadastro', 'CTA planos', 'navegação da home'], runtimeErrors: errors };
  fs.writeFileSync(path.join(__dirname, 'ai-page-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
