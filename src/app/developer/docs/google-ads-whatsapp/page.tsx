import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BookOpen,
  CircleDollarSign,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Link2,
  Users,
  Lock,
  MessageSquare,
  MousePointerClick,
  Send,
  ShieldCheck,
  Target,
  XCircle,
} from 'lucide-react';

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

export async function generateMetadata() {
  return buildPageMetadata({ pathname: '/developer/docs/google-ads-whatsapp' });
}

const trackingUrlExample =
  'https://app.dialogy.com.br/t/wpp/WORKSPACE_ID/zap7?dest=pmax-palmas&utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&gclid={gclid}&gbraid={gbraid}&wbraid={wbraid}&adgroupid={adgroupid}&creative={creative}&keyword={keyword}&device={device}&matchtype={matchtype}';

const flowSteps = [
  {
    icon: MousePointerClick,
    title: 'Clique no anúncio',
    text: 'O Google acrescenta o GCLID à URL e envia a pessoa para um endereço do Dialogy.',
  },
  {
    icon: Fingerprint,
    title: 'Registro do clique',
    text: 'O Dialogy grava GCLID, campanha, grupo, criativo e palavra-chave, e gera um código único.',
  },
  {
    icon: Send,
    title: 'Redirecionamento',
    text: 'A pessoa cai no WhatsApp com a mensagem já preenchida, contendo o código.',
  },
  {
    icon: MessageSquare,
    title: 'Casamento',
    text: 'Quando a mensagem chega, o Dialogy liga aquela conversa ao clique que a originou.',
  },
  {
    icon: CircleDollarSign,
    title: 'Conversão de volta',
    text: 'A conversa, o lead qualificado e a venda voltam ao Google com o GCLID e o valor real.',
  },
];

const blockers = [
  {
    title: 'Codificação automática (auto-tagging) desligada',
    symptom: 'Nenhum GCLID é capturado. O rastreio fica cego mesmo com tudo o mais correto.',
    fix: 'No Google Ads: Administrador → Configurações da conta → Codificação automática. Precisa estar ativada.',
  },
  {
    title: 'Ação de conversão do tipo errado',
    symptom: 'O envio é recusado com erro de tipo inválido, e a conversão nunca aparece no relatório.',
    fix: 'A ação precisa ser criada como Importar → Upload manual via API. Uma tag de site não aceita upload de cliques.',
  },
  {
    title: 'Token de desenvolvedor sem aprovação',
    symptom: 'Toda chamada volta com DEVELOPER_TOKEN_NOT_APPROVED.',
    fix: 'No API Center do Google Ads, confirme se o acesso é Básico ou Padrão. Tokens novos só funcionam em contas de teste.',
  },
  {
    title: 'Janela de conversão curta demais',
    symptom: 'Vendas que demoram a fechar são recusadas por estarem fora do prazo.',
    fix: 'Toda ação nasce com 30 dias. Em Metas → a ação → Editar configurações → Janela de conversão de cliques, escolha 90 dias. As opções são fixas: 1, 3, 7, 30 ou 90.',
  },
  {
    title: 'Conversões otimizadas para leads não habilitadas',
    symptom: 'O upload é recusado mesmo com a ação de conversão do tipo certo.',
    fix: 'O Google exige que a conta tenha optado por conversões otimizadas para leads e aceito os termos de dados do cliente antes de aceitar uploads com identificadores.',
  },
];

