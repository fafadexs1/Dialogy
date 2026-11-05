import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { chromium } from '@playwright/test';

// Synthetic UI verification: all delivery and upload adapters are stubbed.
const root = process.cwd();
const output = resolve(root, 'artifacts/whatsapp-catalog-preview');
mkdirSync(output, { recursive: true });
const entry = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogDialog} from './src/components/chat/catalog-dialog';
import {CatalogEditor} from './src/components/chat/catalog-editor';
import {AnimatedComposer} from './src/components/chat/animated-composer';
import {catalogComposerProps} from './tests/fixtures/catalog-composer';
function Harness(){const [open,setOpen]=useState(false);const [sent,setSent]=useState(false);
const [catalog,setCatalog]=useState({body:'Confira nossa coleção!',cards:[{title:'Suéter de tricô',body:'Macio, confortável e disponível em várias cores. R$ 129,90',imageUrl:'https://cdn.example.com/product.jpg',buttons:[{type:'url',displayText:'Compre agora',url:'https://loja.example.com/sueter'},{type:'reply',displayText:'Tenho interesse',id:'sueter'}]}]});
return <main className="mx-auto max-w-2xl space-y-4 p-4"><h1 className="text-xl font-semibold">Catálogo · verificação local</h1><AnimatedComposer {...catalogComposerProps({instance_type:'baileys'})} onOpenCatalog={()=>setOpen(true)}/><output aria-label="Envio sintético">{sent?'Enviado em simulação':''}</output><h2 className="text-lg font-semibold">Cartões do fluxo automático</h2><CatalogEditor catalog={catalog} onChange={setCatalog} allowUpload={false}/><CatalogDialog chatId="4ed75223-7ca1-47da-9121-167b350b99b7" contactName="Cliente de teste" open={open} onOpenChange={setOpen} onSent={()=>setSent(true)}/></main>}
createRoot(document.getElementById('root')).render(<Harness/>);`;
const bundle = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, outfile: resolve(output, 'app.js'),
  format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [{ name: 'synthetic-adapters', setup(builder) {
    builder.onResolve({ filter: /actions\/whatsapp-catalog$/ }, () => ({ path: 'actions', namespace: 'synthetic' }));
    builder.onResolve({ filter: /lib\/supabase\/storage$/ }, () => ({ path: 'storage', namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, ({ path }) => ({ contents: path === 'actions'
      ? `export async function getWhatsappCatalogAvailability(){return {available:true}}; export async function sendWhatsappCatalogAction(input){return {success:true,message:{id:input.requestId,metadata:{interactiveType:'carousel',interactivePayload:{kind:'carousel',...input.catalog}}}}}`
      : `export async function uploadFileToStorage(){return {publicUrl:'https://cdn.example.com/upload.jpg',error:null}}`, loader: 'js' }));
  } }],
});
const cssSource = readFileSync(resolve(root, 'src/app/globals.css'), 'utf8').replace(/^@import .*?;\s*/m, '');
const config = loadConfig(resolve(root, 'tailwind.config.ts'));
config.content.push({ raw: entry, extension: 'tsx' });
const css = (await postcss([tailwind(config)]).process(cssSource, { from: undefined })).css
  + (bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e7ddd1"/><path d="M240 100l-100 70 55 90 45-20v140h160V240l45 20 55-90-100-70-45 35h-70z" fill="#f7f0e4" stroke="#c3b39f" stroke-width="8"/><path d="M280 110q40 70 80 0" fill="none" stroke="#c3b39f" stroke-width="10"/></svg>`;
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find((file) => file.path.endsWith('.js')).text); }
  else if (request.url === '/app.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
  else if (request.url?.startsWith('/api/media')) { response.setHeader('Content-Type', 'image/svg+xml'); response.end(svg); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Browser:', error.message); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Enviar catálogo de produtos' }).waitFor();
  await page.screenshot({ path: resolve(output, 'composer-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const catalogButton = page.getByRole('button', { name: 'Enviar catálogo de produtos' });
  const buttonBounds = await catalogButton.boundingBox();
  if (!buttonBounds || buttonBounds.x < 0 || buttonBounds.x + buttonBounds.width > 390) throw new Error('Catalog button exceeds mobile viewport.');
  await page.screenshot({ path: resolve(output, 'composer-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await catalogButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome', { exact: true }).fill('Suéter de tricô');
  await dialog.getByLabel('Descrição e preço').fill('Macio, oversized e disponível em várias cores. R$ 129,90');
  await dialog.getByLabel('Foto (URL HTTPS)').fill('https://cdn.example.com/product.jpg');
  await dialog.getByLabel('Link de compra (opcional)').fill('https://loja.example.com/sueter');
  await dialog.getByRole('button', { name: /Adicionar produto/ }).click();
  await dialog.getByRole('button', { name: 'Remover produto 2' }).click();
  await page.screenshot({ path: resolve(output, 'desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile.png') });
  const bounds = await dialog.boundingBox();
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 391) throw new Error('Dialog exceeds mobile viewport.');
  await dialog.getByRole('button', { name: 'Enviar catálogo', exact: true }).click();
  await page.getByLabel('Envio sintético').filter({ hasText: 'Enviado em simulação' }).waitFor();
  await page.getByRole('button', { name: /Adicionar produto/ }).click();
  await page.getByRole('button', { name: 'Remover produto 2' }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  const result = { passed: true, viewports: ['1280x900', '390x844'], checks: ['actual Baileys conversation composer', 'labelled catalog button', 'dialog fields', 'add/remove products', 'purchase URL', 'simulated send', 'workflow editor', 'mobile bounds'], pageErrors: errors };
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); server.close(); }
