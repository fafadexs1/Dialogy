import { build } from 'esbuild';
import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';

// Exercise the real UI with controlled action responses; never creates a database workspace.
const fixtures: Record<string, string> = {
  action: `export async function createWorkspaceAction(previous, data) {
    window.qaCalls ||= []; window.qaCalls.push(Object.fromEntries(data));
    return new Promise((resolve, reject) => { window.qaResolve=resolve; window.qaReject=reject; });
  }`,
  navigation: `export function redirect(path){throw Error('Redirect: '+path);}`,
  link: `import React from 'react';export default function Link(props){return React.createElement('a',props);}`,
  user: `export async function getCurrentUser(){return {id:'qa'};}`,
  shell: `export function AppRouteShell({children}){return children;}`,
  i18n: `export function useI18n(){return {t:(text)=>text};}`,
};
const output = path.resolve('design-qa/workspace-launch');

async function main() {
  await mkdir(output, { recursive: true });
  const bundle = await build({
    stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/app/(workspace-creation)/settings/workspace/new/page';import Layout from './src/app/(workspace-creation)/layout';async function start(){createRoot(document.getElementById('root')).render(await Layout({children:<Page/>}));}start();`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, outdir: 'qa-bundle', platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: 'tsconfig.json', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-ui-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(@\/actions\/workspace|@\/actions\/user|@\/components\/layout\/app-route-shell|next\/navigation|next\/link|@\/i18n\/i18n-provider)$/ }, args => {
        const name = args.path === '@/actions/workspace' ? 'action' : args.path === '@/actions/user' ? 'user' : args.path === '@/components/layout/app-route-shell' ? 'shell' : args.path === 'next/navigation' ? 'navigation' : args.path === 'next/link' ? 'link' : 'i18n';
        return { path: name, namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'jsx', resolveDir: process.cwd() }));
    } }],
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const utilities = (await postcss([tailwind({ ...theme, content: ['./src/app/(workspace-creation)/layout.tsx'] })]).process('@tailwind utilities;', { from: undefined })).css;
  const css = utilities + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const results: unknown[] = [];

  async function open(width: number, theme = 'dark', reduced = true) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(`<html class="${theme}" lang="pt-BR"><head><style>html,body{margin:0;height:100%;font-family:Arial,sans-serif}#root{display:flex;height:100dvh;min-width:0}body{background:${theme === 'dark' ? '#101813' : '#f3f6f0'}}button{font-family:inherit}${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({ content: js });
    await expect(page.getByRole('heading', { name: /Vamos dar um nome/ })).toBeVisible();
    const shell = await page.locator('[data-workspace-creation-shell]').boundingBox();
    if (!shell || shell.x !== 0 || shell.y !== 0 || shell.width !== width || shell.height !== 1000) throw Error(`Creation must fill its entire host: ${JSON.stringify(shell)}`);
    return page;
  }
  async function screenshot(page: Page, name: string) {
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    if (dimensions.document > dimensions.viewport || dimensions.body > dimensions.viewport) throw Error(JSON.stringify({ name, dimensions }));
    const nodes = await page.getByRole('navigation', { name: 'Etapas de criação' }).getByRole('button').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    for (let i = 1; i < nodes.length; i++) if (nodes[i].left < nodes[i - 1].right) throw Error(`Overlapping steps: ${name}`);
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    results.push({ name, ...dimensions, stepperOverlap: false });
  }

  try {
    for (const width of [1440, 1100, 900, 768, 600, 390, 320]) {
      const page = await open(width);
      await expect(page.getByRole('heading', { name: 'Configuracoes', exact: true })).toHaveCount(0);
      await screenshot(page, `identity-${width}`);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Dê um nome');
      await page.getByRole('textbox', { name: 'Nome do workspace' }).fill('   ');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: /Vamos dar um nome/ })).toBeVisible();
      await page.getByRole('textbox', { name: 'Nome do workspace' }).fill('  Aurora Studio  ');
      await expect(page.getByRole('complementary', { name: 'Prévia do workspace' })).toContainText('Aurora Studio');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: /O seu negócio/ })).toBeVisible();
      if (await page.evaluate(() => (window as any).qaCalls?.length || 0)) throw Error('Created before review');
      await page.getByRole('radio', { name: 'Tecnologia e SaaS', exact: true }).check();
      await screenshot(page, `segment-${width}`);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Tudo do seu jeito/ })).toBeVisible();
      await expect(page.locator('[class*="reviewCard"]')).toContainText('Aurora Studio');
      await expect(page.locator('[class*="reviewCard"]')).toContainText('Tecnologia e SaaS');
      await screenshot(page, `review-${width}`);
      await page.getByRole('button', { name: 'Editar nome do workspace' }).click();
      await expect(page.getByRole('textbox', { name: 'Nome do workspace' })).toHaveValue('  Aurora Studio  ');
      await page.getByRole('textbox', { name: 'Nome do workspace' }).fill('Aurora & Equipe');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Tecnologia e SaaS', exact: true })).toBeChecked();
      await page.getByRole('radio', { name: 'Prefiro definir isso depois.', exact: true }).check();
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.locator('[class*="reviewCard"]')).toContainText('Definir depois');
      await page.getByRole('button', { name: 'Criar meu workspace', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Criando seu espaço...', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Voltar uma etapa' })).toBeDisabled();
      await expect(page.locator('[data-success="true"]')).toHaveCount(0);
      const calls = await page.evaluate(() => (window as any).qaCalls);
      if (calls.length !== 1 || calls[0].workspaceName !== 'Aurora & Equipe' || calls[0].vertical !== '__none__') throw Error(`Incorrect action payload: ${JSON.stringify(calls)}`);
      await page.evaluate(() => (window as any).qaResolve({ success: false, error: 'Falha de teste: tente novamente.' }));
      await expect(page.getByRole('alert')).toContainText('Falha de teste');
      await expect(page.locator('[class*="reviewCard"]')).toContainText('Aurora & Equipe');
      await page.getByRole('button', { name: 'Criar meu workspace', exact: true }).click();
      await page.evaluate(() => (window as any).qaResolve({ success: true, error: null }));
      await expect(page.getByRole('heading', { name: /Um novo espaço/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Entrar no meu workspace' })).toBeVisible();
      await expect(page.locator('[class*="successWorkspace"]')).toContainText('Aurora & Equipe');
      await page.screenshot({ path: path.join(output, `success-${width}.png`), fullPage: true });
      await page.close();
    }
    for (const width of [1440, 390]) {
      const page = await open(width, 'light');
      await page.getByRole('textbox', { name: 'Nome do workspace' }).fill('Equipe de Atendimento Internacional '.repeat(5));
      await screenshot(page, `light-identity-${width}`);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByRole('radio', { name: 'Provedor de internet', exact: true }).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('radio', { name: 'Provedor de internet', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await screenshot(page, `light-review-long-name-${width}`);
      await page.getByRole('button', { name: 'Criar meu workspace', exact: true }).click();
      await page.evaluate(() => (window as any).qaReject(new Error('Connection interrupted')));
      await expect(page.getByRole('alert')).toContainText('Verifique seus workspaces');
      await screenshot(page, `light-error-${width}`);
      await page.close();
    }
    const animated = await open(1440, 'dark', false);
    await animated.getByRole('textbox', { name: 'Nome do workspace' }).fill('Aurora Studio');
    await animated.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(animated.getByRole('heading', { name: /O seu negócio/ })).toBeVisible();
    await animated.getByRole('radio', { name: 'Clínica e saúde', exact: true }).check();
    await animated.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(animated.getByRole('heading', { name: /Tudo do seu jeito/ })).toBeVisible();
    await animated.getByRole('button', { name: 'Criar meu workspace', exact: true }).click();
    await animated.evaluate(() => (window as any).qaResolve({ success: true, error: null }));
    await expect(animated.getByRole('heading', { name: /Um novo espaço/ })).toBeVisible();
    await animated.screenshot({ path: path.join(output, 'celebration-motion.png'), fullPage: true });
    await animated.emulateMedia({ reducedMotion: 'reduce' });
    await expect(animated.locator('[class*="confetti"]')).toBeHidden();
    await animated.close();
    if (errors.length) throw Error(JSON.stringify(errors));
    await writeFile(path.join(output, 'checks.json'), JSON.stringify({ source: 'Real components; controlled server action and authenticated-settings fixtures. No database writes.', results, runtimeErrors: errors, checks: ['empty and whitespace validation', 'no submission before review', 'live name preview', 'native radio keyboard controls', 'preserved name and segment on back/edit', 'optional segment', 'pending controls disabled', 'exact action payload', 'error retention', 'network failure message', 'success only after action confirmation', 'long names', 'light and dark themes', 'animated transitions', 'reduced motion'] }, null, 2));
    console.log(JSON.stringify({ passed: true, responsiveChecks: results.length, runtimeErrors: errors, output }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
