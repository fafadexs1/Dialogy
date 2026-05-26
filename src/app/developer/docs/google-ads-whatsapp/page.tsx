import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  MousePointerClick,
  Send,
  Settings2,
  Target,
} from 'lucide-react';

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

export async function generateMetadata() {
  return buildPageMetadata({ pathname: '/developer/docs/google-ads-whatsapp' });
}

const trackingUrlExample =
  'https://app.dialogy.com.br/t/wpp/WORKSPACE_ID/zap7?dest=pmax-palmas&utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&gclid={gclid}&gbraid={gbraid}&wbraid={wbraid}&adgroupid={adgroupid}&creative={creative}&keyword={keyword}&device={device}&matchtype={matchtype}';

const overviewCards = [
  { icon: MousePointerClick, title: 'Clique', text: 'O Google envia o usuario para uma URL do Dialogy.' },
  { icon: Settings2, title: 'Tracking', text: 'O Dialogy salva GCLID, campanha, grupo, criativo e destino.' },
  { icon: Send, title: 'WhatsApp', text: 'O usuario e redirecionado para o numero configurado no card.' },
  { icon: Target, title: 'Conversao', text: 'A mensagem real vira evento exportavel para Google Ads.' },
];

const requirements = [
  'Uma instancia Evolution API conectada no workspace que recebera as mensagens.',
  'Um numero de WhatsApp de destino em formato internacional, por exemplo 556338104040.',
  'Acesso administrativo ao Google Ads para criar acoes de conversao.',
  'Credenciais Google Ads API configuradas no ambiente do Dialogy.',
];

const accountFields = [
  {
    title: 'Customer ID',
    description: 'ID da conta Google Ads que recebera as conversoes.',
    detail: 'Use apenas numeros, sem hifens. Exemplo: 1234567890.',
  },
  {
    title: 'Login Customer ID',
    description: 'ID do MCC quando a conta e gerenciada por uma conta manager.',
    detail: 'Se voce nao usa MCC, deixe em branco.',
  },
  {
    title: 'Mensagem recebida',
    description: 'Acao de conversao principal.',
    detail: 'Preencha o resource name da acao no formato customers/ID/conversionActions/ID.',
  },
  {
    title: 'Lead qualificado e Venda fechada',
    description: 'Eventos avancados para melhorar a otimizacao.',
    detail: 'Sao opcionais no inicio. Configure quando o CRM ja tiver criterio claro para lead qualificado e venda.',
  },
];

const destinationFields = [
  ['Nome do destino', 'Nome interno para identificar o card, como PMAX Palmas ou Pesquisa Fibra.'],
  ['Slug da URL', 'Identificador curto usado em dest=slug. Deve ser unico no workspace.'],
  ['Instancia Evolution', 'Instancia que recebera o webhook quando o cliente mandar mensagem.'],
  ['WhatsApp de destino', 'Numero que sera aberto no WhatsApp, com DDI e DDD.'],
  ['Mensagem inicial', 'Texto pre-preenchido. O Dialogy adiciona o codigo tecnico de tracking automaticamente.'],
];

const setupSteps = [
  {
    title: '1. Abra a conta correta',
    text: 'Entre no Google Ads pela conta que recebe as conversoes. Se voce usa MCC, primeiro confirme se a acao de conversao fica na conta cliente ou no manager.',
  },
  {
    title: '2. Copie os IDs da conta',
    text: 'O Customer ID vem da conta anunciante. O Login Customer ID so entra quando a API autentica por uma conta manager/MCC.',
  },
  {
    title: '3. Crie a conversao offline',
    text: 'Crie uma acao de conversao de importacao por clique. Ela precisa aceitar upload/API, porque o Dialogy enviara a conversao depois que a mensagem chegar.',
  },
  {
    title: '4. Monte o resource name',
    text: 'O Dialogy nao usa apenas o nome da conversao. Ele precisa do formato tecnico customers/ID_DA_CONTA/conversionActions/ID_DA_ACAO.',
  },
];

