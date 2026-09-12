import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Component-only browser QA: all server actions are isolated fixtures, no payments.
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{AiCreditsPanel}from'./src/components/billing/ai-credits-panel';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-4xl p-5"><AiCreditsPanel workspaceId="qa"/></main>);`;
const actions = `export async function getAiCreditBalanceAction(){return {workspaceId:'qa',balance:1000,reserved:1.25,creditValueBrl:window.qaCreditValue??.01,billingEnabled:window.qaBillingEnabled??false,entries:[]};}
export async function createAiCreditCheckoutAction(credits){window.qaCheckoutCredits=credits;return {url:null};}`;

async function main() {
  const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:'tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},
    plugins:[{name:'fixture-actions',setup(b){b.onResolve({filter:/^@\/actions\/ai-credits$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:actions,loader:'js'}));}}]});
  const css=(await postcss([tailwind({...theme,content:[{raw:entry,extension:'tsx'},'./src/components/billing/*.tsx','./src/components/ui/*.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
  const output=path.resolve('artifacts/platform-ai-credits');await mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [1440,390,320]) {
      const page=await browser.newPage({viewport:{width,height:1000}});
      const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>route.abort());
      await page.setContent(`<html lang="pt-BR"><head><style>:root{--background:0 0% 100%;--foreground:220 10% 12%;--primary:153 55% 30%;--primary-foreground:0 0% 100%;--border:220 15% 87%;--input:220 15% 87%;--muted:220 15% 96%;--muted-foreground:220 8% 45%;--ring:153 55% 30%;--radius:.5rem}body{font-family:Arial,sans-serif;letter-spacing:0}${css}</style></head><body><div id="root"></div></body></html>`);
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      const table=page.getByRole('table',{name:'Equivalência de créditos'});
      await expect(table).toBeVisible();
      await expect(table.getByRole('row').nth(1)).toHaveText(/100\s*R\$\s*1,00/);
      await expect(table.getByRole('row').nth(2)).toHaveText(/1\.000\s*R\$\s*10,00/);
      await expect(table.getByRole('row').nth(3)).toHaveText(/10\.000\s*R\$\s*100,00/);
      await expect(page.getByRole('status')).toContainText('desativado');
      const recharge=page.getByRole('spinbutton',{name:'Créditos para recarregar'});
      await recharge.fill('100');
      await expect(page.getByRole('button',{name:/Recarregar/})).toBeDisabled();
      await recharge.fill('1000');
      await expect(page.getByRole('button',{name:/Recarregar/})).toContainText(/R\$\s*10,00/);
      await page.getByRole('button',{name:/Recarregar/}).click();
      await page.waitForFunction(()=>(window as any).qaCheckoutCredits===1000);
      const body=await page.locator('body').innerText();
      if(/DeepSeek|Gemini|OpenAI|US\$|cotação/i.test(body))throw new Error('Supplier details visible');
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)||errors.length)throw new Error(JSON.stringify({width,errors,overflow:true}));
      await page.screenshot({path:path.join(output,'credit-transparency-'+width+'.png'),fullPage:true});
      await page.evaluate(()=>{(window as any).qaCreditValue=.02;(window as any).qaBillingEnabled=true;});
      await page.getByRole('button',{name:'Atualizar saldo'}).click();
      await expect(table.getByRole('row').nth(2)).toHaveText(/1\.000\s*R\$\s*20,00/);
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.getByRole('button',{name:/Recarregar/})).toContainText(/R\$\s*20,00/);
      await page.close();
    }
    await writeFile(path.join(output,'credit-transparency-verification.json'),JSON.stringify({viewports:[1440,390,320],dynamicValue:true,tableVerified:true,minimumRecharge:true,noSupplierCosts:true,backend:'isolated fixtures; no payments'},null,2));
    console.log('Credit transparency passed at 1440, 390 and 320px, including dynamic prices and recharge. Fixtures only.');
  } finally {await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
