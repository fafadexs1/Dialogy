import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';

// Browser component QA uses explicit fixtures; it never calls billing or providers.
const actions=`
const config={defaultModel:'openai/test',models:[{id:'openai/test',label:'Atendimento',enabled:true,inputCost:2,outputCost:8,inputMarkup:50,outputMarkup:25}],creditValueBrl:.01,costCurrency:'BRL',usdToBrl:5,billingEnabled:true};
const legacyModels=[{id:'googleai/gemini-3.1-flash-lite',label:'Gemini 3 Flash',enabled:true,description:'Preview experimental.'},{id:'googleai/gemini-3.5-flash',label:'Gemini 3.5 Flash',enabled:true},{id:'deepseek/deepseek-flash',label:'DeepSeek Latest Version',enabled:true}];
const decisions=Object.fromEntries(['toolIntentGate','intentClassifier','workflowClassifier','fieldExtractor'].map(role=>[role,{model:'deepseek/deepseek-flash',timeoutMs:role==='fieldExtractor'?2500:15000}]));
export async function saveAiDecisionModelConfigAction(value){window.savedDecisions=value;return {success:true};}
export async function syncLmStudioModelsAction(){return {success:true,models:[{id:'lmstudio/local',label:'Local',enabled:true}]};}
export async function getPlatformAiSettingsAction(){return {config:null,legacyModels,decisions,configuredProviders:['openai'],workspaces:[{id:'workspace',name:'Workspace de teste',balance:'1250',reserved:'0'}]};}
export async function savePlatformAiSettingsAction(value){window.savedConfig=value;return {success:true};}
export async function savePlatformAiKeyAction(){return {success:true};}
export async function grantAiCreditsAction(value){window.grant=value;return {success:true};}
export async function getAiCreditBalanceAction(){return {workspaceId:'workspace',balance:1250,reserved:1.25,creditValueBrl:.01,entries:[{id:'entry',amount:-.125,kind:'usage',description:'consumo',createdAt:'2026-09-12T12:00:00Z'}]};}
export async function createAiCreditCheckoutAction(){return {url:null};}
export async function getPendingAiCreditCallsAction(){return [];}
export async function reconcileAiCreditCallAction(){return {success:true};}
export async function getLmStudioConfigAction(){return {config:{baseUrl:'',apiToken:''}};}
export async function saveLmStudioConfigAction(){return {success:true};}
`;
async function main(){
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{PlatformAiSettings}from'./src/components/superadmin/platform-ai-settings';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl space-y-8 p-5"><PlatformAiSettings/></main>);`,resolveDir:process.cwd(),loader:'tsx'},
  bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'isolated-actions',setup(b){b.onResolve({filter:/^@\/actions\/(ai-credits|ai-models)$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:actions,loader:'js'}));}}],
  // Resolve normal application aliases through tsconfig; only actions are replaced.
  tsconfig:'tsconfig.json',
});
const css=(await postcss([tailwind({...theme,content:['./scripts/verify-platform-ai-ui.ts','./src/components/superadmin/*.tsx','./src/components/billing/ai-credits-panel.tsx','./src/components/ui/*.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined})).css;
const output=path.resolve('artifacts/platform-ai-credits');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(`<html><head><style>:root{--background:0 0% 100%;--foreground:220 10% 12%;--primary:153 55% 30%;--primary-foreground:0 0% 100%;--border:220 15% 87%;--input:220 15% 87%;--muted:220 15% 96%;--muted-foreground:220 8% 45%;--ring:153 55% 30%;--radius:.5rem}body{font-family:Arial,sans-serif;letter-spacing:0}${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.getByRole('heading',{name:'IA Global'}).waitFor();
    const check=async(name:string)=>{
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(errors.length||overflow)throw new Error(JSON.stringify({width,errors,overflow}));
      await page.screenshot({path:path.join(output,name+'-'+width+'.png'),fullPage:true});
    };
    if(await page.getByRole('textbox',{name:'Nome',exact:true}).count()!==3)throw new Error('Legacy catalog missing');
    await check('models');
    await page.getByRole('combobox',{name:'Provedor',exact:true}).selectOption('lmstudio');
    await page.getByRole('button',{name:'Sincronizar modelos'}).waitFor();
    await page.getByRole('combobox',{name:'Provedor',exact:true}).selectOption('deepseek');
    await page.getByRole('button',{name:'Adicionar modelo'}).click();
    await page.getByRole('textbox',{name:'Nome',exact:true}).nth(3).fill('Apoio');
    await page.getByRole('textbox',{name:'ID do modelo'}).nth(3).fill('openai/test');
    await page.getByRole('combobox',{name:'Modelo principal',exact:true}).selectOption('deepseek/deepseek-flash');
    await page.getByRole('button',{name:'Salvar configuração',exact:true}).click();
    await page.waitForFunction(()=>Boolean((window as any).savedConfig?.models.length===4));
    await page.getByRole('tab',{name:'Decisões do Autopilot'}).click();
    await page.getByRole('heading',{name:'Modelos de decisão do Autopilot'}).waitFor();
    await page.getByRole('combobox',{name:'Modelo de Intent Classifier',exact:true}).selectOption('googleai/gemini-3.1-flash-lite');
    await page.getByRole('spinbutton',{name:'Timeout de Intent Classifier (ms)',exact:true}).fill('3200');
    await page.getByRole('button',{name:'Salvar modelos de decisão'}).click();
    await page.waitForFunction(()=>(window as any).savedDecisions?.intentClassifier.timeoutMs===3200);
    await check('decisions');
    await page.getByRole('tab',{name:'Créditos de IA',exact:true}).click();
    await page.getByRole('heading',{name:'Custos e acréscimos por modelo'}).waitFor();
    await page.getByRole('spinbutton',{name:'Custo de entrada / 1M',exact:true}).first().fill('2');
    await page.getByRole('button',{name:'Salvar configuração',exact:true}).click();
    await page.waitForFunction(()=>(window as any).savedConfig?.models[0].inputCost===2);
    await check('credits');
    await page.getByRole('tab',{name:'Provedores e modelos'}).click();
    if(await page.getByRole('textbox',{name:'Nome',exact:true}).nth(3).inputValue()!=='Apoio')throw new Error('Tab switch lost model changes');
    await page.close();
  }
  await writeFile(path.join(output,'ui-verification.json'),JSON.stringify({viewports:[1440,390],overflow:false,legacyCatalogPreserved:true,allTabsClicked:true,decisionModelAndTimeoutSaved:true,pricingSaved:true,addAndSave:true,backend:'explicit test fixtures'},null,2));
  console.log('Desktop and mobile component checks passed. Test fixtures only.');
}finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