const apiAccessSteps = [
  {
    title: 'Criar o cliente OAuth',
    text: 'No Google Cloud Console, em APIs e Serviços → Credenciais, crie um ID do cliente OAuth do tipo Aplicativo da Web.',
  },
  {
    title: 'Autorizar o endereço de retorno',
    text: 'Ainda na tela do cliente OAuth, em URIs de redirecionamento autorizados, adicione o endereço do seu domínio terminando em /api/integrations/google-ads/callback.',
    critical: true,
  },
  {
    title: 'Habilitar a API',
    text: 'Em APIs e Serviços → Biblioteca, ative a Google Ads API para o projeto.',
  },
  {
    title: 'Obter o token de desenvolvedor',
    text: 'Em Ferramentas e configurações → Configuração → Central de API. Atenção: essa tela só existe em contas gerenciadoras (MCC). Se a sua conta é individual, será preciso vinculá-la a um MCC antes, porque contas individuais não emitem token.',
    critical: true,
  },
  {
    title: 'Pedir aprovação do token',
    text: 'Um token novo nasce com acesso apenas a contas de teste. Solicite o nível Básico pela própria Central de API, senão as chamadas contra a conta real serão recusadas. Desde o início de 2026 a fila de análise do Google está mais longa e inclui verificação do anunciante, então peça com antecedência.',
    critical: true,
  },
];

const measurementFeatures: Array<{
  icon: typeof BarChart3;
  title: string;
  where: string;
  text: string;
  warning?: string;
}> = [
  {
    icon: BarChart3,
    title: 'Custo, CAC e ROAS por campanha',
    where: 'Na própria tela da integração, ao final.',
    text: 'O custo vem do Google Ads e a receita vem dos negócios ganhos no CRM. Escolha o período e clique em Carregar. É o único lugar onde as duas pontas aparecem juntas: quanto cada campanha custou e quanto ela devolveu.',
  },
  {
    icon: Users,
    title: 'Públicos de Customer Match',
    where: 'No CRM, ao selecionar uma lista.',
    text: 'O botão Sincronizar com Google Ads envia os contatos daquela lista direto como público, sem CSV. Serve para criar públicos semelhantes ou excluir quem já é cliente das campanhas de aquisição.',
    warning: 'Desde 1º de abril de 2026 o Google recusa chamadas de Customer Match de tokens que nunca fizeram esse tipo de requisição antes. Se a sua conta é nova nesse recurso, fale com o suporte do Google Ads para liberar.',
  },
];

const glossary = [
  ['GCLID', 'Identificador que o Google anexa à URL a cada clique em anúncio. É o que permite ligar uma conversão offline ao clique exato que a gerou.'],
  ['gbraid e wbraid', 'Equivalentes do GCLID usados quando o clique vem do iOS, onde restrições de privacidade impedem o GCLID tradicional. O Dialogy captura os três.'],
  ['Codificação automática', 'Auto-tagging, em inglês. Configuração da conta que faz o Google anexar o GCLID automaticamente. Sem ela, não há rastreio.'],
  ['MCC', 'Conta gerenciadora que administra outras contas do Google Ads. Só preencha esse campo se a sua conta de anúncios estiver sob uma.'],
  ['Ação de conversão', 'O evento que você quer contar dentro do Google Ads. Cada evento do Dialogy aponta para uma ação diferente.'],
  ['Conversão offline', 'Conversão que acontece fora do site e é enviada depois, por API. É o caso de uma conversa no WhatsApp que vira venda dias depois.'],
  ['Customer Match', 'Recurso do Google Ads que permite subir uma lista de contatos, sempre com hash, para criar ou excluir públicos.'],
  ['ROAS', 'Retorno sobre o investimento em anúncios. 3x significa três reais de receita para cada real investido.'],
];

const dialogySteps = [
  {
    step: '1',
    title: 'Conectar a conta do Google',
    text: 'Na tela da integração, clique em Conectar com o Google e autorize o acesso. O Dialogy guarda a autorização criptografada. Você não precisa copiar nenhum token.',
    detail: 'Se o botão devolver erro, o endereço de retorno ainda não foi autorizado no Google Cloud Console. Veja a seção de solução de problemas.',
  },
  {
    step: '2',
    title: 'Escolher a conta de anúncios',
    text: 'O Dialogy lista as contas que a sua autorização alcança. Escolha aquela onde as campanhas rodam.',
    detail: 'Só preencha Conta gerenciadora (MCC) se a conta escolhida estiver sob um gerenciador. Fora isso, deixe em Nenhuma.',
  },
  {
    step: '3',
    title: 'Mapear as conversões',
    text: 'Cada evento do Dialogy vira uma ação de conversão no Google. A lista aparece pronta, buscada da sua conta.',
    detail: 'Mensagem recebida é obrigatória. Lead qualificado e Venda fechada são o que fazem o Google buscar qualidade em vez de volume.',
  },
  {
    step: '4',
    title: 'Criar os links dos anúncios',
    text: 'Crie um destino por campanha ou por número de atendimento. O Dialogy gera a URL pronta com todos os parâmetros.',
    detail: 'Copie a URL e cole no campo de URL final do anúncio. Não use link direto do wa.me nos anúncios que precisam de atribuição.',
  },
];

