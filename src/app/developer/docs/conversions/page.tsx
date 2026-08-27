import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Database,
  ExternalLink,
  Fingerprint,
  Layers,
  Link2,
  Lock,
  MessageSquare,
  MousePointerClick,
  Send,
  Sparkles,
  Target,
  Workflow,
  Zap,
} from 'lucide-react';

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export async function generateMetadata() {
  return buildPageMetadata({ pathname: '/developer/docs/conversions' });
}

const funnelStages = [
  {
    step: '1',
    event: 'whatsapp_message_received',
    name: 'Mensagem WhatsApp Recebida',
    type: 'Secundária / Topo de Funil',
    view: 'google_ads_whatsapp_message',
    value: 'R$ 1,00 (Fixo)',
    why: 'Dispara no exato momento em que o lead envia a primeira mensagem no WhatsApp com o código de rastreio.',
    objective: 'Ensina o Google Ads a buscar volume de contatos.',
    color: 'border-blue-500/30 bg-blue-500/5 text-blue-400',
  },
  {
    step: '2',
    event: 'lead_qualificado',
    name: 'Lead Qualificado',
    type: 'Meio de Funil',
    view: 'google_ads_lead_qualified',
    value: 'R$ 1,00 (Fixo)',
    why: 'Dispara quando o lead avança do primeiro estágio no pipeline/funil do CRM (demonstrou interesse real).',
    objective: 'Filtra curiosos e ensina o algoritmo a buscar pessoas com perfil de compra.',
    color: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
  },
  {
    step: '3',
    event: 'sale_won / cliente_instalado',
    name: 'Cliente Instalado / Venda Fechada',
    type: 'Primária / Fundo de Funil (Foco ROAS)',
    view: 'google_ads_cliente_instalado',
    value: 'Valor Real do Negócio (ex: R$ 4.800,00)',
    why: 'Dispara quando o negócio é marcado como Ganho ou o cliente é ativado no CRM.',
    objective: 'O sinal mais valioso: ensina o Smart Bidding a buscar receita e maximizar o retorno (ROAS).',
    color: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
  },
];

const dataManagerMapping = [
  { source: 'conversion_time', google: 'Data/hora da conversão', type: 'Data e hora com fuso (RFC 3339)' },
  { source: 'transaction_id', google: 'ID da transação', type: 'String (Identificador Único)' },
  { source: 'event_source', google: 'Origem do evento', type: 'String ("CRM")' },
  { source: 'gclid', google: 'GCLID', type: 'String (Google Click ID)' },
  { source: 'gbraid / wbraid', google: 'GBRAID / WBRAID', type: 'String (Identificadores iOS)' },
  { source: 'conversion_value', google: 'Valor da conversão', type: 'Numérico (Valor em R$)' },
  { source: 'currency', google: 'Código da moeda', type: 'String ("BRL")' },
  { source: 'contact_phone', google: 'Telefone (Enhanced Conversions)', type: 'E.164 (+55...)' },
  { source: 'contact_email', google: 'E-mail (Enhanced Conversions)', type: 'Texto normal / Minúsculas' },
];

