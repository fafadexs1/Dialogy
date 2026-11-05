'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Boxes, CalendarDays, Database, FileText, GitBranch, Globe2, Mail, MessageCircle, Search, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { listAiAppConnections, disconnectGoogleApp, disconnectOAuthApp } from '@/actions/ai-apps';
import { useCurrentUser } from '@/hooks/use-online-status';
import { ToolMemoryPanel } from './tool-memory-panel';

type GoogleSummary = { id: string; name: string; app: string; access: string };
type ServerSummary = { id: string; name: string; isActive: boolean; toolCount: number; syncedAt: string | null; healthStatus: string };
const apps = [
  { name: 'Google Agenda', category: 'Produtividade', description: 'Consulte disponibilidade e trabalhe com compromissos por meio de ferramentas autorizadas.', icon: CalendarDays, color: 'text-blue-600 bg-blue-50' },
  { name: 'Gmail', category: 'Comunicação', description: 'Consulte mensagens e prepare respostas usando ferramentas disponibilizadas pela conexão.', icon: Mail, color: 'text-red-600 bg-red-50' },
  { name: 'Google Drive', category: 'Conhecimento', description: 'Acesse arquivos e documentos por meio de uma ferramenta compatível.', icon: FileText, color: 'text-emerald-600 bg-emerald-50' },
  { name: 'Google Docs, Sheets e Slides', category: 'Produtividade', description: 'Leia e crie arquivos, atualize intervalos de planilhas e acrescente conteúdo.', icon: FileText, color: 'text-blue-700 bg-blue-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'GitHub', category: 'Desenvolvimento', description: 'Consulte repositórios e trabalhe com ferramentas expostas por um servidor compatível.', icon: GitBranch, color: 'text-slate-800 bg-slate-100' },
  { name: 'Notion', category: 'Conhecimento', description: 'Use páginas e bases de conhecimento disponibilizadas pela conexão.', icon: Boxes, color: 'text-slate-800 bg-slate-100' },
  { name: 'Slack', category: 'Comunicação', description: 'Liste canais e prepare mensagens com operações da biblioteca de conectores.', icon: MessageCircle, color: 'text-violet-700 bg-violet-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Microsoft Outlook, OneDrive e Teams', category: 'Produtividade', description: 'Use operações do Microsoft Graph com uma credencial autorizada.', icon: Mail, color: 'text-blue-700 bg-blue-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Microsoft Word, Excel e PowerPoint', category: 'Documentos', description: 'Envie arquivos ao OneDrive e trabalhe com intervalos de planilhas Excel.', icon: FileText, color: 'text-blue-700 bg-blue-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Trello e Asana', category: 'Projetos', description: 'Consulte quadros e crie cartões ou tarefas usando credenciais configuradas.', icon: Boxes, color: 'text-sky-700 bg-sky-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'GitLab, Linear e Jira', category: 'Desenvolvimento', description: 'Use operações para projetos e issues na biblioteca de conectores.', icon: GitBranch, color: 'text-orange-700 bg-orange-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Google Tasks e Todoist', category: 'Produtividade', description: 'Liste e crie tarefas na biblioteca de conectores.', icon: CalendarDays, color: 'text-red-700 bg-red-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'ClickUp e Discord', category: 'Projetos e comunicação', description: 'Consulte workspaces e prepare tarefas ou mensagens com credencial autorizada.', icon: Boxes, color: 'text-violet-700 bg-violet-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Dropbox e Box', category: 'Arquivos', description: 'Liste arquivos e crie pastas por operações prontas.', icon: FileText, color: 'text-blue-700 bg-blue-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'HubSpot, Salesforce e Pipedrive', category: 'CRM', description: 'Consulte e crie registros usando credenciais configuradas.', icon: Database, color: 'text-orange-700 bg-orange-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Shopify, WooCommerce e Nuvemshop', category: 'E-commerce', description: 'Consulte produtos e configure operações para sua loja.', icon: Boxes, color: 'text-green-700 bg-green-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Zapier, n8n, Make, Vercel e Analytics', category: 'Automação e dados', description: 'Use operações prontas com credencial manual e origem autorizada.', icon: Server, color: 'text-slate-700 bg-slate-100', href: '/nexus', action: 'Abrir automações' },
  { name: 'Google Ads', category: 'Marketing', description: 'Conecte a conta do workspace para consultar métricas de campanhas.', icon: Globe2, color: 'text-blue-700 bg-blue-50', href: '/integrations/gads', action: 'Configurar conta' },
  { name: 'Meta Ads', category: 'Marketing', description: 'Consulte métricas de campanhas com um token de leitura autorizado.', icon: Globe2, color: 'text-indigo-700 bg-indigo-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Stripe, Mercado Pago e Asaas', category: 'Financeiro', description: 'Consulte saldos e cobranças com credenciais de leitura configuradas no cofre.', icon: Database, color: 'text-emerald-700 bg-emerald-50', href: '/nexus', action: 'Abrir automações' },
  { name: 'Postgres e Supabase', category: 'Dados', description: 'Consulte dados usando ferramentas e permissões configuradas no servidor.', icon: Database, color: 'text-teal-700 bg-teal-50' },
  { name: 'WhatsApp Business', category: 'Comunicação', description: 'Configure o canal de atendimento pelo fluxo existente do Dialogy.', icon: MessageCircle, color: 'text-green-700 bg-green-50', href: '/integrations/whatsapp-api' },
  { name: 'Telegram', category: 'Comunicação', description: 'Conecte um bot ao canal de atendimento para conversar com contatos autorizados.', icon: MessageCircle, color: 'text-sky-700 bg-sky-50', href: '/integrations/telegram' },
];

export default function AiAppsPage() {
  const user = useCurrentUser();
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [google, setGoogle] = useState<GoogleSummary[]>([]);
  const [connectedApps, setConnectedApps] = useState<GoogleSummary[]>([]);
  const [access, setAccess] = useState<Record<string, 'read' | 'write'>>({ calendar: 'read', gmail: 'read', drive: 'read', tasks: 'read', docs: 'read', sheets: 'read', slides: 'read', github: 'read', notion: 'read' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const workspaceId = user?.activeWorkspaceId;
  const hasUser = Boolean(user);
  useEffect(() => {
    let current = true;
    if (!workspaceId) { setServers([]); setGoogle([]); setLoading(!hasUser); return () => { current = false; }; }
    setLoading(true); setError(''); setServers([]); setGoogle([]); setConnectedApps([]);
    listAiAppConnections(workspaceId).then((result) => {
      if (!current) return;
      if (result.success) { setServers(result.servers); setGoogle(result.google); setConnectedApps(result.connectedApps); if (result.serverError) setError(result.serverError); }
      else setError(result.error);
    }).catch(() => { if (current) setError('Não foi possível carregar as conexões.'); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, hasUser]);
  useEffect(() => { const params = new URLSearchParams(window.location.search); const status = params.get('google') || params.get('app_oauth'); if (status) setNotice(status === 'conectado' ? 'Conta conectada. Vincule a credencial a um conector ou procedimento para usá-la.' : 'A autorização não foi concluída. Confira as permissões e a configuração do servidor.'); }, []);
  const filtered = useMemo(() => apps.filter((app) => `${app.name} ${app.category} ${app.description}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR').trim())), [query]);
  const active = servers.filter((server) => server.isActive);
  return (
    <main className="min-h-screen bg-[#f6f8f8] px-4 py-8 text-slate-900 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl space-y-8">
        <Link href="/integrations" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-700"><ArrowLeft className="h-4 w-4" /> Todas as integrações</Link>
        <header className="overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-10 sm:py-10">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-2xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-300"><Sparkles className="h-3.5 w-3.5" /> AI Studio</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Aplicativos para seus agentes</h1><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">Conecte ferramentas ao workspace e escolha, em cada procedimento, o que seu agente pode consultar ou executar.</p></div>
            <Link href="/integrations/mcp" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300"><Server className="h-4 w-4" /> Gerenciar servidores MCP <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </header>
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
        <section aria-labelledby="google-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="google-title" className="text-lg font-semibold">Conectar conta Google</h2><p className="mt-1 text-sm text-slate-500">Escolha o serviço e o acesso antes de autorizar. A conexão exige configuração OAuth do servidor e permissões concedidas na sua Conta Google.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">{([{id:'calendar', name:'Google Agenda'}, {id:'gmail', name:'Gmail'}, {id:'drive', name:'Google Drive'}, {id:'tasks', name:'Google Tasks'}, {id:'docs', name:'Google Docs'}, {id:'sheets', name:'Google Sheets'}, {id:'slides', name:'Google Slides'}] as const).map(app => <div key={app.id} className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">{app.name}</h3><label className="block text-xs text-slate-600">Permissão solicitada<select value={access[app.id]} onChange={event => setAccess(previous => ({...previous, [app.id]: event.target.value as 'read' | 'write'}))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="read">Somente leitura</option><option value="write">Leitura e escrita</option></select></label><a href={`/api/integrations/google-workspace/auth?app=${app.id}&access=${access[app.id]}`} className="inline-flex rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Autorizar {app.name}</a>{google.filter(item => item.app === app.id).map(item => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><p className="font-medium">{item.name}</p><button type="button" className="mt-2 text-red-700 underline" onClick={() => { if (!workspaceId || !window.confirm('O Google pode revogar também outros acessos desta conta ao projeto. Deseja desconectar?')) return; void disconnectGoogleApp(workspaceId, item.id).then(result => { if (result.success) { setGoogle(previous => previous.filter(entry => entry.id !== item.id)); setNotice('Conexão revogada no Google. Outros acessos da mesma conta podem precisar de nova autorização.'); } else setError(result.error); }); }}>Revogar acesso</button></div>)}</div>)}</div>
        </section>
        <section aria-labelledby="other-apps-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 id="other-apps-title" className="text-lg font-semibold">Conectar GitHub e Notion</h2><p className="mt-1 text-sm text-slate-500">No GitHub, a autorização repo concedida pelo provedor inclui escrita; a opção somente leitura restringe seu uso no Dialogy. No Notion, as páginas e capacidades disponíveis dependem da autorização do provedor.</p><div className="mt-5 grid gap-4 md:grid-cols-2">{([{id:'github',name:'GitHub'},{id:'notion',name:'Notion'}] as const).map(app => <div key={app.id} className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">{app.name}</h3><label className="block text-xs text-slate-600">Permissão no Dialogy<select value={access[app.id]} onChange={event => setAccess(previous => ({...previous,[app.id]:event.target.value as 'read'|'write'}))} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="read">Somente leitura</option><option value="write">Leitura e escrita</option></select></label><a href={`/api/integrations/app-oauth/${app.id}/auth?access=${access[app.id]}`} className="inline-flex rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Autorizar {app.name}</a>{connectedApps.filter(item=>item.app===app.id).map(item=><div key={item.id} className="rounded-lg bg-slate-50 p-3 text-xs"><p className="font-medium">{item.name}</p><button type="button" className="mt-2 text-red-700 underline" onClick={()=>{if(!workspaceId || !window.confirm(app.id === 'github' ? 'A revogação no GitHub remove todos os tokens deste aplicativo para a mesma conta. Deseja continuar?' : 'Revogar a conexão Notion no provedor?')) return; void disconnectOAuthApp(workspaceId,item.id).then(result=>{if(result.success){setConnectedApps(previous=>previous.filter(entry=>entry.id!==item.id));setNotice('Conexão revogada no provedor.');}else setError(result.error);});}}>Revogar acesso</button></div>)}</div>)}</div></section>
        <section aria-labelledby="connections-title" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="connections-title" className="text-lg font-semibold">Conexões do workspace</h2><p className="mt-1 text-sm text-slate-500">Servidores MCP cadastrados. A disponibilidade de cada ferramenta depende da sincronização e da configuração do agente.</p></div><Link href="/integrations/mcp" className="text-sm font-semibold text-emerald-700 hover:underline">Gerenciar conexões →</Link></div>
          {loading ? <p className="mt-6 text-sm text-slate-500">Carregando conexões…</p> : error ? <p role="alert" className="mt-6 text-sm text-amber-700">{error}</p> : !workspaceId ? <p className="mt-6 text-sm text-slate-500">Selecione um workspace para consultar suas conexões.</p> : servers.length === 0 ? <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">Nenhum servidor MCP cadastrado. Adicione um servidor compatível e sincronize suas ferramentas para usá-las no Studio.</div> : <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{servers.map((server) => <div key={server.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{server.name}</p><p className="mt-1 text-xs text-slate-500">{server.toolCount} ferramenta(s) sincronizada(s)</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${server.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{server.isActive ? 'Ativo' : 'Inativo'}</span></div>)}</div>}
          {!loading && !error && active.length > 0 && <p className="mt-4 text-xs text-slate-500">Servidor ativo não garante disponibilidade do serviço externo. Teste e revise as ferramentas antes de publicar.</p>}
        </section>
        <section aria-labelledby="catalog-title" className="space-y-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Explore possibilidades</p><h2 id="catalog-title" className="mt-1 text-2xl font-semibold tracking-tight">Aplicativos e serviços</h2><p className="mt-1 text-sm text-slate-500">Exemplos de serviços que podem ser integrados por MCP ou por uma API configurada no procedimento.</p></div><label className="relative block w-full sm:w-72"><span className="sr-only">Buscar aplicativos</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aplicativo" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label></div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((app) => { const Icon = app.icon; return <article key={app.name} className="flex min-h-48 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><span className={`rounded-xl p-3 ${app.color}`}><Icon className="h-5 w-5" /></span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{app.category}</span></div><h3 className="mt-4 font-semibold">{app.name}</h3><p className="mt-1 flex-1 text-sm leading-6 text-slate-500">{app.description}</p><Link href={app.href || '/integrations/mcp'} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">{'action' in app && app.action ? app.action : app.href ? 'Configurar canal' : 'Configurar via MCP'} <ArrowRight className="h-3.5 w-3.5" /></Link></article>; })}</div>
          {filtered.length === 0 && <p className="rounded-xl bg-white p-6 text-sm text-slate-500">Nenhum aplicativo corresponde à busca.</p>}
        </section>
        <ToolMemoryPanel workspaceId={workspaceId} />
        <aside className="grid gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-6 text-sm text-slate-700 md:grid-cols-2"><div className="flex gap-3"><Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><p><strong>Como funciona</strong><br />Os cartões são exemplos, não conexões prontas. Para usá-los, forneça um servidor MCP compatível ou configure uma conexão HTTP no procedimento. Para os aplicativos Google listados acima, GitHub e Notion, autorize o acesso acima. Os demais serviços podem usar credenciais já autorizadas no procedimento.</p></div><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><p><strong>Controle no Studio</strong><br />Revise os acessos concedidos no serviço externo, os dados enviados e os resultados mapeados em cada etapa antes de publicar o agente.</p></div></aside>
      </div>
    </main>
  );
}