const googleAdsFieldGuide = [
  {
    title: 'Customer ID',
    value: 'Onde pegar',
    text: 'No Google Ads, clique na foto/perfil no canto superior direito. O ID aparece abaixo do nome da conta. Copie os 10 digitos e cole no Dialogy sem hifens.',
    example: 'Se o Google mostra 123-456-7890, salve 1234567890.',
  },
  {
    title: 'Login Customer ID',
    value: 'Quando preencher',
    text: 'Preencha somente se a integracao/API estiver autenticada por uma conta manager/MCC. Nesse caso, abra o MCC, clique no seletor de contas e copie o ID do manager.',
    example: 'Se a API acessa direto a conta anunciante, deixe em branco.',
  },
  {
    title: 'Mensagem recebida',
    value: 'Conversao principal',
    text: 'Crie uma acao offline para o evento que acontece quando uma conversa real chega pelo WhatsApp. Essa deve ser a primeira conversao enviada pelo Dialogy.',
    example: 'Nome sugerido: Dialogy - Mensagem recebida.',
  },
  {
    title: 'Lead qualificado',
    value: 'Conversao opcional',
    text: 'Use quando o atendimento ou CRM marcar que a pessoa tem perfil real de compra. No inicio, deixe como secundaria ate validar qualidade e volume.',
    example: 'Nome sugerido: Dialogy - Lead qualificado.',
  },
  {
    title: 'Venda fechada',
    value: 'Conversao de valor',
    text: 'Use quando o CRM tiver fechamento confiavel. E o evento mais forte para otimizacao, mas so deve entrar quando a operacao consegue registrar venda sem falha.',
    example: 'Nome sugerido: Dialogy - Venda fechada.',
  },
];

const conversionCreationSteps = [
  'No Google Ads, abra Metas ou Goals no menu lateral.',
  'Entre em Conversoes e depois Resumo.',
  'Clique em Criar acao de conversao ou Nova acao de conversao.',
  'Escolha Conversoes offline. Em algumas contas, o caminho aparece como Importar.',
  'Selecione dados de CRM/outras fontes ou importacao manual via API/uploads.',
  'Escolha rastrear conversoes de cliques. Nao escolha conversao de site/tag para esse fluxo.',
  'Crie a acao com categoria Lead para Mensagem recebida e Lead qualificado. Para Venda fechada, use Compra/Venda quando fizer sentido para o negocio.',
  'Depois de criar a acao, aguarde algumas horas antes do primeiro envio, porque o Google pode demorar para aceitar uploads de uma conversao nova.',
];

const resourceNameSteps = [
  'Abra a acao de conversao criada no Google Ads.',
  'Copie o ID numerico da acao de conversao. Ele aparece na URL da tela da conversao ou pode ser consultado pela Google Ads API.',
  'Monte o valor no formato customers/CUSTOMER_ID/conversionActions/CONVERSION_ACTION_ID.',
  'Cole esse valor no campo correspondente do Dialogy. Nao cole apenas o nome da conversao.',
];

const officialReferences = [
  {
    label: 'Google: encontrar o Customer ID',
    href: 'https://support.google.com/google-ads/answer/1704344',
  },
  {
    label: 'Google: conversoes offline com GCLID',
    href: 'https://support.google.com/google-ads/answer/7012522',
  },
  {
    label: 'Google Ads API: upload de conversoes offline',
    href: 'https://developers.google.com/google-ads/api/docs/conversions/upload-offline',
  },
];

const validationSteps = [
  'Copie a URL de um card e abra em uma aba anonima.',
  'Confirme que o navegador redireciona para o WhatsApp com a mensagem inicial.',
  'Envie a mensagem sem apagar o codigo tecnico DGY.',
  'Abra o inbox do Dialogy e confirme que o chat foi criado pela instancia correta.',
  'No banco, a conversa deve gerar registro em ad_clicks, ad_attributions e conversion_exports.',
  'Depois de configurar credenciais Google Ads API, processe a fila para enviar a conversao.',
];

