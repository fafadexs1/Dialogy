import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import theme from '../tailwind.config';

// Actual Inbox components and Zustand store. Only network/session boundaries are fixtures.
// This verifies presentation and local interactions, never message delivery or production data.
const output = path.resolve('design-qa/inbox-premium');
const fixtures: Record<string, string> = {
  'next/image': `import React from 'react';export default function Image({fill,priority,unoptimized,loader,quality,...props}){return <img {...props}/>}`,
  'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>} `,
  'next/navigation': `export const useRouter=()=>({push(){},replace(){},refresh(){},prefetch(){}});export const usePathname=()=>'/inbox';export const useSearchParams=()=>new URLSearchParams();`,
  '@/providers/theme-provider': `export const useTheme=()=>({resolvedTheme:document.documentElement.classList.contains('dark')?'dark':'light'});`,
  '@/hooks/use-online-status': `export const usePresence=()=>({onlineAgents:[],isOffline:false,connectionStatus:'connected'});export const useCurrentUser=()=>null;`,
  '@/lib/supabase/client': `const chain=new Proxy(function(){return chain},{get:(_,k)=>k==='then'?undefined:()=>chain});export const createClient=()=>({channel:()=>chain,removeChannel(){},from:()=>chain,auth:{getSession:async()=>({data:{session:null}})}});`,
  '@/lib/supabase/storage': `export const uploadFileToStorage=async()=>({success:false,error:'QA does not upload files'});`,
  '@/providers/auth-provider': `export const useAuth=()=>({user:null,session:null,isLoading:false});`,
  '@/i18n/i18n-provider': `export const useI18n=()=>({t:s=>s,locale:'pt-BR'});`,
};
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import ChatList from './src/components/chat/chat-list';import ChatPanel from './src/components/chat/chat-panel';
import ContactPanel from './src/components/chat/contact-panel';
import {useInboxStore} from './src/hooks/use-inbox-store';
import {TooltipProvider} from './src/components/ui/tooltip';
const user={id:'qa-user',name:'Marina Costa',activeWorkspaceId:'qa-workspace',activeWorkspaceTimezone:'America/Sao_Paulo',role:{name:'Owner',permissions:[]},workspaces:[],permissions:[]};
const names=['Laura Martins','Pedro Albuquerque','Estúdio Aurora','Ana Carolina Santos','Rafael Oliveira','Beatriz Lima','Carlos Souza','Mariana Ribeiro'];
const contents=['Consigo ajustar o horário da instalação?','Perfeito, muito obrigado pela atenção!','Quero conhecer melhor os planos para minha empresa.','Você consegue me ajudar com a segunda via?','Podemos seguir com essa opção.','Adorei! Vou conversar com minha equipe.','Quero saber mais sobre a instalação.','Obrigada pelo retorno, Marina.'];
const now=Date.now();
const chats=names.map((name,i)=>({id:'qa-chat-'+i,workspace_id:'qa-workspace',status:i>5?'gerais':'atendimentos',agentId:i>5?null:user.id,agent:i>5?null:user,contact:{id:'qa-contact-'+i,name,phone:'556199999000'+i,avatar_url:null},platform:'whatsapp',instance_name:'qa-channel',teamName:'Relacionamento',team_id:'qa-team',createdAt:new Date(now-3600000).toISOString(),updatedAt:new Date(now-i*120000).toISOString(),unreadCount:i%3===0?2:0,tags:[],messages:[{id:'qa-last-'+i,content:contents[i],type:'text',from_me:i%2!==0,sender:i%2!==0?user:{name},createdAt:new Date(now-i*120000).toISOString(),timestamp:new Date(now-i*120000).toISOString(),status:'read'}]}));
const messages=[{content:'Olá, Marina! Tudo bem? Gostaria de saber sobre a instalação aqui na empresa.',from_me:false},{content:'Oi, Laura! Tudo ótimo. Vamos cuidar disso juntos. Você já tem um horário em mente?',from_me:true},{content:'Se fosse possível na parte da manhã seria perfeito. Nosso time chega às 9h.',from_me:false},{content:'Perfeito! Vou conferir a disponibilidade com a nossa equipe e já te retorno por aqui.',from_me:true},{content:contents[0],from_me:false}].map((m,i)=>({...m,id:'qa-message-'+i,chat_id:chats[0].id,type:'text',sender:m.from_me?user:chats[0].contact,status:'read',createdAt:new Date(now-(6-i)*60000).toISOString(),timestamp:new Date(now-(6-i)*60000).toISOString()}));
useInboxStore.setState({chats,messagesByChat:{[chats[0].id]:messages},inboxCounts:{robo:0,gerais:2,atendimentos:6,encerrados:0},hasMoreChats:false});
window.qaStore=useInboxStore;
function App(){const [chat,setChat]=useState(null);const [context,setContext]=useState(false);const mobile=innerWidth<768;return <TooltipProvider><div style={{display:'flex',height:'100dvh',width:'100%',overflow:'hidden'}}>{(!mobile||!chat)&&<ChatList chats={chats} selectedChat={chat} setSelectedChat={setChat} currentUser={user} onUpdate={()=>{}}/>}{(!mobile||chat)&&<ChatPanel chat={chat} currentUser={user} onActionSuccess={()=>{}} closeReasons={[]} showFullHistory={false} setShowFullHistory={()=>{}} tabId="qa" workspaceTimezone="America/Sao_Paulo" onToggleContactPanel={()=>setContext(!context)} onBack={()=>setChat(null)}/ >}{context&&chat&&<div style={{width:360,flexShrink:0}}><ContactPanel chat={chat} currentUser={user} onActionSuccess={()=>{}} closeReasons={[]} presentation="canvas" onRequestClose={()=>setContext(false)}/></div>}</div></TooltipProvider>};createRoot(document.getElementById('root')).render(<App/>);
`;

async function main() {
  await mkdir(output, { recursive: true });
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
    outdir: 'qa-bundle', platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: 'tsconfig.json',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'network-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(next\/|@\/(actions\/|plugins\/.*actions|lib\/supabase\/|hooks\/use-online-status|providers\/|i18n\/))/ }, args => {
        if (fixtures[args.path]) return { path: args.path, namespace: 'fixture' };
        if (/^@\/(actions\/|plugins\/.*actions)/.test(args.path)) return { path: args.path + '::' + args.importer, namespace: 'action' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'jsx', resolveDir: process.cwd() }));
      builder.onLoad({ filter: /.*/, namespace: 'action' }, async args => {
        const [module, importer] = args.path.split('::');
        const source = ts.createSourceFile(importer, await readFile(importer, 'utf8'), ts.ScriptTarget.Latest, true);
        const names = new Set<string>();
        const targetPath = path.resolve('src', module.slice(2) + '.ts');
        const target = ts.createSourceFile(targetPath, await readFile(targetPath, 'utf8'), ts.ScriptTarget.Latest, true);
        target.forEachChild(node => {
          if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) names.add(node.name.text);
        });
        source.forEachChild(node => {
          if (ts.isImportDeclaration(node) && (node.moduleSpecifier as ts.StringLiteral).text === module) {
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach(binding => { if (!binding.isTypeOnly) names.add((binding.propertyName || binding.name).text); });
          }
        });
        const value = `{success:true,tags:[],teams:[],users:[],agents:[],shortcuts:[],instances:[],data:[],config:null,messages:[],integrations:[],fields:[],contracts:[],suggestion:null,contacts:[]}`;
        return { contents: [...names].map(name => `export async function ${name}(){return ${value};}`).join('\n'), loader: 'js' };
      });
    } }],
  });
  const compiled = (await postcss([tailwind({ ...theme, content: ['./src/components/{chat,ui,layout,team}/**/*.{ts,tsx}'] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })).css;
  const css = compiled + result.outputFiles.filter(f => f.path.endsWith('.css')).map(f => f.text).join('\n') + await readFile('src/app/inbox/inbox-premium.css', 'utf8');
  const js = result.outputFiles.find(f => f.path.endsWith('.js'))!.text;
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const checks: unknown[] = [];
  try {
    for (const color of ['light', 'dark']) for (const width of [1440, 1024, 768, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: width > 767 ? 900 : 844 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => { errors.push(error.message); console.error('Browser:', error.message); });
      await page.route('**/*', route => route.abort());
      await page.setContent('<html lang="pt-BR" class="'+color+' inbox-'+color+'"><head><style>body{margin:0;font-family:Arial,sans-serif}'+css+'</style></head><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: 'window.process={env:{},platform:"browser"};'+js });
      await expect(page.getByRole('tab', { name: /^Atendendo:/ })).toBeVisible();
      await page.getByRole('tab', { name: /^Atendendo:/ }).click();
      await page.keyboard.press('End');
      await expect(page.getByRole('tab', { name: /^Encerrados:/ })).toBeFocused();
      await page.keyboard.press('Home');
      await expect(page.getByRole('tab', { name: /^Robô:/ })).toBeFocused();
      await page.getByRole('tab', { name: /^Atendendo:/ }).click();
      await expect(page.getByRole('option', { name: /Laura Martins/ })).toBeVisible();
      await page.getByRole('button', { name: 'Não lidas', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Não lidas', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('option', { name: /Estúdio Aurora/ })).toHaveCount(0);
      await page.getByRole('button', { name: 'Não lidas', exact: true }).click();
      await expect(page.getByRole('option', { name: /Estúdio Aurora/ })).toBeVisible();
      if (width < 768) await page.screenshot({ path: path.join(output, `${color}-list-${width}.png`) });
      if (width > 767) {
        await page.screenshot({ path: path.join(output, `${color}-welcome-${width}.png`) });
        await page.getByRole('button', { name: 'Encontrar uma conversa' }).click();
        await expect(page.getByRole('textbox', { name: 'Pesquisar conversas' })).toBeFocused();
      }
      await page.getByRole('textbox', { name: 'Pesquisar conversas' }).fill('Laura');
      await expect(page.getByRole('option')).toHaveCount(1);
      await page.getByRole('textbox', { name: 'Pesquisar conversas' }).fill('');
      await expect(page.getByRole('option', { name: /Pedro Albuquerque/ })).toBeVisible();
      await page.getByRole('option', { name: /Laura Martins/ }).click();
      await expect(page.locator('[data-message-bubble]')).toHaveCount(5);
      await expect(page.locator('[data-message-bubble]').last()).toBeInViewport();
      await expect(page.locator('[data-message-bubble]').last()).toBeVisible();
      await expect(page.locator('[data-input-container]')).toBeVisible();
      await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Vou conferir a disponibilidade para você.');
      await expect(page.getByRole('button', { name: 'Enviar mensagem', exact: true })).toBeEnabled();
      await expect.poll(() => page.evaluate(() => (window as unknown as { qaStore: { getState: () => { drafts: Record<string, string> } } }).qaStore.getState().drafts['qa-chat-0'])).toContain('Vou conferir');
      await page.getByRole('button', { name: 'Anexos e ferramentas', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: /Nota interna/ }).click();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-input-container]')).toHaveAttribute('data-note', 'true');
      await page.getByRole('button', { name: 'Sair da nota interna', exact: true }).click();
      await expect(page.locator('[data-input-container]')).toHaveAttribute('data-note', 'false');
      const dimensions = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, height: innerHeight, actualHeight: document.documentElement.scrollHeight }));
      if (dimensions.actual > width || dimensions.actualHeight > dimensions.height) throw Error('Overflow: '+JSON.stringify(dimensions));
      await page.screenshot({ path: path.join(output, `${color}-conversation-${width}.png`) });
      if (width === 1440) {
        await page.getByRole('button', { name: 'Ver contexto do contato', exact: true }).click();
        await expect(page.locator('.inbox-contact-panel')).toBeVisible();
        await page.screenshot({ path: path.join(output, `${color}-context-${width}.png`) });
      }
      if (width < 768) {
        await page.getByRole('button', { name: 'Voltar às conversas', exact: true }).click();
        await expect(page.getByRole('tab', { name: /^Atendendo:/ })).toBeVisible();
      }
      checks.push({ color, ...dimensions, search: true, conversation: true });
      await page.close();
    }
    if (errors.length) throw Error(errors.join('\n'));
    await writeFile(path.join(output, 'checks.json'), JSON.stringify({ checks, errors, scope: 'Actual UI; fixture network and session. Does not verify authenticated runtime or delivery.' }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, errors }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
