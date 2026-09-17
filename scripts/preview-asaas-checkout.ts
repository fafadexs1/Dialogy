// Isolated presentation harness: real checkout component, fixture-only actions.
// It cannot contact Asaas or the database and does not prove payment processing.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';

async function main() {
  const output = path.resolve('.artifacts/asaas-checkout');
  await mkdir(output, { recursive: true });
  const actions = `
    const params=new URLSearchParams(location.search);const state=params.get('state');
    let payment={id:'pay_preview',amount:499,dueDate:'2026-09-20',status:'PENDING',billingType:'UNDEFINED',paid:false,canPay:true,awaitingConfirmation:false};
    if(state==='paid')payment={...payment,status:'CONFIRMED',paid:true,canPay:false};
    if(state==='uncertain')payment={...payment,awaitingConfirmation:true,canPay:false};
    if(state==='refunded')payment={...payment,status:'REFUNDED',canPay:false};
    export async function getAsaasPaymentAction(){return state==='error'?{success:false,error:'Prévia: serviço de pagamentos indisponível.'}:{success:true,payment};}
    export async function prepareAsaasPaymentAction({method}){
      payment={...payment,billingType:method};
      const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="white"/><rect x="8" y="8" width="176" height="176" fill="none" stroke="black" stroke-dasharray="8"/><text x="96" y="88" font-family="sans-serif" font-size="16" text-anchor="middle">PRÉVIA PIX</text><text x="96" y="112" font-family="sans-serif" font-size="12" text-anchor="middle">Sem valor de pagamento</text></svg>');
      return {success:true,payment:{...payment,...(method==='PIX'?{pix:{image,code:'PREVIA-SEM-VALOR-DE-PAGAMENTO',expiresAt:'2026-09-20 23:59:59'}}:{boleto:{code:'PREVIA-BOLETO-SEM-VALOR-DE-PAGAMENTO',url:null}})}};
    }
    export async function payAsaasCardAction(){return {success:false,error:'Prévia: nenhuma cobrança foi enviada. O teste de interface não processa cartões.'};}
  `;
  const result = await build({
    stdin: { contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AsaasPaymentDialog}from'./src/components/billing/asaas-payment-dialog';function App(){const[open,setOpen]=useState(true);return <>{open?<AsaasPaymentDialog workspaceId="preview" workspaceName="Workspace de demonstração" paymentId="pay_preview" onClose={()=>setOpen(false)} onPaid={()=>{}}/>:<button onClick={()=>setOpen(true)}>Abrir pagamento</button>}</>}createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'isolated-checkout', setup(builder) {
      builder.onResolve({ filter: /^@\/actions\/asaas$|^next\/image$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'next/image' ? `import React from 'react';export default function Image({unoptimized,...props}){return <img {...props}/>}` : actions, loader: 'tsx', resolveDir: process.cwd() }));
    } }],
  });
  const globalCss = (await readFile('src/app/globals.css', 'utf8')).replace(/^@import .*;\r?\n/gm, '');
  const css = (await postcss([tailwind({ ...theme, content: ['./src/components/{billing,ui}/**/*.{ts,tsx}'] })]).process(globalCss, { from: undefined })).css;
  await writeFile(path.join(output, 'checkout.js'), result.outputFiles[0].text);
  await writeFile(path.join(output, 'checkout.css'), css);
  await writeFile(path.join(output, 'checkout.html'), '<!doctype html><html lang="pt-BR" class="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/checkout.css"><style>body{font-family:Arial,sans-serif}</style><script>document.documentElement.className=new URLSearchParams(location.search).get("theme")==="dark"?"dark":"light";</script><body><div id="root"></div><script src="/checkout.js"></script></body></html>');
  await writeFile(path.join(output, 'index.html'), '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#eef1f5;font:14px Arial;margin:20px}nav{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}a{color:#12483e}iframe{display:block;border:1px solid #c6ccd2;border-radius:16px;margin:auto;background:white;max-width:100%}</style><h2>Checkout Dialogy · prévia de interface</h2><p>Dados fictícios. Nenhum pagamento é enviado ao Asaas.</p><nav><a href="/?width=1100">Desktop</a><a href="/?width=390">Celular 390px</a><a href="/?width=320">Celular 320px</a><a href="/?theme=dark">Tema escuro</a><a href="/?state=paid">Confirmado</a><a href="/?state=uncertain">Em verificação</a><a href="/?state=error">Falha na consulta</a><a href="/?state=refunded">Estornado</a></nav><iframe title="Checkout real com dados fictícios" height="844"></iframe><script>const p=new URLSearchParams(location.search),f=document.querySelector("iframe");f.width=p.get("width")||"1100";f.src="/checkout.html?"+p.toString();</script></html>');
  const names = new Set(['index.html', 'checkout.html', 'checkout.js', 'checkout.css']);
  createServer(async (req, res) => {
    const name = new URL(req.url || '/', 'http://localhost').pathname.slice(1) || 'index.html';
    if (!names.has(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(await readFile(path.join(output, name)));
  }).listen(9018, '127.0.0.1', () => console.log('Checkout preview: http://127.0.0.1:9018 (fixtures only)'));
}
void main();
