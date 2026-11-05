import { build } from 'esbuild';
import { chromium, expect, type Page } from '@playwright/test';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Browser interaction checks against production components, isolated from payment APIs.
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {AsaasBillingPanel} from './src/components/billing/asaas-billing-panel';
import {SettingsLayoutClient} from './src/app/settings/settings-layout-client';
createRoot(document.getElementById('root')).render(<div className="h-dvh"><SettingsLayoutClient><AsaasBillingPanel/></SettingsLayoutClient></div>);`;
const fixtures: Record<string, string> = {
  asaas: `import {PLANS} from '@/lib/plans-types';
    export async function getAsaasBillingAction(){if(window.qaLoadError)throw Error('offline');return {
      workspace:{id:'qa',name:'Velpro Telecom',canManage:window.qaCanManage??true},
      plans:Object.values(PLANS).map(p=>({...p,active:true})),ready:window.qaReady??true,
      environment:'production',legacyStripe:window.qaLegacy??false,
      subscription:window.qaSubscription?{plan:'pro',price:499,status:'active',canceled:window.qaCanceled??false,accessUntil:'2026-10-12',linked:true}:null,
      invoices:window.qaSubscription?[
        {id:'paid',amount:499,status:'RECEIVED',billing_type:'PIX',due_date:'2026-08-12',invoice_url:'https://www.asaas.com/i/qa-paid'},
        {id:'pending',amount:499,status:'PENDING',billing_type:'UNDEFINED',due_date:'2026-10-12',invoice_url:'https://www.asaas.com/i/qa-pending'},
        {id:'overdue',amount:499,status:'OVERDUE',billing_type:'BOLETO',due_date:'2026-09-10',invoice_url:'https://www.asaas.com/i/qa-overdue'}]:[]};}
    export async function createAsaasCheckoutAction(input){window.qaCheckout=input;return window.qaCheckoutError?{success:false,error:'Revise seu CPF ou CNPJ.'}:{success:true,url:null};}
    export async function reconcileAsaasBillingAction(){window.qaReconciled=true;return {success:true};}
    export async function cancelAsaasSubscriptionAction(){window.qaCanceled=true;return {success:true};}`,
  credits: `export async function getAiCreditBalanceAction(){return {workspaceId:'qa',balance:1250,reserved:2.75,creditValueBrl:window.qaCreditValue??.01,billingEnabled:window.qaBillingEnabled??true,
    entries:[{id:'usage',kind:'usage',amount:-.0875,description:'internal source',createdAt:'2026-09-12T10:00:00Z'},{id:'purchase',kind:'purchase',amount:1000,description:'Recarga de créditos',createdAt:'2026-09-11T10:00:00Z'}]};}
    export async function createAiCreditCheckoutAction(credits){window.qaRecharge=credits;throw Error('Pagamento indisponível. Tente novamente.');}`,
  navigation: `export function useSearchParams(){return new URLSearchParams(window.qaQuery||'');}export function usePathname(){return '/settings/billing';}`,
  link: `import React from 'react';export default function Link(props){return React.createElement('a',props);}`,
  settings: `export function SettingsProvider({children}){return children;}export function useSettings(){return {user:{id:'qa'},loading:false};}`,
  i18n: `export function useI18n(){return {t:(s)=>s};}`,
};
const output = path.resolve('artifacts/platform-ai-credits/billing-redesign');

async function main() {
  const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-billing', setup(b) {
      const replacements: [RegExp, string][] = [[/^@\/actions\/asaas$/, 'asaas'], [/^@\/actions\/ai-credits$/, 'credits'], [/^next\/navigation$/, 'navigation'], [/^next\/link$/, 'link'], [/settings-context$/, 'settings'], [/^@\/i18n\/i18n-provider$/, 'i18n']];
      for (const [filter, name] of replacements) b.onResolve({ filter }, () => ({ path: name, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'jsx', resolveDir: process.cwd() }));
    } }],
  });
  const css = (await postcss([tailwind({ ...theme, content: [{ raw: entry, extension: 'tsx' }, './src/components/billing/*.tsx', './src/components/ui/*.tsx', './src/app/settings/settings-layout-client.tsx'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  async function open(width: number, values: Record<string, unknown> = {}) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(`<html lang="pt-BR"><head><style>:root{--background:220 20% 98%;--foreground:224 71% 4%;--primary:162 90% 53%;--primary-foreground:224 71% 4%;--border:220 13% 88%;--input:220 13% 88%;--muted:220 14% 96%;--muted-foreground:220 9% 43%;--secondary:162 50% 94%;--secondary-foreground:160 50% 20%;--destructive:0 72% 45%;--destructive-foreground:0 0% 100%;--ring:162 90% 40%;--radius:.5rem}body{font-family:Arial,sans-serif;letter-spacing:0}${css}*{border-color:hsl(var(--border))}</style></head><body><div id="root"></div></body></html>`);
    await page.evaluate(v => Object.assign(window, v), values);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    try { await expect(page.getByRole('tab', { name: 'Meu plano' })).toBeVisible(); }
    catch (error) { console.error('Render errors:', errors); throw error; }
    return page;
  }
  async function checkLayout(page: Page, name: string) {
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      return { document: document.documentElement.scrollWidth > innerWidth, content: main.scrollWidth > main.clientWidth + 1 };
    });
    if (overflow.document || overflow.content) throw new Error(`${name}: ${JSON.stringify(overflow)}`);
    const tabBoxes = await page.getByRole('tab').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    for (let i = 1; i < tabBoxes.length; i++) if (tabBoxes[i].left < tabBoxes[i - 1].right - 1) throw new Error('Overlapping tabs');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  }
  try {
    for (const width of [1440, 1024, 768, 390, 320]) {
      const page = await open(width);
      await expect(page.getByRole('heading', { name: 'Escolha seu plano' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recarregar saldo' })).toHaveCount(0);
      await checkLayout(page, `plans-${width}`);
      await page.getByRole('radio', { name: /Essencial/ }).click();
      await expect(page.getByRole('region', { name: 'Resumo do plano' })).toContainText('Essencial');
      await page.getByRole('button', { name: 'Continuar com Essencial' }).click();
      const dialog = page.getByRole('dialog', { name: 'Finalizar contratação' });
      await expect(dialog).toBeVisible();
      await page.getByLabel('Nome ou razão social').fill('Cliente de teste');
      await page.getByLabel('CPF ou CNPJ de cobrança').fill('12345678901');
      await page.evaluate(() => { (window as any).qaCheckoutError = true; });
      await page.getByRole('button', { name: 'Contratar e abrir fatura' }).click();
      await expect(dialog.getByRole('alert')).toContainText('CPF');
      await checkLayout(page, `checkout-${width}`);
      await page.evaluate(() => { (window as any).qaCheckoutError = false; });
      await page.getByRole('button', { name: 'Contratar e abrir fatura' }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).qaCheckout)).toEqual({ workspaceId: 'qa', planId: 'starter', name: 'Cliente de teste', cpfCnpj: '12345678901' });

      await page.getByRole('tab', { name: 'Créditos de IA' }).click();
      const table = page.getByRole('table', { name: 'Equivalência de créditos' });
      await expect(table).toBeVisible();
      for (const [row, pattern] of [[1, /100\s*R\$\s*1,00/], [2, /1\.000\s*R\$\s*10,00/], [3, /10\.000\s*R\$\s*100,00/]] as const) await expect(table.getByRole('row').nth(row)).toHaveText(pattern);
      await page.getByRole('radio', { name: /5\.000/ }).click();
      await expect(page.getByRole('button', { name: /Recarregar/ })).toContainText(/50,00/);
      const amount = page.getByRole('spinbutton', { name: 'Créditos para recarregar' });
      await amount.fill('100');
      await expect(page.getByRole('button', { name: /Recarregar/ })).toBeDisabled();
      await amount.fill('1000');
      await page.getByRole('button', { name: /Recarregar/ }).click();
      await expect(page.getByRole('alert')).toContainText('Pagamento indisponível');
      expect(await page.evaluate(() => (window as any).qaRecharge)).toBe(1000);
      await amount.fill('5000');
      await checkLayout(page, `credits-${width}`);
      await page.getByText('Como os créditos são utilizados', { exact: true }).click();
      await expect(page.getByText(/Um atendimento pode envolver/)).toBeVisible();
      await page.locator('summary').filter({ hasText: 'Extrato de créditos' }).click();
      await expect(page.getByRole('table', { name: 'Extrato de créditos' })).toContainText('Consumo de IA');
      await checkLayout(page, `credit-details-${width}`);
      await page.evaluate(() => { (window as any).qaCreditValue = .02; });
      await page.getByRole('button', { name: 'Atualizar saldo' }).click();
      await expect(table.getByRole('row').nth(2)).toHaveText(/1\.000\s*R\$\s*20,00/);
      await expect(page.getByRole('button', { name: /Recarregar/ })).toContainText('100,00');
      if (/DeepSeek|Gemini|OpenAI|US\$|cotação/.test(await page.locator('main').innerText())) throw new Error('Supplier costs leaked');
      await page.getByRole('tab', { name: 'Faturas' }).click();
      await expect(page.getByRole('heading', { name: 'Suas faturas aparecerão aqui' })).toBeVisible();
      await page.close();

      const active = await open(width, { qaSubscription: true });
      await expect(active.getByRole('heading', { name: 'Escolha seu plano' })).toHaveCount(0);
      await expect(active.getByRole('link', { name: 'Pagar fatura', exact: true })).toHaveAttribute('href', 'https://www.asaas.com/i/qa-overdue');
      await checkLayout(active, `current-plan-${width}`);
      await active.getByRole('tab', { name: /Faturas/ }).click();
      const invoices = active.getByRole('list', { name: 'Faturas do plano' });
      await expect(invoices.getByRole('listitem')).toHaveCount(3);
      await expect(invoices.getByRole('listitem').first()).toContainText('Vencido');
      await checkLayout(active, `invoices-${width}`);
      await active.getByRole('button', { name: 'Atualizar', exact: true }).click();
      await active.waitForFunction(() => (window as any).qaReconciled);
      await active.getByRole('tab', { name: 'Meu plano' }).click();
      await active.getByRole('button', { name: 'Gerenciar', exact: true }).click();
      await active.getByRole('button', { name: 'Cancelar renovação', exact: true }).click();
      await active.getByRole('button', { name: 'Manter assinatura' }).click();
      expect(await active.evaluate(() => (window as any).qaCanceled)).toBeUndefined();
      await active.getByRole('button', { name: 'Gerenciar', exact: true }).click();
      await active.getByRole('button', { name: 'Cancelar renovação', exact: true }).click();
      await active.getByRole('button', { name: 'Confirmar cancelamento' }).click();
      await expect(active.getByRole('region', { name: 'Assinatura atual' })).toContainText('Renovação cancelada');
      await active.close();
    }
    for (const scenario of [{ qaCanManage: false }, { qaReady: false }, { qaLegacy: true }]) {
      const page = await open(390, scenario);
      await expect(page.getByRole('button', { name: /Continuar com/ })).toBeDisabled();
      await page.close();
    }
    const returned = await open(390, { qaQuery: 'credits=success', qaBillingEnabled: false });
    await expect(returned.getByRole('tab', { name: 'Créditos de IA' })).toHaveAttribute('data-state', 'active');
    await expect(returned.getByText(/Os créditos serão liberados após a confirmação/)).toBeVisible();
    await expect(returned.getByText('O consumo de créditos está desativado no momento.')).toBeVisible();
    await returned.close();
    for (const width of [1440, 390]) {
      const page = await open(width, { qaSubscription: true });
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        for (const [key, value] of Object.entries({ background: '240 17% 2%', foreground: '210 40% 98%', muted: '240 6% 15%', 'muted-foreground': '240 5% 65%', border: '240 6% 22%', input: '240 6% 22%' })) document.documentElement.style.setProperty('--' + key, value);
        document.body.style.background = 'hsl(var(--background))';
        document.body.style.color = 'hsl(var(--foreground))';
      });
      await checkLayout(page, `current-plan-dark-${width}`);
      await page.getByRole('tab', { name: 'Créditos de IA' }).click();
      await expect(page.getByRole('heading', { name: 'Recarregar saldo' })).toBeVisible();
      await checkLayout(page, `credits-dark-${width}`);
      await page.close();
    }
    if (errors.length) throw new Error(JSON.stringify(errors));
    await writeFile(path.join(output, 'verification.json'), JSON.stringify({ viewports: [1440, 1024, 768, 390, 320], scenarios: ['plan-selection', 'checkout-success-and-error', 'subscription', 'pending-invoices', 'refresh', 'cancel-confirmation', 'permissions', 'readiness', 'legacy-subscription', 'credits-presets', 'minimum-recharge', 'dynamic-credit-price', 'credit-explanation', 'ledger', 'payment-return'], backend: 'Isolated fixtures. No charges, cancellations or database changes.', runtimeErrors: errors }, null, 2));
    console.log('Billing UI passed across five viewports with isolated payment fixtures.');
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