const conversionEvents = [
  {
    name: 'Mensagem recebida',
    when: 'A pessoa manda a primeira mensagem no WhatsApp.',
    value: 'Valor fixo de 1.',
    why: 'É o sinal mais raso: quase equivale ao clique. Sozinho, ensina o Google a comprar volume, não qualidade.',
    required: true,
  },
  {
    name: 'Lead qualificado',
    when: 'O contato avança do primeiro estágio do funil no CRM.',
    value: 'Valor fixo de 1.',
    why: 'Separa quem só mandou um oi de quem tem perfil real. É o primeiro filtro de qualidade.',
    required: false,
  },
  {
    name: 'Venda fechada',
    when: 'Um negócio é marcado como ganho no CRM.',
    value: 'O valor real do negócio.',
    why: 'É o sinal mais forte que existe. Com ele o Google passa a otimizar por receita, não por contagem de leads.',
    required: false,
  },
];

const conversionCreationSteps = [
  'No Google Ads, abra Metas no menu lateral.',
  'Entre em Conversões e depois em Resumo.',
  'Clique em Nova ação de conversão.',
  'Escolha Importar, e não Site nem App.',
  'Selecione Outras fontes de dados ou CRM.',
  'Marque Monitorar conversões de cliques. Esta é a escolha decisiva: sem ela o upload por API é recusado.',
  'Dê um nome claro, como Dialogy · Mensagem recebida.',
  'Em Categoria, use Lead para os dois primeiros eventos e Compra para Venda fechada.',
  'Em Valor, escolha Usar valores diferentes para cada conversão quando for Venda fechada.',
  'Em Janela de conversão de cliques, escolha 90 dias, principalmente na de Venda fechada. O padrão é 30, as opções são fixas (1, 3, 7, 30 ou 90) e uma venda que fecha no dia 45 seria recusada mesmo estando corretamente atribuída aqui.',
  'Salve e repita para cada um dos três eventos que você for usar.',
];

const attributionLayers = [
  {
    icon: BadgeCheck,
    title: 'Código na mensagem',
    confidence: 'Determinístico',
    text: 'A mensagem pré-preenchida leva um código curto. Quando ele chega, a ligação entre clique e conversa é certa, sem estimativa.',
    tone: 'emerald',
  },
  {
    icon: MousePointerClick,
    title: 'Clique recente',
    confidence: 'Probabilístico',
    text: 'Se a pessoa apagar o código antes de enviar, o Dialogy casa a conversa com o clique mais recente ainda não usado daquele mesmo número, dentro de uma janela curta.',
    tone: 'amber',
  },
  {
    icon: Fingerprint,
    title: 'Dados do contato com hash',
    confidence: 'Rede de segurança',
    text: 'Junto de cada conversão vão o telefone e o e-mail convertidos em hash SHA-256. O Google usa isso para recuperar a atribuição quando o GCLID se perdeu.',
    tone: 'blue',
  },
];

