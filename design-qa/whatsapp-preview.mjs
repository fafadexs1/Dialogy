// Runs the real WhatsApp page with isolated demo accounts. No live messages or Meta submissions.
import { context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';

const out = resolve('scratch/whatsapp-preview');
mkdirSync(out, { recursive: true });
const fixtures = `
import { createStudioDraft, createStudioCard } from '@/lib/whatsapp/studio';
const workspace = '10000000-0000-4000-8000-000000000001';
const user = { id: '10000000-0000-4000-8000-000000000010', name: 'Marina', activeWorkspaceId: workspace };
const instances = [
 { id: '20000000-0000-4000-8000-000000000001', display_name: 'Atendimento Dialogy', instance_name: 'dialogy-atendimento', display_phone_number: '+55 11 99999-0101', type: 'baileys', cluster_id: 'demo', webhook_url: 'https://dialogy.example/api/whatsapp/webhook', webhook_needs_sync: false },
 { id: '20000000-0000-4000-8000-000000000002', display_name: 'Comercial · Oficial', instance_name: 'dialogy-comercial', display_phone_number: '+55 11 99999-0202', type: 'wa_cloud', cluster_id: 'demo', verified_name: 'Dialogy', waba_name: 'Dialogy Studio', webhook_needs_sync: false },
];
const status = { 'dialogy-atendimento': 'connected', 'dialogy-comercial': 'connected' };
const sample = createStudioDraft('carousel');
sample.title = 'Um jeito mais próximo de atender'; sample.templateName = 'um_jeito_mais_proximo';
sample.body = 'Boas conversas aproximam pessoas. Conheça duas formas de cuidar melhor de cada encontro com a Dialogy.';
sample.cards = sample.cards.map((card, index) => ({ ...card, title: index ? 'Tempo para o que importa' : 'Cada conversa, um cuidado', body: index ? 'Organize o trabalho e crie fluxos que acompanham sua equipe.' : 'Reúna seu atendimento em um espaço simples, bonito e acolhedor.', imageKey: 'workspaces/' + workspace + '/whatsapp-studio/30000000-0000-4000-8000-00000000000' + (index + 1) + '.jpg', buttons: [{ id: 'button-' + index, type: 'reply', text: index ? 'Quero conhecer' : 'Vamos conversar', value: '' }] }));
const reminder = createStudioDraft(); reminder.title = 'Um lembrete com carinho'; reminder.templateName = 'um_lembrete_com_carinho'; reminder.body = 'Olá {{1}}! Passando para lembrar do seu atendimento {{2}}. Vai ser um prazer receber você.'; reminder.examples = { '1': 'Marina', '2': 'amanhã, às 14h' }; reminder.variableLabels = { '1': 'Nome da pessoa', '2': 'Data e horário' }; reminder.buttons = [{ id: 'confirm', type: 'reply', text: 'Confirmar presença', value: '' }];
let entries = JSON.parse(localStorage.getItem('dialogy-whatsapp-preview-v1') || 'null') || [
 { id:'40000000-0000-4000-8000-000000000001', instance_id: instances[0].id, title: sample.title, draft: sample, revision: 1, provider_name: null, updated_at: '2026-10-26T14:00:00.000Z' },
 { id:'40000000-0000-4000-8000-000000000002', instance_id: instances[0].id, title: reminder.title, draft: reminder, revision: 1, provider_name: null, updated_at: '2026-10-25T14:00:00.000Z' }
];
const templates = [
 { id:'123456789', name:'pedido_confirmado', language:'pt_BR', category:'UTILITY', status:'APPROVED', components:[{type:'BODY',text:'Olá {{1}}! Seu pedido {{2}} foi confirmado. Obrigado por escolher a gente.',example:{body_text:[['Marina','12345']]}}] },
 { id:'123456790', name:'novidades_da_semana', language:'pt_BR', category:'MARKETING', status:'PENDING', components:[{type:'BODY',text:'Tem novidade por aqui! Preparamos uma seleção especial para você conhecer.'}] },
 { id:'123456791', name:'lembrete_de_atendimento', language:'pt_BR', category:'UTILITY', status:'APPROVED', components:[{type:'BODY',text:'Olá {{1}}! Seu atendimento é amanhã às {{2}}. Podemos confirmar sua presença?',example:{body_text:[['Marina','14h']]}}] }
];
function persist() { localStorage.setItem('dialogy-whatsapp-preview-v1', JSON.stringify(entries)); }
export const useCurrentUser = () => user;
export const useToast = () => ({ toast });
export function toast({ title, description }) { const element = document.createElement('div'); element.setAttribute('role', 'status'); element.style.cssText = 'position:fixed;bottom:22px;right:22px;max-width:350px;background:#284d3f;color:#fff;padding:18px 22px;border-radius:13px;z-index:99999;font:12px/1.8 Inter,sans-serif;box-shadow:0 8px 30px #0002'; element.textContent = title + (description ? ' · ' + description : ''); document.body.append(element); setTimeout(() => element.remove(), 4500); }
export function createClient() { return { auth: { getUser: async () => ({data:{user}}) } }; }
export async function getEvolutionApiInstances() { return {instances:[...instances], canManageWebhooks:!location.search.includes('viewer'), limitStatus:{reached:false,current:instances.length,max:5,plan:'Profissional'}}; }
export async function checkInstanceStatus(name) { return {status:status[name] || 'pending'}; }
export async function connectInstance(name) { status[name]='pending'; return {status:'pending'}; }
export async function disconnectInstance(name) { status[name]='disconnected'; return {status:'disconnected'}; }
export async function restartInstance() { return {success:true}; }
export async function deleteEvolutionApiInstance(id) { const i=instances.findIndex(item=>item.id===id); if(i>=0)instances.splice(i,1); return {success:true}; }
export async function createEvolutionApiInstance(payload) { const instance={...instances[0],id:crypto.randomUUID(),display_name:payload.displayName,instance_name:payload.displayName.toLowerCase().replaceAll(' ','-'),type:payload.integration==='WHATSAPP-BUSINESS'?'wa_cloud':'baileys'};instances.push(instance);return {success:true,instanceId:instance.id}; }
export async function getInstanceSettings() { return {settings:{rejectCall:false,groupsIgnore:false,alwaysOnline:false,readMessages:true,readStatus:false,syncFullHistory:false}}; }
export async function updateInstanceSettings() { return {success:true}; }
export async function reconfigureEvolutionWebhook() { return {success:true,webhookUrl:'https://dialogy.example/api/whatsapp/webhook',webhookConfigured:true}; }
export async function exchangeMetaAuthCode() { return {success:false,error:'A prévia não acessa contas Meta.'}; }
export async function findWhatsappTemplates() { return {templates}; }
export async function createWhatsappTemplate() { return {success:true}; }
export async function getWhatsappStudioLibrary() { return {success:true,entries:structuredClone(entries)}; }
export async function getWhatsappStudioTemplates() { return {success:true,templates:structuredClone(templates)}; }
export async function saveWhatsappStudioDraft(input) { const previous=entries.find(e=>e.id===input.id); if(previous && input.revision!==previous.revision)return {success:false,error:'A criação foi alterada em outra sessão.'}; const entry={id:input.id||crypto.randomUUID(),instance_id:input.instanceId,title:input.draft.title,draft:structuredClone(input.draft),revision:(previous?.revision||0)+1,provider_name:previous?.provider_name||null,updated_at:new Date().toISOString()}; entries=[entry,...entries.filter(e=>e.id!==entry.id)];persist();return {success:true,entry:structuredClone(entry)}; }
export async function deleteWhatsappStudioDraft(ws,id) {entries=entries.filter(e=>e.id!==id);persist();return {success:true};}
export async function uploadWhatsappStudioImage(ws,form) { const file=form.get('file');const key='workspaces/'+workspace+'/whatsapp-studio/'+crypto.randomUUID()+'.jpg'; window.__previewImages ||= new Map(); window.__previewImages.set(key,URL.createObjectURL(file));return {success:true,key}; }
export async function publishWhatsappStudioTemplate(ws,id) {const entry=entries.find(e=>e.id===id);entry.provider_name=entry.draft.templateName;templates.push({name:entry.provider_name,language:entry.draft.language,status:'PENDING',category:entry.draft.category,components:[{type:'BODY',text:entry.draft.body}]});persist();return {success:true,name:entry.provider_name};}
export async function sendWhatsappStudioTest() {return {success:true};}
export async function editWhatsappMetaTemplate(input) { const item=templates.find(x=>x.id===input.templateId);if(!item)return {success:false,error:'Template indisponível.'};for(const [key,value] of Object.entries(input.updates)){const path=key.split('.');let target=item.components;for(const part of path.slice(0,-1))target=target[part];target[path.at(-1)]=value;}item.status='PENDING';return {success:true}; }
`;
const ctx = await context({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Whatsapp from './src/app/integrations/whatsapp-api/whatsapp-api-page-client'; if(location.search.includes('dark'))document.documentElement.className='dark';createRoot(document.getElementById('root')).render(<Whatsapp/>);`, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, outfile: resolve(out, 'app.js'), jsx: 'automatic', loader: { '.css': 'local-css' }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'demo-only', setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'preview-link' }));
    build.onLoad({ filter: /.*/, namespace: 'preview-link' }, () => ({ contents: `import React from 'react';export default function Link({href,children,prefetch,...props}){return <a {...props} href={'http://localhost:9002'+href}>{children}</a>}`, loader: 'jsx', resolveDir: process.cwd() }));
    build.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'preview-image' }));
    build.onLoad({ filter: /.*/, namespace: 'preview-image' }, () => ({ contents: `import React from 'react';export default function Image({src,unoptimized,priority,fill,...props}){if(src.startsWith('/api/storage/object')){const key=new URL(src,location.origin).searchParams.get('key');src=window.__previewImages?.get(key)||('/demo-image-'+(key.endsWith('2.jpg')?'2':'1')+'.jpg');}return <img {...props} src={src}/>}`, loader: 'jsx', resolveDir: process.cwd() }));
    build.onResolve({ filter: /^@\/(actions\/(evolution-api|meta-auth|whatsapp-studio)|hooks\/(use-online-status|use-toast)|lib\/supabase\/client)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixtures, loader: 'jsx', resolveDir: process.cwd() }));
  } }],
});
await ctx.rebuild();
await ctx.watch();
const css = readFileSync('src/app/globals.css', 'utf8').replace(/^@import[^;]+;/gm, '');
const config = (await import('../tailwind.config.ts')).default;
const compiled = await postcss([tailwindcss({ content: ['./src/app/integrations/{whatsapp-api,evolution-api}/**/*.tsx', './src/components/integrations/whatsapp-studio/**/*.tsx', './src/components/ui/**/*.{ts,tsx}'], theme: config.theme, plugins: config.plugins })]).process(css, { from: undefined });
writeFileSync(resolve(out, 'tailwind.css'), compiled.css);
writeFileSync(resolve(out, 'index.html'), `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1" /><meta charset="utf-8" /><title>Dialogy · WhatsApp API · Prévia local</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/tailwind.css" /><link rel="stylesheet" href="/app.css" /><style>html,body{overflow-x:clip;overflow-y:visible}body{margin:0;font-family:Inter,sans-serif;background:#f7f6f1}#root{min-height:100vh}.dark body{background:#171c19}button,input{font:inherit}.demo-banner{padding:7px 18px;font:10px/1.5 Inter,sans-serif;text-align:center;color:#6e766e;background:#eaece5;border-bottom:1px solid #d9ded4}.dark .demo-banner{color:#b9c5b9;background:#202a23;border-color:#354238}</style></head><body><div class="demo-banner">PRÉVIA LOCAL · Dados de demonstração · Nenhuma mensagem é enviada e nenhum template é publicado</div><div id="root"></div><script src="/app.js"></script></body></html>`);
const pictures = await Promise.all(['public/landing-hero-inbox-dark.webp', 'public/landing-flow-visual.webp'].map(path => sharp(readFileSync(path)).jpeg({ quality: 85 }).toBuffer()));
createServer((req, res) => {
  const name = (req.url || '/').split('?')[0];
  if (name === '/demo-image-1.jpg' || name === '/demo-image-2.jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(pictures[name.includes('-2') ? 1 : 0]); return; }
  if (name === '/mobile') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>Dialogy · WhatsApp no celular</title><style>body{margin:0;background:#deddd6;display:flex;justify-content:center}iframe{width:390px;height:2200px;border:0}</style><iframe title="WhatsApp API no celular" src="/whatsapp-api' + ((req.url || '').includes('dark') ? '?dark' : '') + '"></iframe>'); return; }
  const file = { '/': 'index.html', '/whatsapp-api': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css', '/tailwind.css': 'tailwind.css' }[name];
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'); res.end(readFileSync(resolve(out, file)));
}).listen(9052, '127.0.0.1', () => console.log('WhatsApp visual QA (demo only): http://127.0.0.1:9052/whatsapp-api'));