const bestPractices = [
  'Use um card por campanha importante para facilitar auditoria e comparacao.',
  'Nao use link direto do WhatsApp nos anuncios que precisam de atribuicao precisa.',
  'Mantenha a mensagem inicial curta para reduzir a chance do cliente apagar o codigo tecnico.',
  'Envie primeiro o evento Mensagem recebida. Depois evolua para Lead qualificado e Venda fechada.',
];

export default function GoogleAdsWhatsappGuidePage() {
  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
      <StoredSeoJsonLd pathname="/developer/docs/google-ads-whatsapp" />

      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <DeveloperBrand />
          <Link href="/developer/docs" className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Voltar para Docs
          </Link>
        </div>
      </nav>

      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit lg:sticky lg:top-24">
          <div className="mb-8">
            <Link href="/developer/docs" className="mb-6 inline-flex items-center gap-2 text-sm text-white/50 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Documentacao
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Target className="h-3 w-3" />
              Google Ads
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Neste artigo</div>
            <nav className="space-y-1 text-sm">
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#visao-geral">Visao geral</a>
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#pre-requisitos">Pre-requisitos</a>
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#conta">Conta e conversoes</a>
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#destinos">Cards de destino</a>
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#google-ads">Google Ads</a>
              <a className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white" href="#validacao">Validacao</a>
            </nav>
          </div>
        </aside>

        <main className="min-w-0 max-w-4xl">
          <header className="mb-12 border-b border-white/10 pb-10">
            <div className="mb-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">Documentacao</span>
              <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-300">WhatsApp</span>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">Conversoes offline</span>
            </div>
            <h1 className="mb-6 text-4xl font-bold leading-tight md:text-5xl">
              Como configurar o GADS para rastrear conversas reais do Google Ads no WhatsApp
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-white/60">
              Configure a integracao GADS no Dialogy, gere URLs rastreaveis para seus anuncios e envie conversoes reais
              para o Google Ads quando uma mensagem chegar pelo WhatsApp.
            </p>
          </header>

          <article className="space-y-12">
            <section id="visao-geral" className="space-y-5">
              <h2 className="text-2xl font-bold">Visao geral</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {overviewCards.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <Icon className="mb-4 h-5 w-5 text-blue-400" />
                      <h3 className="mb-2 font-semibold text-white">{item.title}</h3>
                      <p className="text-sm leading-6 text-white/60">{item.text}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="pre-requisitos" className="space-y-5">
              <h2 className="text-2xl font-bold">Pre-requisitos</h2>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="grid gap-3">
                  {requirements.map((item) => (
                    <div key={item} className="flex gap-3 text-sm text-white/75">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section id="conta" className="space-y-5">
              <h2 className="text-2xl font-bold">Conta e conversoes</h2>
              <p className="leading-7 text-white/60">
                A primeira parte da tela GADS configura a conta do Google Ads e as acoes de conversao. Esses campos sao
                compartilhados por todos os cards de destino.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {accountFields.map((field) => (
                  <div key={field.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <h3 className="mb-2 text-lg font-semibold">{field.title}</h3>
                    <p className="mb-4 text-sm text-white/50">{field.description}</p>
                    <p className="text-sm leading-6 text-white/70">{field.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="destinos" className="space-y-5">
              <h2 className="text-2xl font-bold">Cards de destino</h2>
              <p className="leading-7 text-white/60">
                Cada card representa uma URL de anuncio. Crie cards separados quando quiser medir campanhas, regioes,
                numeros, unidades ou operacoes diferentes.
              </p>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="divide-y divide-white/10">
                  {destinationFields.map(([field, description]) => (
                    <div key={field} className="grid gap-1 py-4 first:pt-0 last:pb-0">
                      <div className="font-medium text-white">{field}</div>
                      <div className="text-sm leading-6 text-white/60">{description}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section id="google-ads" className="space-y-5">
              <h2 className="text-2xl font-bold">Configurar o anuncio no Google Ads</h2>
              <p className="leading-7 text-white/60">
                Esta e a parte mais sensivel da configuracao. O Dialogy precisa dos IDs tecnicos do Google Ads para
                exportar conversoes offline com precisao. Nao use nome de campanha, nome da conversao ou link direto do
                WhatsApp nesses campos.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                {googleAdsFieldGuide.map((field) => (
                  <div key={field.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{field.title}</h3>
                      <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-xs font-medium text-blue-300">
                        {field.value}
                      </span>
                    </div>
                    <p className="mb-3 text-sm leading-6 text-white/60">{field.text}</p>
                    <p className="rounded-xl border border-white/10 bg-black/25 p-3 font-mono text-xs leading-5 text-blue-100">
                      {field.example}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4">
                {setupSteps.map((step) => (
                  <div key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                    <p className="text-sm leading-6 text-white/60">{step.text}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="mb-2 text-lg font-semibold">Criar a acao de conversao no Google Ads</h3>
                <p className="mb-5 text-sm leading-6 text-white/60">
                  Para esse fluxo, a conversao precisa ser de importacao/offline por clique. Ela nao e uma tag de site,
                  porque o evento real acontece depois, quando a Evolution API confirma a mensagem recebida.
                </p>
                <div className="grid gap-3">
                  {conversionCreationSteps.map((item, index) => (
                    <div key={item} className="flex gap-3 text-sm text-white/75">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-xs font-semibold text-blue-300">
                        {index + 1}
                      </span>
                      <span className="leading-6">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5">
                <h3 className="mb-2 text-lg font-semibold text-amber-100">Como preencher o resource name no Dialogy</h3>
                <p className="mb-5 text-sm leading-6 text-amber-100/70">
                  O campo de conversao no Dialogy deve receber o identificador completo da acao de conversao. Esse e o
                  valor que a Google Ads API exige para aceitar o upload.
                </p>
                <div className="mb-5 rounded-xl border border-amber-300/20 bg-black/30 p-4">
                  <p className="break-all font-mono text-xs leading-6 text-amber-100">
                    customers/1234567890/conversionActions/987654321
                  </p>
                </div>
                <div className="grid gap-3">
                  {resourceNameSteps.map((item) => (
                    <div key={item} className="flex gap-3 text-sm text-amber-100/80">
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-amber-300" />
                      <span className="leading-6">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="mb-2 text-lg font-semibold">Exemplo de URL gerada</h3>
                <p className="mb-4 text-sm text-white/50">Use a URL do card como destino do anuncio.</p>
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="break-all font-mono text-xs leading-6 text-blue-100">{trackingUrlExample}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="mb-4 text-lg font-semibold">Referencias oficiais</h3>
                <div className="grid gap-2">
                  {officialReferences.map((reference) => (
                    <a
                      key={reference.href}
                      href={reference.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
                    >
                      {reference.label}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
              </div>
            </section>

            <section id="validacao" className="space-y-5">
              <h2 className="text-2xl font-bold">Validar se esta funcionando</h2>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="grid gap-3">
                  {validationSteps.map((item) => (
                    <div key={item} className="flex gap-3 text-sm text-white/75">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="mb-4 text-lg font-semibold">Boas praticas</h3>
                <div className="grid gap-3 text-sm leading-6 text-white/60">
                  {bestPractices.map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </div>
            </section>

            <div className="flex flex-wrap gap-3 border-t border-white/10 pt-6">
              <Link
                href="/integrations/gads"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
              >
                Abrir integracao GADS
                <ExternalLink className="h-4 w-4" />
              </Link>
              <Link
                href="/developer/docs"
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Copy className="h-4 w-4" />
                Voltar para docs
              </Link>
              <Link
                href="/developer"
                className="inline-flex items-center gap-1 px-2 py-2.5 text-sm font-medium text-blue-400 transition-all hover:gap-2 hover:text-blue-300"
              >
                Developer Hub
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}