const validationSteps: Array<{ title: string; text: string; warning?: string }> = [
  {
    title: 'Abra a URL numa aba anônima',
    text: 'Você deve ser redirecionado ao WhatsApp com a mensagem preenchida e um código no formato DGY-XXXXXXXX.',
  },
  {
    title: 'Envie a mensagem sem apagar o código',
    text: 'No inbox do Dialogy, a conversa deve aparecer na instância certa, com o ícone do Google Ads no canto do avatar.',
  },
  {
    title: 'Confira o registro do clique',
    text: 'Na tabela ad_clicks deve existir uma linha nova. Atenção: o campo gclid precisa conter algo longo começando com Cj0K ou EAIa.',
    warning: 'Se aparecer literalmente {gclid}, o clique não veio de um anúncio real ou a codificação automática está desligada.',
  },
  {
    title: 'Acompanhe a fila',
    text: 'No card Saúde das conversões, a contagem em Na fila deve subir e migrar para Enviadas em até um minuto.',
  },
  {
    title: 'Confirme no Google Ads',
    text: 'A conversão aparece no relatório do Google entre 3 e 24 horas depois do envio. Não é instantâneo.',
  },
];

const troubleshooting = [
  {
    symptom: 'O botão Conectar com o Google devolve erro',
    cause: 'O endereço de retorno não está autorizado.',
    fix: 'No Google Cloud Console, em APIs e Serviços → Credenciais → seu cliente OAuth, adicione o endereço de retorno do seu domínio, terminando em /api/integrations/google-ads/callback.',
  },
  {
    symptom: 'A lista de contas aparece vazia',
    cause: 'A autorização foi feita com um usuário sem acesso à conta de anúncios.',
    fix: 'Desconecte e conecte novamente usando um usuário Google que tenha acesso à conta no Google Ads.',
  },
  {
    symptom: 'A lista de conversões aparece vazia',
    cause: 'A conta ainda não tem ação de conversão, ou o token de desenvolvedor não foi aprovado.',
    fix: 'Crie as ações seguindo a seção anterior. Se elas existem e mesmo assim não aparecem, verifique o nível de acesso do token no API Center.',
  },
  {
    symptom: 'gclid gravado como {gclid}',
    cause: 'A URL foi aberta fora de um anúncio, ou a codificação automática está desligada.',
    fix: 'Ative a codificação automática e teste clicando num anúncio de verdade. O Dialogy ignora esses valores e não os envia ao Google.',
  },
  {
    symptom: 'Conversões ficam paradas em Na fila',
    cause: 'O processo que envia as conversões não está no ar.',
    fix: 'Confirme com a equipe técnica se o serviço worker-google-ads está rodando.',
  },
  {
    symptom: 'Conversões aparecem em Descartadas',
    cause: 'O Google recusou o envio de forma definitiva.',
    fix: 'A mensagem exata do erro aparece no card Saúde das conversões, em Últimas falhas. Ela costuma apontar o tipo errado de ação ou janela de conversão vencida.',
  },
  {
    symptom: 'A conversa não mostra o ícone do Google Ads',
    cause: 'A mensagem chegou sem o código e fora da janela do casamento por proximidade.',
    fix: 'Deixe a mensagem inicial curta, para reduzir a chance de a pessoa apagar o código antes de enviar.',
  },
];

const privacyNotes = [
  'Telefone e e-mail nunca saem do Dialogy em texto puro: viram hash SHA-256 antes do envio.',
  'O endereço IP de quem clica é guardado apenas como hash, para detectar abuso, e nunca identifica a pessoa.',
  'A autorização do Google fica criptografada em AES-256-GCM no banco.',
  'O consentimento só é declarado ao Google se você escolher isso explicitamente na tela. O padrão é não declarar.',
  'Cliques que expiram sem virar conversa são apagados automaticamente.',
];

const officialReferences = [
  {
    label: 'Google: ativar a codificação automática',
    href: 'https://support.google.com/google-ads/answer/3095550',
  },
  {
    label: 'Google: importar conversões offline com GCLID',
    href: 'https://support.google.com/google-ads/answer/7012522',
  },
  {
    label: 'Google Ads API: upload de conversões offline',
    href: 'https://developers.google.com/google-ads/api/docs/conversions/upload-clicks',
  },
  {
    label: 'Google Ads API: conversões otimizadas para leads',
    href: 'https://developers.google.com/google-ads/api/docs/conversions/enhanced-conversions-leads',
  },
  {
    label: 'Google: níveis de acesso do token de desenvolvedor',
    href: 'https://developers.google.com/google-ads/api/docs/access-levels',
  },
];