export default function ConversionsTutorialPage() {
  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
      <StoredSeoJsonLd pathname="/developer/docs/conversions" />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#030712]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <DeveloperBrand />
            <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
              <Link href="/developer/docs" className="text-white/60 transition-colors hover:text-white">
                Documentação
              </Link>
              <Link href="/developer/docs/google-ads-whatsapp" className="text-white/60 transition-colors hover:text-white">
                Google Ads + WhatsApp
              </Link>
              <span className="text-blue-400 font-semibold">Tutorial de Conversões</span>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild size="sm" variant="outline" className="border-white/10 bg-white/5 hover:bg-white/10">
              <Link href="/integrations/gads">
                <Target className="mr-2 h-4 w-4 text-amber-400" />
                Painel Google Ads
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        {/* Breadcrumb */}
        <div className="mb-8 flex items-center gap-2 text-sm text-white/50">
          <Link href="/developer/docs" className="hover:text-white">Docs</Link>
          <span>/</span>
          <span className="text-white">Tutorial de Conversões Offline</span>
        </div>

        {/* Hero */}
        <div className="mb-12 rounded-3xl border border-white/10 bg-gradient-to-b from-blue-500/10 via-white/[0.02] to-transparent p-8 md:p-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 mb-6">
            <Sparkles className="h-3.5 w-3.5" />
            Guia Prático Passo a Passo
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-5xl text-white mb-6">
            Como Registrar e Atribuir Conversões Offline no Dialogy
          </h1>
          <p className="max-w-3xl text-lg text-white/70 leading-relaxed mb-8">
            Aprenda a fechar o ciclo completo: do clique no anúncio do Google Ads à conversa no WhatsApp, 
            avanço no CRM e devolução do valor real da venda para otimização do algoritmo de <strong>Smart Bidding</strong>.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400 font-bold">
                1
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Rastreio Sem Perdas</p>
                <p className="text-xs text-white/50">GCLID, GBRAID e WBRAID</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400 font-bold">
                2
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Funil em 3 Etapas</p>
                <p className="text-xs text-white/50">Mensagem, Lead e Venda</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 font-bold">
                3
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Google Data Manager</p>
                <p className="text-xs text-white/50">API e Views PostgreSQL</p>
              </div>
            </div>
          </div>
        </div>

        {/* Funnel Concept */}
        <section className="mb-16">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Layers className="h-6 w-6 text-blue-400" />
              1. As 3 Etapas do Funil de Conversão
            </h2>
            <p className="text-white/60 mt-1">
              Para não viciar o Google em apenas gerar volume de mensagens rasas, dividimos as conversões por maturidade:
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {funnelStages.map((stage) => (
              <Card key={stage.step} className={`border ${stage.color} bg-black/40 backdrop-blur-md`}>
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-xs font-mono">
                      Etapa {stage.step}
                    </Badge>
                    <span className="text-xs text-white/50">{stage.type}</span>
                  </div>
                  <CardTitle className="text-lg text-white">{stage.name}</CardTitle>
                  <CardDescription className="text-xs text-white/60 font-mono">
                    Evento: {stage.event}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-white/70">
                  <p>{stage.why}</p>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/40 mb-1">Valor atribuído:</div>
                    <div className="font-semibold text-white">{stage.value}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/40 mb-1">View do Data Manager:</div>
                    <div className="font-mono text-xs text-blue-300">public.{stage.view}</div>
                  </div>
                  <p className="text-xs text-white/50 italic">{stage.objective}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Tabbed Tutorials */}
        <section className="mb-16">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Workflow className="h-6 w-6 text-amber-400" />
              2. Como Configurar no Dialogy e no Google Ads
            </h2>
            <p className="text-white/60 mt-1">
              Escolha abaixo o guia de configuração correspondente à sua necessidade:
            </p>
          </div>

          <Tabs defaultValue="google-data-manager" className="w-full">
            <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 bg-white/5 border border-white/10 p-1 rounded-2xl h-auto">
              <TabsTrigger value="google-data-manager" className="rounded-xl py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                <Database className="mr-2 h-4 w-4" />
                Google Data Manager (PostgreSQL)
              </TabsTrigger>
              <TabsTrigger value="crm-workflow" className="rounded-xl py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                <CircleDollarSign className="mr-2 h-4 w-4" />
                Disparo de Vendas no CRM
              </TabsTrigger>
              <TabsTrigger value="tracking-link" className="rounded-xl py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                <Link2 className="mr-2 h-4 w-4" />
                Link de Rastreamento (GCLID)
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: Data Manager */}
            <TabsContent value="google-data-manager" className="mt-6 space-y-6">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader>
                  <CardTitle className="text-xl text-white flex items-center gap-2">
                    <Database className="h-5 w-5 text-blue-400" />
                    Passo a Passo no Google Data Manager
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    Como conectar o PostgreSQL do Dialogy diretamente ao Google Ads para sincronização automática de conversões.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm">
                        1
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">Criar Nova Conexão no Data Manager</h4>
                        <p className="text-sm text-white/60 mt-1">
                          No Google Ads, acesse <strong>Ferramentas → Data Manager</strong> e clique em <strong>Conectar uma origem</strong>. Escolha <strong>PostgreSQL</strong> ou <strong>Banco de dados conectado</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm">
                        2
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">Selecionar a Tabela / View</h4>
                        <p className="text-sm text-white/60 mt-1">
                          No Schema selecione <strong>`public`</strong> e na Tabela escolha a view do evento desejado:
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-white/70">
                          <li>• Para clientes convertidos: <code className="text-emerald-400 font-mono">google_ads_cliente_instalado</code></li>
                          <li>• Para leads qualificados: <code className="text-amber-400 font-mono">google_ads_lead_qualified</code></li>
                          <li>• Para primeira mensagem: <code className="text-blue-400 font-mono">google_ads_whatsapp_message</code></li>
                        </ul>
                        <div className="mt-2 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/70">
                          <strong>Filtro recomendado no Data Manager:</strong> <code>workspace_id igual a SEU_WORKSPACE_ID</code>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm">
                        3
                      </div>
                      <div className="w-full">
                        <h4 className="font-semibold text-white mb-2">Mapeamento de Campos (De/Para)</h4>
                        <div className="overflow-x-auto rounded-xl border border-white/10">
                          <table className="w-full text-left text-sm">
                            <thead className="border-b border-white/10 bg-white/5 text-xs text-white/50 uppercase">
                              <tr>
                                <th className="p-3">Campo da View (PostgreSQL)</th>
                                <th className="p-3">Campo do Google Ads</th>
                                <th className="p-3">Tipo / Transformação</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-white/80">
                              {dataManagerMapping.map((row, idx) => (
                                <tr key={idx} className="hover:bg-white/[0.02]">
                                  <td className="p-3 font-mono text-blue-300 text-xs">{row.source}</td>
                                  <td className="p-3 font-semibold text-white">{row.google}</td>
                                  <td className="p-3 text-xs text-white/50">{row.type}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold text-sm">
                        4
                      </div>
                      <div>
                        <h4 className="font-semibold text-white">Concluir e Agendar Sincronização</h4>
                        <p className="text-sm text-white/60 mt-1">
                          Defina o agendamento de sincronização (ex: diário entre 19:00 e 20:00) e clique em <strong>Concluir</strong>. O Google Ads passará a buscar as conversões e atribuir receita automaticamente!
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: CRM Workflow */}
            <TabsContent value="crm-workflow" className="mt-6 space-y-6">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader>
                  <CardTitle className="text-xl text-white flex items-center gap-2">
                    <CircleDollarSign className="h-5 w-5 text-emerald-400" />
                    Como Disparar as Conversões no CRM
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    O Dialogy dispara conversões automaticamente conforme a equipe atende e atualiza negócios no CRM.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 text-sm text-white/80">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3">
                      <div className="flex items-center gap-2 text-amber-400 font-semibold">
                        <CheckCircle2 className="h-5 w-5" />
                        Disparo de Lead Qualificado
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed">
                        Ao arrastar o card do lead da coluna inicial para qualquer estágio posterior no Kanban do CRM (ex: <em>Em Negociação</em>, <em>Proposta Enviada</em> ou <em>Visita Agendada</em>), o Dialogy enfileira a conversão de <strong>Lead Qualificado</strong>.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                        <CircleDollarSign className="h-5 w-5" />
                        Disparo de Venda / Cliente Instalado
                      </div>
                      <p className="text-xs text-white/60 leading-relaxed">
                        Quando você marca o negócio como <strong>Ganho</strong> no CRM informando o valor em R$ (ex: R$ 1.500,00), o Dialogy grava a conversão na fila com o valor financeiro real.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-3">
                    <h4 className="font-semibold text-white flex items-center gap-2">
                      <Bot className="h-5 w-5 text-blue-400" />
                      O que o Worker do Dialogy faz em segundo plano:
                    </h4>
                    <p className="text-xs text-white/60 leading-relaxed">
                      O worker do Dialogy envia o evento imediatamente para a <strong>Google Data Manager API (`events:ingest`)</strong> via HTTP REST, armazena o <code>requestId</code> e consulta a confirmação assíncrona do Google. Simultaneamente, os dados ficam gravados nas views SQL para leitura direta do conector.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: Tracking Link */}
            <TabsContent value="tracking-link" className="mt-6 space-y-6">
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader>
                  <CardTitle className="text-xl text-white flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-amber-400" />
                    Como Configurar o Link de Rastreio nos Anúncios
                  </CardTitle>
                  <CardDescription className="text-white/60">
                    O link intermediário do Dialogy garante que o GCLID sobreviva ao redirecionamento para o app do WhatsApp.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-white/80">
                  <p>
                    Na tela de <strong>Integrações → Google Ads</strong>, você gera o link de destino. Cole esse link no campo <strong>URL Final</strong> do seu anúncio no Google Ads:
                  </p>

                  <div className="rounded-xl border border-white/10 bg-black/60 p-4 font-mono text-xs text-blue-300 break-all relative">
                    <code>
                      https://app.dialogy.com.br/t/wpp/SEU_WORKSPACE/SUA_INSTANCIA?dest=campanha-principal&utm_source=google&utm_medium=cpc&utm_campaign=&#123;campaignid&#125;&gclid=&#123;gclid&#125;&gbraid=&#123;gbraid&#125;&wbraid=&#123;wbraid&#125;&adgroupid=&#123;adgroupid&#125;&creative=&#123;creative&#125;&keyword=&#123;keyword&#125;&device=&#123;device&#125;&matchtype=&#123;matchtype&#125;
                    </code>
                  </div>

                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-300">
                    <strong>Atenção:</strong> Nunca use link direto do <code>wa.me/55...</code> nos anúncios do Google Ads. Links diretos impedem a captura do GCLID e deixam o rastreamento cego.
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* FAQ & Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
            <BadgeCheck className="h-6 w-6 text-emerald-400" />
            3. Boas Práticas e Dúvidas Frequentes
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2">
              <h4 className="font-semibold text-white text-sm">Por que o telefone é entregue em E.164 (+55...)?</h4>
              <p className="text-xs text-white/60 leading-relaxed">
                O Google Ads exige que identificadores de telefone para <em>Enhanced Conversions</em> contenham o código do país e DDD sem traços ou parênteses. As views do Dialogy já formatam automaticamente qualquer telefone do CRM para o padrão internacional.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2">
              <h4 className="font-semibold text-white text-sm">Qual janela de conversão devo usar?</h4>
              <p className="text-xs text-white/60 leading-relaxed">
                No Google Ads, configure a ação de conversão com a janela de <strong>90 dias</strong> (especialmente para Venda Fechada / Cliente Instalado). Isso garante que vendas com ciclo de fechamento mais longo sejam aceitas pelo Google.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2">
              <h4 className="font-semibold text-white text-sm">O que acontece se o lead apagar o código no WhatsApp?</h4>
              <p className="text-xs text-white/60 leading-relaxed">
                O Dialogy possui um algoritmo de segurança com <em>Enhanced Conversions</em> que utiliza o número de telefone e e-mail do lead para casar a conversão no Google mesmo sem o código de texto.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-2">
              <h4 className="font-semibold text-white text-sm">Posso usar API e Data Manager ao mesmo tempo?</h4>
              <p className="text-xs text-white/60 leading-relaxed">
                Sim! O Dialogy utiliza <code>transaction_id</code> exclusivo e determinístico em cada evento. O Google Ads utiliza esse ID para deduplicar automaticamente qualquer envio repetido.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Footer */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center flex flex-col items-center justify-center">
          <Target className="h-12 w-12 text-blue-400 mb-4" />
          <h3 className="text-2xl font-bold text-white mb-2">Pronto para começar?</h3>
          <p className="text-sm text-white/60 max-w-lg mb-6">
            Acesse a página de integração do Google Ads para gerar seus links de rastreamento e vincular sua conta.
          </p>
          <Button asChild size="lg" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold">
            <Link href="/integrations/gads">
              Acessar Integração Google Ads
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
