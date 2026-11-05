// Runs only inside the networkless browser image; HTML is untrusted.
const { chromium } = require('playwright');
async function main() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 1100000) throw new Error('Entrada excede limite.'); }
  const { html, action, selector, value, baseUrl, javascript, scripts = [] } = JSON.parse(raw);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: !!javascript && action !== 'scripts', serviceWorkers: 'block', acceptDownloads: false });
    const approvedScripts = new Map(scripts.map(entry => [entry.url, entry.content]));
    let capture = false; const requests = [];
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.method() === 'GET' && request.resourceType() === 'script' && approvedScripts.has(request.url())) return route.fulfill({ status: 200, contentType: 'application/javascript', body: approvedScripts.get(request.url()) });
      if (capture && (request.isNavigationRequest() || ['fetch', 'xhr'].includes(request.resourceType()))) {
        requests.push({ target: request.url(), method: request.method(), body: (request.postData() || '').slice(0, 16001), contentType: (request.headers()['content-type'] || '').slice(0, 200) });
      }
      return route.abort();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    const page = await context.newPage();
    context.on('page', other => { if (other !== page) void other.close(); });
    const safeBase = typeof baseUrl === 'string' ? `<base href="${baseUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">` : '';
    await page.setContent(safeBase + html, { waitUntil: 'domcontentloaded', timeout: 5000 });
    if (page.url() !== 'about:blank') throw new Error('Navegação programática foi bloqueada.');
    if (action === 'scripts') {
      const urls = await page.locator('script[src]').evaluateAll(elements => elements.slice(0, 20).map(el => el.src));
      return { urls };
    }
    if (action === 'read') {
      const text = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
      return { text: text.slice(0, 20000) };
    }
    const element = page.locator(`css=${selector}`);
    if (await element.count() !== 1) throw new Error('O seletor deve identificar exatamente um elemento.');
    if (action === 'fill') {
      const info = await element.evaluate(el => ({ tag: el.tagName, type: (el.getAttribute('type') || '').toLowerCase(), name: (el.getAttribute('name') || '').toLowerCase() }));
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(info.tag) || ['password', 'file', 'hidden'].includes(info.type) || /password|passwd|token|secret|senha|cvv|card|cartao/i.test(info.name)) throw new Error('Este campo não pode ser preenchido.');
      if (info.tag === 'SELECT') await element.selectOption(value, { timeout: 3000 });
      else await element.fill(value, { timeout: 3000 });
      await element.evaluate(el => { if (el.tagName === 'TEXTAREA') el.textContent = el.value; else if (el.tagName === 'SELECT') for (const opt of el.options) opt.toggleAttribute('selected', opt.selected); else el.setAttribute('value', el.value); });
      return { html: await page.content(), filled: true };
    }
    if (action === 'click') {
      if (javascript) {
        capture = true;
        await element.click({ timeout: 3000, noWaitAfter: true });
        await page.waitForTimeout(300);
        capture = false;
        if (page.url() !== 'about:blank') throw new Error('Navegação programática foi bloqueada.');
        if (requests.length > 1) throw new Error('A interação solicitou várias operações; nenhuma foi executada.');
        if (requests.length === 1) return { networkIntent: requests[0] };
        return { html: await page.content(), clicked: true };
      }
      const intent = await element.evaluate(el => {
        const a = el.closest('a[href]');
        if (a) return { kind: 'link', target: a.getAttribute('href'), method: 'GET' };
        const form = el.closest('form');
        if (!form || !['BUTTON', 'INPUT'].includes(el.tagName) || !['submit', 'image', ''].includes((el.getAttribute('type') || '').toLowerCase())) return null;
        const fields = [];
        for (const field of form.elements) {
          const name = field.name || ''; const type = (field.type || '').toLowerCase();
          if (!name || field.disabled || ['submit', 'button', 'reset', 'image'].includes(type) || (['checkbox', 'radio'].includes(type) && !field.checked)) continue;
          if (['password', 'file', 'hidden'].includes(type) || /password|passwd|token|secret|senha|cvv|card|cartao/i.test(name)) throw new Error('O formulário contém campo protegido.');
          fields.push([name, String(field.value || '')]);
        }
        return { kind: 'form', target: form.getAttribute('action') || '', method: (form.getAttribute('method') || 'GET').toUpperCase(), fields };
      });
      if (!intent) throw new Error('Somente links e botões de formulários HTML são suportados.');
      return { intent };
    }
    throw new Error('Ação não suportada.');
  } finally { await browser.close(); }
}
main().then(result => process.stdout.write(JSON.stringify(result))).catch(error => { process.stderr.write(String(error && error.message || error).slice(0, 1000)); process.exitCode = 1; });