const toneStyles: Record<string, string> = {
  emerald: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  amber: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  blue: 'border-blue-400/20 bg-blue-400/10 text-blue-300',
};

const tableOfContents = [
  ['#visao-geral', 'Como funciona'],
  ['#bloqueadores', 'O que quebra em silêncio'],
  ['#acesso-api', 'Acesso à API'],
  ['#no-dialogy', 'Configurar no Dialogy'],
  ['#conversoes', 'Criar as conversões'],
  ['#eventos', 'Os três eventos'],
  ['#anuncio', 'Colocar a URL no anúncio'],
  ['#atribuicao', 'Como não perdemos a origem'],
  ['#medir', 'Medir e criar públicos'],
  ['#validacao', 'Validar a configuração'],
  ['#problemas', 'Solução de problemas'],
  ['#privacidade', 'Privacidade'],
  ['#glossario', 'Glossário'],
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
              Documentação
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Target className="h-3 w-3" />
              Google Ads
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 text-sm font-semibold text-white">Neste artigo</div>
            <nav className="space-y-1 text-sm">
              {tableOfContents.map(([href, label]) => (
                <a
                  key={href}
                  className="block rounded-lg px-3 py-2 text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                  href={href}
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>

          <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-400/5 p-4">
            <p className="text-xs leading-5 text-white/60">
              Tempo estimado: <span className="font-semibold text-white">25 minutos</span>, sendo a maior parte
              dentro do Google Ads criando as ações de conversão.
            </p>
          </div>
        </aside>

        <main className="min-w-0 max-w-4xl">
          <header className="mb-12 border-b border-white/10 pb-10">
            <div className="mb-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">Documentação</span>
              <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-300">WhatsApp</span>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">Conversões offline</span>
            </div>
            <h1 className="mb-6 text-4xl font-bold leading-tight md:text-5xl">
              Rastrear do clique no Google Ads até a venda fechada no WhatsApp
            </h1>
            <p className="max-w-3xl text-lg leading-8 text-white/60">
              Este guia mostra como ligar o Google Ads ao Dialogy para que cada conversa no WhatsApp saiba de qual
              anúncio veio, e para que cada venda volte ao Google com o valor real. É assim que o algoritmo para de
              comprar volume e passa a comprar clientes.
            </p>
          </header>

          <article className="space-y-14">
            <section id="visao-geral" className="space-y-5">
              <h2 className="text-2xl font-bold">Como funciona</h2>
              <p className="leading-7 text-white/60">
                O problema do WhatsApp é que ele é uma caixa preta: a pessoa sai do anúncio e cai numa conversa que
                o Google não enxerga. A solução é passar o clique por um endereço nosso antes, guardar quem era, e
                devolver essa informação depois que a conversa virar negócio.
              </p>
              <div className="grid gap-3 md:grid-cols-5">
                {flowSteps.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="relative rounded-2xl border border-white/10 bg-white/5 p-4">
                      <Icon className="mb-3 h-5 w-5 text-blue-400" />
                      <h3 className="mb-1.5 text-sm font-semibold text-white">{item.title}</h3>
                      <p className="text-xs leading-5 text-white/60">{item.text}</p>
                      {index < flowSteps.length - 1 && (
                        <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-white/20 md:block" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
                <p className="text-sm leading-6 text-white/70">
                  <span className="font-semibold text-emerald-300">Por que isso é melhor que um pixel: </span>
                  o GCLID é capturado no servidor, no instante do clique. Não depende de cookie, não é bloqueado por
                  extensão e não some quando a pessoa troca de aparelho. A ligação entre anúncio e venda é registrada,
                  não estimada.
                </p>
              </div>
            </section>

            <section id="bloqueadores" className="space-y-5">
              <h2 className="text-2xl font-bold">O que quebra em silêncio</h2>
              <p className="leading-7 text-white/60">
                Leia esta seção antes de configurar qualquer coisa. São quatro pontos que, se estiverem errados, fazem
                a integração parecer funcionar enquanto nenhuma conversão chega ao Google.
              </p>
              <div className="grid gap-3">
                {blockers.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                    <div className="mb-3 flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <h3 className="font-semibold text-white">{item.title}</h3>
                    </div>
                    <div className="grid gap-2 pl-7 text-sm">
                      <p className="text-white/60">
                        <span className="font-medium text-white/80">Sintoma: </span>
                        {item.symptom}
                      </p>
                      <p className="text-white/60">
                        <span className="font-medium text-emerald-300">Correção: </span>
                        {item.fix}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="acesso-api" className="space-y-5">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-blue-400" />
                <h2 className="text-2xl font-bold">Acesso à API</h2>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-white/50">
                  uma vez por instalação
                </span>
              </div>
              <p className="leading-7 text-white/60">
                Esta parte é feita uma única vez, por quem administra o Dialogy. Depois disso, qualquer workspace
                conecta a própria conta sozinho, pelo botão da tela. Se você é usuário e só quer ligar a sua conta,
                pode pular para a seção seguinte.
              </p>
              <div className="grid gap-3">
                {apiAccessSteps.map((item, index) => (
                  <div
                    key={item.title}
                    className={`rounded-2xl border p-5 ${
                      item.critical ? 'border-amber-400/20 bg-amber-400/5' : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white/60">
                        {index + 1}
                      </span>
                      <div className="space-y-1.5">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <p className="text-sm leading-6 text-white/60">{item.text}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm leading-6 text-white/60">
                  Os dois passos destacados são os que mais causam dor de cabeça: sem o endereço de retorno
                  autorizado o botão de conectar falha, e sem a aprovação do token toda chamada à conta real é
                  recusada. Os dois erros aparecem só depois, na hora de usar.
                </p>
              </div>
            </section>

            <section id="no-dialogy" className="space-y-5">
              <h2 className="text-2xl font-bold">Configurar no Dialogy</h2>
              <p className="leading-7 text-white/60">
                A tela da integração é um passo a passo. Cada etapa só libera a seguinte, então basta seguir de cima
                para baixo.
              </p>
              <div className="grid gap-3">
                {dialogySteps.map((item) => (
                  <div key={item.step} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-400/30 bg-blue-400/10 text-sm font-bold text-blue-300">
                        {item.step}
                      </div>
                      <div className="space-y-2">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <p className="text-sm leading-6 text-white/60">{item.text}</p>
                        <p className="text-sm leading-6 text-white/40">{item.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="conversoes" className="space-y-5">
              <h2 className="text-2xl font-bold">Criar as conversões no Google Ads</h2>
              <p className="leading-7 text-white/60">
                Esta é a parte que mais dá errado. A ação de conversão precisa ser de importação por clique. Se você
                criar uma tag de site, o Dialogy não conseguirá enviar nada, e o erro só vai aparecer depois.
              </p>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <ol className="space-y-3">
                  {conversionCreationSteps.map((item, index) => (
                    <li key={item} className="flex gap-4 text-sm leading-6 text-white/70">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white/60">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-5">
                <p className="text-sm leading-6 text-white/70">
                  <span className="font-semibold text-blue-300">Espere de 4 a 6 horas </span>
                  entre criar a ação e o primeiro envio. Esse é o prazo que o próprio Google indica: enviar antes
                  disso pode fazer a conversão levar até 2 dias para aparecer nos relatórios.
                </p>
              </div>
            </section>

            <section id="eventos" className="space-y-5">
              <h2 className="text-2xl font-bold">Os três eventos, e por que os dois últimos importam</h2>
              <p className="leading-7 text-white/60">
                O Dialogy sabe enviar três conversões diferentes. Configurar só a primeira funciona, mas desperdiça a
                maior parte do valor.
              </p>
              <div className="grid gap-3">
                {conversionEvents.map((event) => (
                  <div key={event.name} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{event.name}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          event.required
                            ? 'border-white/10 bg-white/5 text-white/60'
                            : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                        }`}
                      >
                        {event.required ? 'Obrigatória' : 'Recomendada'}
                      </span>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-white/40">Quando dispara</dt>
                        <dd className="leading-6 text-white/70">{event.when}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/40">Valor enviado</dt>
                        <dd className="leading-6 text-white/70">{event.value}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-white/40">Efeito no leilão</dt>
                        <dd className="leading-6 text-white/70">{event.why}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
                <p className="text-sm leading-6 text-white/70">
                  <span className="font-semibold text-emerald-300">Correção automática de valor: </span>
                  se o valor do negócio mudar depois de fechado, o Dialogy envia a correção ao Google. Se o negócio
                  for reaberto ou cancelado, envia a retratação. Você não precisa fazer nada.
                </p>
              </div>
            </section>

            <section id="anuncio" className="space-y-5">
              <h2 className="text-2xl font-bold">Colocar a URL no anúncio</h2>
              <p className="leading-7 text-white/60">
                Cada destino criado no Dialogy gera uma URL própria. Copie pelo botão da tela e cole no campo de URL
                final do anúncio. As chaves entre colchetes são substituídas pelo próprio Google no momento do clique.
              </p>
              <p className="leading-7 text-white/60">
                Repare que a URL pede três identificadores diferentes. O <span className="font-mono text-xs text-emerald-300">gclid</span>{' '}
                é o normal. Os outros dois, <span className="font-mono text-xs text-emerald-300">gbraid</span> e{' '}
                <span className="font-mono text-xs text-emerald-300">wbraid</span>, aparecem no lugar dele quando o
                clique vem do iOS, onde as restrições de privacidade da Apple impedem o identificador tradicional.
                Manter os três garante que o rastreio não perca metade do tráfego mobile.
              </p>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
                  <Link2 className="h-3.5 w-3.5 text-white/40" />
                  <span className="text-xs font-medium text-white/50">Exemplo de URL final</span>
                </div>
                <pre className="overflow-x-auto px-4 py-4">
                  <code className="whitespace-pre-wrap break-all font-mono text-xs leading-6 text-emerald-300">
                    {trackingUrlExample}
                  </code>
                </pre>
              </div>
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                <p className="text-sm leading-6 text-white/70">
                  <span className="font-semibold text-amber-300">Não use wa.me direto no anúncio </span>
                  quando precisar de atribuição. O link direto pula o registro do clique, e nenhuma conversão
                  conseguirá ser ligada à campanha depois.
                </p>
              </div>
            </section>

            <section id="atribuicao" className="space-y-5">
              <h2 className="text-2xl font-bold">Como não perdemos a origem</h2>
              <p className="leading-7 text-white/60">
                O texto do WhatsApp é editável, e parte das pessoas apaga o código antes de enviar. Por isso existem
                três camadas, da mais precisa para a mais tolerante.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {attributionLayers.map((layer) => {
                  const Icon = layer.icon;
                  return (
                    <div key={layer.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <Icon className="mb-3 h-5 w-5 text-white/70" />
                      <h3 className="mb-2 font-semibold text-white">{layer.title}</h3>
                      <span className={`mb-3 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneStyles[layer.tone]}`}>
                        {layer.confidence}
                      </span>
                      <p className="text-sm leading-6 text-white/60">{layer.text}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm leading-6 text-white/50">
                Na conversa, um ícone pequeno do Google Ads aparece no canto do avatar. Passando o mouse, você vê a
                campanha e se a origem foi confirmada pelo código ou inferida pelo clique recente.
              </p>
            </section>

            <section id="medir" className="space-y-5">
              <h2 className="text-2xl font-bold">Medir e criar públicos</h2>
              <p className="leading-7 text-white/60">
                Com a conta conectada, o Dialogy deixa de só empurrar conversão e passa a trazer dados do Google
                de volta. São dois recursos que só funcionam depois que a conexão está de pé.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {measurementFeatures.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                      <Icon className="mb-3 h-5 w-5 text-blue-400" />
                      <h3 className="mb-1 font-semibold text-white">{feature.title}</h3>
                      <p className="mb-3 text-xs text-white/40">{feature.where}</p>
                      <p className="text-sm leading-6 text-white/60">{feature.text}</p>
                      {feature.warning && (
                        <p className="mt-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200/80">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                          {feature.warning}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-sm leading-6 text-white/70">
                    <span className="font-semibold text-amber-300">Como ler o ROAS: </span>
                    a receita é apurada por contato. Se o mesmo cliente clicou em duas campanhas diferentes, o valor
                    dele aparece nas duas. Isso infla o total quando somado. Use os números para comparar campanhas
                    entre si, e não como fechamento contábil.
                  </p>
                </div>
              </div>
            </section>

            <section id="validacao" className="space-y-5">
              <h2 className="text-2xl font-bold">Validar a configuração</h2>
              <p className="leading-7 text-white/60">
                Faça este teste antes de subir verba. Ele leva alguns minutos e mostra se cada elo da corrente está
                funcionando.
              </p>
              <div className="grid gap-3">
                {validationSteps.map((item, index) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <div className="flex items-start gap-4">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-xs font-semibold text-emerald-300">
                        {index + 1}
                      </span>
                      <div className="space-y-2">
                        <h3 className="font-semibold text-white">{item.title}</h3>
                        <p className="text-sm leading-6 text-white/60">{item.text}</p>
                        {item.warning && (
                          <p className="flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-amber-200/80">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                            {item.warning}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section id="problemas" className="space-y-5">
              <h2 className="text-2xl font-bold">Solução de problemas</h2>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-white/5 text-xs text-white/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Sintoma</th>
                        <th className="px-4 py-3 text-left font-medium">Causa provável</th>
                        <th className="px-4 py-3 text-left font-medium">O que fazer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {troubleshooting.map((item) => (
                        <tr key={item.symptom} className="border-t border-white/10 align-top">
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                              <span className="font-medium text-white/90">{item.symptom}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 leading-6 text-white/50">{item.cause}</td>
                          <td className="px-4 py-3 leading-6 text-white/70">{item.fix}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section id="privacidade" className="space-y-5">
              <h2 className="text-2xl font-bold">Privacidade e dados pessoais</h2>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">O que sai e o que fica</span>
                </div>
                <div className="grid gap-3">
                  {privacyNotes.map((item) => (
                    <div key={item} className="flex gap-3 text-sm leading-6 text-white/70">
                      <Lock className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="text-sm leading-6 text-white/50">
                A declaração de consentimento fica desligada por padrão porque é uma decisão de compliance da sua
                empresa, não nossa. Ative apenas se a sua política de privacidade cobrir o compartilhamento desses
                dados com o Google.
              </p>
            </section>

            <section id="glossario" className="space-y-5">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-400" />
                <h2 className="text-2xl font-bold">Glossário</h2>
              </div>
              <div className="grid gap-2">
                {glossary.map(([termo, definicao]) => (
                  <div key={termo} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <dt className="mb-1 text-sm font-semibold text-white">{termo}</dt>
                    <dd className="text-sm leading-6 text-white/60">{definicao}</dd>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-5">
              <h2 className="text-2xl font-bold">Referências oficiais</h2>
              <div className="grid gap-2">
                {officialReferences.map((reference) => (
                  <a
                    key={reference.href}
                    href={reference.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                  >
                    <span>{reference.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  </a>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-blue-400/20 bg-blue-400/5 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="mb-1 font-semibold text-white">Pronto para configurar</h2>
                  <p className="text-sm text-white/60">
                    Abra a integração e siga as quatro etapas. Leva menos tempo do que ler este guia.
                  </p>
                </div>
                <Link
                  href="/integrations/gads"
                  className="inline-flex items-center gap-2 rounded-full bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
                >
                  Abrir integração
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </article>
        </main>
      </div>
    </div>
  );
}

