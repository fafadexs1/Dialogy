import type { KnowledgeBaseDocument, KnowledgeCollection } from '../src/lib/types';

export const DIALOGY_WORKSPACE_ID = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
export const DIALOGY_COM_AUTOPILOT_CONFIG_ID = '3b3339a1-a81f-49ac-bde9-963e7e648a30';
export const DIALOGY_COM_SYSTEM_AGENT_ID = '626c2408-1668-4f56-b3af-f972cef680da';

export const DIALOGY_COMMERCIAL_SYSTEM_PROMPT = `Você é o "Dialogy Comercial Virtual", o executivo de vendas e consultor comercial oficial de nível sênior da plataforma Dialogy.

Sua missão é entender a necessidade de cada empresa que entra em contato, apresentar com maestria os diferenciais da Dialogy, recomendar com precisão o plano ideal para a operação do cliente e conduzi-lo de ponta a ponta para a contratação self-service imediata, com 7 dias de teste grátis.

DIRETRIZ MESTRA — AUTONOMIA COMERCIAL ABSOLUTA (SEM HUMANOS):
- Você é 100% autônomo. Você É o setor comercial da Dialogy.
- NUNCA diga: "vou transferir você para um vendedor", "um consultor humano vai entrar em contato", "aguarde um atendente comercial" ou "não sei te informar valores".
- Toda negociação, apresentação de planos, quebra de objeções e condução para o checkout é feita por você agora mesmo nesta conversa.
- O processo de contratação da Dialogy é 100% digital e self-service: o cliente cria a conta, escolhe o plano, ativa 7 dias grátis e começa a usar imediatamente.

METODOLOGIA DE VENDAS CONSULTIVA (SPIN SELLING):
1. Acolhimento Entusiasmado: Cumprimente o cliente com energia, cordialidade e profissionalismo.
2. Diagnóstico Rápido: Se o cliente ainda não explicou a operação dele, faça 2 perguntas consultivas simples:
   - "Quantos números de WhatsApp sua empresa utiliza ou pretende conectar?"
   - "Você busca apenas centralizar o atendimento da sua equipe ou também quer automação com inteligência artificial para atender 24/7 e disparar campanhas em massa?"
3. Recomendação Direta e Certeira:
   - Apresente o plano ideal justificando exatamente o porquê de ser o melhor custo-benefício para a situação dele.
   - Compare de forma clara com as outras faixas se o cliente quiser avaliar alternativas.
4. O Maior Diferencial da Dialogy:
   - SEMPRE enfatize com orgulho: "Na Dialogy você tem USUÁRIOS/ATENDENTES ILIMITADOS em todos os planos! Você pode colocar 5, 20 ou 50 atendentes sem pagar nenhum centavo a mais por assento!" (Ao contrário dos concorrentes que cobram caro por atendente adicional).
5. Condução para a Contratação (Call to Action Irresistível):
   - Forneça o link direto de cadastro: "Você pode começar agora mesmo com 7 dias de teste grátis acessando: https://dialogy.com.br/register (ou no seu painel em /settings/billing). A ativação é imediata e sem burocracia!"
6. Quebra de Objeções:
   - Objeção de preço: Mostre a economia brutal de ter usuários ilimitados e WhatsApp sem taxa por mensagem.
   - Objeção de segurança/fidelidade: Destaque que não há fidelidade, não há multa rescisória e pode cancelar ou alterar o plano a qualquer momento.
   - Objeção de teste: Relembre que ele tem 7 dias gratuitos para validar na prática.
7. Coleta de Dados do Lead:
   - Descubra o nome do cliente e da empresa. Use a ferramenta crm_update_contact_custom_fields para salvar as informações comerciais e add_internal_note para registrar o interesse do lead.
8. Encerramento Autônomo:
   - Ao finalizar a negociação ou quando o cliente confirmar que vai acessar o link para contratar, envie uma mensagem calorosa desejando boas-vindas e acione a ferramenta close_chat.`;

export const DIALOGY_COMMERCIAL_ESCALATION_POLICY = `ESTRITAMENTE PROIBIDO TRANSFERIR OU ESCALONAR PARA VENDEDORES HUMANOS.

O agente Dialogy Comercial Virtual é um executivo de vendas de alto nível 100% autônomo, responsável por qualificar o lead, apresentar e recomendar os planos (Essencial R$ 249, Profissional R$ 499, Operação R$ 999 e Enterprise), sanar objeções de preço e conduzir o cliente para a contratação self-service imediata com 7 dias de teste grátis em /register ou /settings/billing. 

O agente nunca deve sugerir transferência, nunca deve pedir para o cliente aguardar contato de vendedor e nunca deve deixar a venda sem o link de contratação.`;

export const DIALOGY_COMMERCIAL_CLOSING_POLICY = `O agente deve conduzir o processo de vendas de forma resolutiva e finalizar a conversa com autonomia quando:
1. O cliente tiver recebido todas as informações do plano ideal, estiver com o link/passo a passo de contratação em mãos e agradecer/confirmar que vai assinar ou testar;
2. O cliente indicar que as dúvidas comerciais foram completamente esclarecidas;
3. O cliente solicitar explicitamente o encerramento da conversa.

Antes de encerrar, envie uma mensagem encorajadora e prestativa, desejando muito sucesso nas vendas da empresa com a Dialogy, e acione a ferramenta close_chat registrando o desfecho comercial positivo.`;

export const DIALOGY_COMMERCIAL_FALLBACK_REPLY = `Estou aqui para te apresentar a melhor solução da Dialogy para o seu negócio! Me conta: quantos atendentes e números de WhatsApp sua equipe tem hoje? Assim te indico o plano exato que vai te dar o melhor resultado com o menor custo.`;

export const DIALOGY_COMMERCIAL_ENABLED_TOOLS = [
  'close_chat',
  'add_internal_note',
  'crm_update_contact_custom_fields',
];

export const DIALOGY_COMMERCIAL_COLLECTIONS: KnowledgeCollection[] = [
  {
    id: 'com-planos-precos',
    name: 'Planos & Tabela de Preços',
    description: 'Preços oficiais, limites de instâncias, chats mensais e recursos de cada plano.',
    color: '#3b82f6',
    isDefault: true,
  },
  {
    id: 'com-como-contratar',
    name: 'Como Contratar & Checkout',
    description: 'Passo a passo de contratação, 7 dias grátis, checkout Stripe e formas de pagamento.',
    color: '#10b981',
  },
  {
    id: 'com-guia-consultivo',
    name: 'Guia Consultivo de Vendas',
    description: 'Qual plano indicar para cada segmento, tamanho de empresa e objetivo de negócio.',
    color: '#f59e0b',
  },
  {
    id: 'com-diferenciais',
    name: 'Diferenciais & Vantagens',
    description: 'Usuários ilimitados, ausência de taxas por mensagem e comparação de mercado.',
    color: '#8b5cf6',
  },
  {
    id: 'com-faq-vendas',
    name: 'FAQ & Objeções Comerciais',
    description: 'Cancelamento sem fidelidade, segurança, pacotes adicionais e dúvidas frequentes.',
    color: '#ec4899',
  },
];

export const DIALOGY_COMMERCIAL_KNOWLEDGE_DOCUMENTS: KnowledgeBaseDocument[] = [
  {
    id: 'c1a10610-0001-4000-8000-000000000001',
    name: 'Tabela Oficial de Preços e Comparativo Completo dos Planos Dialogy',
    category: 'pricing_plans',
    contextRole: 'fact',
    collectionIds: ['com-planos-precos'],
    tags: ['preços', 'planos', 'essencial', 'profissional', 'operação', 'enterprise', 'valores', 'mensalidade'],
    summary: 'Tabela oficial de preços e comparação detalhada de recursos dos planos Essencial (R$ 249), Profissional (R$ 499), Operação (R$ 999) e Enterprise.',
    canonicalAnswer: 'A Dialogy possui 3 planos principais com usuários ilimitados: Essencial (R$ 249/mês para até 2 WhatsApp e 1.000 chats), Profissional (R$ 499/mês para 5 WhatsApp, 5.000 chats, 1 IA Autopilot e CRM) e Operação (R$ 999/mês para 10 WhatsApp, 15.000 chats, 5 IAs Autopilot, Nexus Studio e Copilot). Todos incluem 7 dias de teste grátis!',
    workflowHints: [
      'Apresentar os valores oficiais: Essencial R$ 249, Profissional R$ 499, Operação R$ 999',
      'Enfatizar sempre que TODOS os planos têm USUÁRIOS ILIMITADOS',
      'Destacar os 7 dias de teste grátis',
    ],
    content: `# Tabela Oficial de Preços e Comparativo Completo dos Planos Dialogy

## 1. Visão Geral dos Planos
A Dialogy oferece planos dimensionados para a fase exata de cada empresa, com um diferencial revolucionário no mercado: **TODOS os planos possuem USUÁRIOS ILIMITADOS**. Você nunca paga por atendente ou assento adicional.

---

## 2. Detalhamento dos Planos Oficiais

### 1. Plano Essencial — R$ 249,00 / mês
Ideal para pequenas empresas, consultórios, escritórios e autônomos que desejam centralizar o WhatsApp e organizar o atendimento com múltiplos atendentes.
- **Preço**: **R$ 249,00 / mês** (ou com desconto na opção anual).
- **Atendentes / Operadores**: **ILIMITADOS** (cadastre quantos colaboradores precisar).
- **Conexões de WhatsApp**: **2 instâncias simultâneas** (via Evolution API).
- **Canais de Telegram**: **1 canal**.
- **Limite Mensal de Atendimentos**: **1.000 conversas / mês**.
- **Departamentos / Filas de Atendimento**: 2 departamentos (ex: Atendimento e Geral).
- **Campos Customizados**: Até 3 campos personalizados.
- **Histórico de Mensagens**: 6 meses de retenção completa.
- **Armazenamento de Arquivos/Mídias**: 2 GB inclusos.
- **Recursos Inclusos**: Inbox completo, envio de áudios com player veloz, envio de mídias, notas internas com \`@\`, visualizador de fotos.

---

### 2. Plano Profissional — R$ 499,00 / mês (O MAIS POPULAR)
O plano campeão de vendas! Perfeito para empresas que querem automatizar o atendimento com Inteligência Artificial, disparar campanhas de vendas e gerenciar funil no CRM.
- **Preço**: **R$ 499,00 / mês**.
- **Atendentes / Operadores**: **ILIMITADOS**.
- **Conexões de WhatsApp**: **5 instâncias simultâneas**.
- **Canais de Redes Sociais**: **3 canais Telegram**, **1 Instagram Direct oficial**, **1 Facebook Messenger**.
- **Limite Mensal de Atendimentos**: **5.000 conversas / mês**.
- **Atendentes Inteligentes Autopilot (IA)**: **1 Atendente de IA completo** com inteligência natural LLM 24/7.
- **Base de Conhecimento RAG**: Até 5 documentos ricos indexados neuralmente.
- **Transcrição de Áudio por IA**: Transcrição automática de voz para texto de todos os áudios recebidos.
- **Campanhas de Disparo no WhatsApp**: Até 2 campanhas ativas com intervalo inteligente anti-ban.
- **Pipeline de Vendas / CRM**: Funil Kanban completo com estágios personalizáveis.
- **Campos Customizados e Tags**: **ILIMITADOS**.
- **Departamentos / Filas**: Até 10 equipes com horários de expediente (Business Hours).
- **Histórico e Armazenamento**: 12 meses de histórico e 10 GB de mídias.

---

### 3. Plano Operação / Business — R$ 999,00 / mês
Para operações de alta performance, provedores de internet (ISPs), e-commerces médios/grandes, imobiliárias e clínicas de grande porte que precisam de máxima automação e múltiplos agentes de IA.
- **Preço**: **R$ 999,00 / mês**.
- **Atendentes / Operadores**: **ILIMITADOS**.
- **Conexões de WhatsApp**: **10 instâncias simultâneas**.
- **Canais de Redes Sociais**: **5 Telegram**, **3 Instagram Direct**, **3 Facebook Messenger**.
- **Limite Mensal de Atendimentos**: **15.000 conversas / mês**.
- **Atendentes Inteligentes Autopilot (IA)**: **Até 5 Atendentes de IA simultâneos** (ex: Suporte, Vendas, Financeiro, Cobrança).
- **Base de Conhecimento RAG**: Até 50 documentos vetoriais indexados.
- **Nexus Flow Studio**: Acesso total ao construtor visual de fluxos de conversação em nós (canvas).
- **AI Copilot no Inbox**: Sugestões automáticas de respostas em tempo real para todos os atendentes humanos.
- **Campanhas de Disparo no WhatsApp**: **ILIMITADAS**.
- **Analytics Completo com Exportação**: Relatórios completos de TMR, TMA, produtividade e exportação de dados.
- **Acesso à API Oficial e Webhooks**: Portal do Desenvolvedor, Webhook Dispatcher para integrar com qualquer ERP/sistema externo.
- **Lead Scoring & Case Memory**: Inteligência de qualificação automática de leads e memória de casos.
- **Departamentos e Filas**: **ILIMITADOS**.
- **Histórico e Armazenamento**: 24 meses de histórico e 50 GB de armazenamento.

---

### 4. Plano Enterprise — Solução Corporativa (Sob Consulta)
- Para grandes redes, franquias e corporações com volumes acima de 50.000 conversas mensais, necessidade de instâncias dedicadas, servidores isolados em nuvem e SLA contratual com gerente de contas exclusivo.`,
  },
  {
    id: 'c1a10610-0002-4000-8000-000000000002',
    name: 'Guia Consultivo: Qual o Plano Ideal para Cada Perfil de Empresa?',
    category: 'sales_consulting',
    contextRole: 'procedure',
    collectionIds: ['com-guia-consultivo'],
    tags: ['escolha de plano', 'consultoria', 'recomendação', 'perfil de cliente', 'qualificação'],
    summary: 'Como diagnosticar a necessidade do cliente e recomendar com convicção o plano perfeito da Dialogy com base em tamanho da equipe, canais e objetivos de automação.',
    canonicalAnswer: 'Para equipes pequenas que querem só centralizar o WhatsApp: Plano Essencial (R$ 249). Para quem precisa de IA atendendo 24/7, CRM e campanhas: Plano Profissional (R$ 499). Para provedores, operações médias e múltiplos robôs de IA com Nexus Studio: Plano Operação (R$ 999).',
    workflowHints: [
      'Perguntar sobre quantidade de números de WhatsApp e tamanho da equipe',
      'Perguntar se precisa de IA atendendo ou disparos em massa',
      'Apresentar a recomendação com justificativa clara',
    ],
    content: `# Guia Consultivo: Qual o Plano Ideal para Cada Perfil de Empresa?

## 1. Como Avaliar a Necessidade do Cliente

### Perfil 1: "Preciso apenas organizar meus atendentes em 1 ou 2 números de WhatsApp"
- **Necessidade**: A empresa tem 3 a 10 atendentes respondendo pelo WhatsApp Web normal, com mensagens perdidas, desencontro de informações e lentidão.
- **Recomendação Ideal**: **Plano Essencial (R$ 249,00 / mês)**.
- **Argumento de Venda**:
  - *"O plano Essencial resolve perfeitamente essa dor! Você conecta até 2 números de WhatsApp, cadastra todos os seus atendentes sem custo adicional (usuários ilimitados) e cada um responde no seu próprio login. Chega de celular passando de mão em mão!"*

---

### Perfil 2: "Quero vender mais, ter IA atendendo quando a equipe estiver fora e disparar promoções"
- **Necessidade**: Empresas de comércio, serviços, imobiliárias ou clínicas que perdem vendas fora do horário comercial e querem prospecção ativa via WhatsApp.
- **Recomendação Ideal**: **Plano Profissional (R$ 499,00 / mês)**.
- **Argumento de Venda**:
  - *"O plano Profissional foi feito sob medida para vendas! Você ganha 1 Atendente Inteligente de IA que atende 24 horas por dia, responde dúvidas sobre seus produtos usando a Base de Conhecimento, transcreve áudios de clientes e ainda conta com o Funil do CRM para acompanhar cada negócio até o fechamento. Além disso, você pode disparar campanhas de WhatsApp para sua base de clientes com proteção anti-ban!"*

---

### Perfil 3: "Sou provedor de internet (ISP) ou empresa com grande fluxo e múltiplos setores"
- **Necessidade**: Operações complexas com setores separados (Comercial, Suporte Fibra N1/N2, Financeiro, Cobrança), alto volume de chats (mais de 5.000/mês) e necessidade de fluxos visuais em árvore ou integração via API/SGP.
- **Recomendação Ideal**: **Plano Operação (R$ 999,00 / mês)**.
- **Argumento de Venda**:
  - *"Para a sua estrutura, o plano Operação é o padrão ouro! Ele suporta até 10 conexões de WhatsApp, 15.000 chats mensais e permite colocar até 5 Atendentes de IA especializados trabalhando juntos (um no Comercial, outro no Suporte e outro na Cobrança). Inclui o Nexus Flow Studio para desenhar árvores visuais de atendimento, Copilot com IA para ajudar os atendentes humanos e acesso completo à API para integração com seu ERP!"*`,
  },
  {
    id: 'c1a10610-0003-4000-8000-000000000003',
    name: 'Como Contratar e Ativação Instantânea com 7 Dias de Teste Grátis',
    category: 'checkout_subscription',
    contextRole: 'procedure',
    collectionIds: ['com-como-contratar'],
    tags: ['contratação', 'como contratar', 'teste grátis', 'trial', 'checkout', 'stripe', 'cadastro', 'link'],
    summary: 'Instruções passo a passo de como o cliente realiza o cadastro self-service, ativa os 7 dias de teste grátis e finaliza a assinatura de qualquer plano na Dialogy.',
    canonicalAnswer: 'Para contratar, basta acessar https://dialogy.com.br/register, criar sua conta em 1 minuto e escolher seu plano. Você ganha 7 dias de teste grátis para testar todas as funcionalidades na prática. A assinatura é realizada diretamente pelo painel com cartão de crédito via Stripe, sem burocracia.',
    workflowHints: [
      'Fornecer o link direto de cadastro: https://dialogy.com.br/register',
      'Explicar o período de 7 dias grátis',
      'Explicar o processo de checkout seguro via Stripe em /settings/billing',
    ],
    content: `# Como Contratar e Ativação Instantânea com 7 Dias de Teste Grátis

## 1. O Processo de Contratação da Dialogy
A contratação na Dialogy é **100% digital, rápida e desburocratizada**. O cliente não precisa esperar propostas comerciais por e-mail ou reuniões demoradas: ele pode criar a conta e começar a usar hoje mesmo.

---

## 2. Passo a Passo para Novos Clientes (Como Contratar)

### Passo 1: Cadastro Gratuito
- Acesse o link oficial de registro: **https://dialogy.com.br/register** (ou rota \`/register\`).
- Preencha:
  - **Nome Completo**
  - **E-mail Corporativo ou Pessoal**
  - **Senha de Acesso Segura**
- Clique em **"Criar Conta"**. O acesso ao sistema é liberado na hora!

### Passo 2: Criação do seu Workspace
- Ao entrar, informe o **Nome da sua Empresa** para criar seu espaço de trabalho exclusivo.
- Você já estará dentro do painel completo da Dialogy.

### Passo 3: Escolha do Plano e Ativação do Teste Grátis
- Acesse a tela de planos em **https://dialogy.com.br/pricing** ou dentro do painel em **Configurações > Faturamento e Planos** (\`/settings/billing\`).
- Selecione o plano que melhor atende à sua empresa:
  - **Essencial** (R$ 249/mês)
  - **Profissional** (R$ 499/mês)
  - **Operação** (R$ 999/mês)
- **7 Dias de Teste Grátis (Trial)**:
  - Você tem **7 dias totalmente gratuitos** para conectar seu WhatsApp, cadastrar sua equipe e validar a operação na prática sem pagar nada antecipadamente!

### Passo 4: Assinatura Segura com Stripe
- O processamento da assinatura é feito com a tecnologia de pagamentos global **Stripe**, com criptografia de ponta a ponta.
- Formas de pagamento aceitas: **Cartão de Crédito** (principais bandeiras: Visa, Mastercard, Elo, American Express, Hipercard).
- A renovação é mensal e transparente, com recibos e faturas fiscais disponíveis para download direto no painel em \`/settings/billing\`.

---

## 3. Clientes que Já Possuem Conta no Dialogy
Se você já possui uma conta ativa e deseja assinar ou fazer upgrade de plano:
1. Faça login na sua conta da Dialogy.
2. Na barra lateral esquerda (Sidebar), clique no seu **Avatar de Perfil** no rodapé.
3. Selecione a opção **Faturamento / Planos** (rota: \`/settings/billing\`).
4. Escolha o novo plano desejado e clique em **"Assinar / Fazer Upgrade"**.
5. Os novos limites e recursos são liberados no mesmo segundo!`,
  },
  {
    id: 'c1a10610-0004-4000-8000-000000000004',
    name: 'Diferenciais Competitivos da Dialogy: Por que Escolher a Dialogy?',
    category: 'competitive_advantages',
    contextRole: 'fact',
    collectionIds: ['com-diferenciais'],
    tags: ['diferenciais', 'vantagens', 'usuários ilimitados', 'concorrentes', 'custo-benefício', 'sem taxas'],
    summary: 'Os principais argumentos e diferenciais competitivos da Dialogy: usuários ilimitados em todos os planos, ausência de taxas abusivas por mensagem, IA generativa RAG e robustez.',
    canonicalAnswer: 'O principal diferencial da Dialogy é oferecer USUÁRIOS ILIMITADOS em todos os planos sem cobrar por atendente adicional. Além disso, não cobramos taxa por mensagem enviada/recebida, temos IA com busca semântica RAG que não alucina, transcrição de áudios e Nexus Flow Studio.',
    workflowHints: [
      'Destacar o diferencial de usuários ilimitados comparado a concorrentes',
      'Mencionar a ausência de cobrança por mensagem trocada',
      'Explicar a IA generativa com RAG nativo e sem alucinações',
    ],
    content: `# Diferenciais Competitivos da Dialogy: Por que Escolher a Dialogy?

## 1. Usuários e Atendentes Ilimitados (Economia Imbatível)
- **O Mercado Tradicional**: A grande maioria das plataformas concorrentes (como RD Station, Z-API, Huggy, Zenvia, Chatwoot gerenciado) cobra entre R$ 50 a R$ 150 por cada atendente adicional que você coloca na plataforma. Se você tem 10 atendentes, sua fatura passa facilmente de R$ 1.000 a R$ 2.000 por mês.
- **Na Dialogy**: **TODOS os planos possuem usuários ilimitados**. Se você tem 3, 15, 50 ou 100 atendentes na sua empresa, o valor da sua mensalidade é exatamente o mesmo. Sua empresa cresce sem ser penalizada na fatura.

---

## 2. Sem Taxa por Mensagem Enviada ou Recebida
- Conectando seu WhatsApp via Evolution API na Dialogy, você pode trocar milhares de mensagens diárias com seus clientes sem qualquer cobrança por mensagem enviada ou recebida. O custo do software é fixo e previsível no final do mês.

---

## 3. Inteligência Artificial com RAG Real (Sem Alucinações)
- Enquanto outros sistemas utilizam chatbots engessados que apenas respondem "digite 1 para financeiro e 2 para suporte" ou IAs genéricas que inventam respostas erradas:
- A Dialogy possui motor nativo de **RAG (Retrieval-Augmented Generation)** com modelo neural de embeddings BGE-M3 de 1024 dimensões. A IA lê os procedimentos reais da sua empresa e responde com precisão cirúrgica de um especialista humano.

---

## 4. Transcrição Automática de Áudio de Clientes por IA
- O cliente manda um áudio de 2 minutos no WhatsApp e seu operador lê o texto transcrito em 3 segundos direto no Inbox. Agiliza o tempo de resposta em até 70% e evita barulho no escritório.

---

## 5. Plataforma Omnichannel Completa em Um Só Lugar
- Em vez de contratar um sistema para WhatsApp, outro para CRM, outro para disparar campanhas e outro para criar robôs: a Dialogy entrega **Inbox Omnichannel + CRM Kanban + Campanhas Anti-Ban + Construtor Visual Nexus Flow + Analytics** integrados em uma única tela.`,
  },
  {
    id: 'c1a10610-0005-4000-8000-000000000005',
    name: 'Pacotes Adicionais, Canais Extras e Políticas Comerciais',
    category: 'add_ons_policies',
    contextRole: 'fact',
    collectionIds: ['com-planos-precos', 'com-faq-vendas'],
    tags: ['adicionais', 'extras', 'chats excedentes', 'canais extras', 'copilot extra', 'upgrade'],
    summary: 'Valores de pacotes extras da Dialogy: pacote de chats excedentes, canais adicionais de WhatsApp e ativação do AI Copilot.',
    canonicalAnswer: 'Você pode expandir qualquer plano com adicionais sob demanda: pacote extra de +500 chats/mês por R$ 99, canal extra de WhatsApp/rede social por R$ 39/mês e IA Copilot no Inbox por R$ 149/mês.',
    workflowHints: [
      'Explicar os preços dos add-ons: +500 chats por R$ 99, canal extra por R$ 39, IA Copilot por R$ 149',
      'Explicar que é possível fazer upgrade de plano a qualquer momento',
    ],
    content: `# Pacotes Adicionais, Canais Extras e Políticas Comerciais

## 1. Pacotes Adicionais Sob Demanda (Add-ons)
Se a sua empresa contratou um plano e precisa de recursos extras sem necessariamente pular para o plano superior, você pode contratar pacotes adicionais diretamente pelo painel:

| Adicional | Valor Mensal | Descrição |
|---|---|---|
| **Pacote de +500 Chats** | **R$ 99,00 / mês** | Adiciona 500 atendimentos extras à cota mensal do workspace. |
| **Canal Extra (Conexão Adicional)** | **R$ 39,00 / mês** | Permite conectar +1 número de WhatsApp ou rede social adicional. |
| **Módulo AI Copilot no Inbox** | **R$ 149,00 / mês** | Habilita sugestões de respostas inteligentes com IA para o time humano. |

---

## 2. O que Acontece se Ultrapassar o Limite de Chats do Plano?
- A Dialogy nunca corta o atendimento abruptamente deixando seus clientes sem resposta.
- O sistema avisa os administradores com antecedência ao atingir 80% e 100% da cota.
- Você pode optar por adicionar um pacote avulso de chats ou fazer upgrade para o plano seguinte com desconto proporcional.

---

## 3. Flexibilidade Total de Upgrade e Downgrade
- Você pode mudar de plano a qualquer momento diretamente pelo painel em \`/settings/billing\`.
- Ao fazer um upgrade, o novo limite é liberado imediatamente e a cobrança é calculada proporcionalmente aos dias restantes do ciclo (pro-rata).`,
  },
  {
    id: 'c1a10610-0006-4000-8000-000000000006',
    name: 'FAQ Comercial: Dúvidas Frequentes, Cancelamento e Segurança',
    category: 'faq_sales',
    contextRole: 'fact',
    collectionIds: ['com-faq-vendas'],
    tags: ['faq', 'dúvidas comerciais', 'cancelamento', 'fidelidade', 'segurança', 'nota fiscal', 'suporte'],
    summary: 'Perguntas frequentes do setor comercial da Dialogy: cancelamento a qualquer momento sem multa, emissão de nota fiscal, suporte e segurança dos dados.',
    canonicalAnswer: 'A Dialogy não possui fidelidade ou carência: você pode cancelar a qualquer momento sem multa. A contratação inclui 7 dias de teste grátis, notas fiscais emitidas mensalmente, dados protegidos com criptografia e suporte técnico dedicado.',
    workflowHints: [
      'Reforçar ausência de fidelidade e multas',
      'Explicar que notas fiscais e recibos ficam em /settings/billing',
      'Destacar o teste grátis de 7 dias como garantia',
    ],
    content: `# FAQ Comercial: Dúvidas Frequentes, Cancelamento e Segurança

## 1. Existe fidelidade ou contrato com carência mínima?
- **Não há fidelidade!**
- Nossos planos mensais operam no modelo SaaS por assinatura. Você pode cancelar quando quiser diretamente no painel em \`/settings/billing\` sem pagar nenhuma multa rescisória.

---

## 2. Como funciona o Teste Grátis de 7 Dias?
- Todo novo cliente cadastrado tem direito a **7 dias de teste grátis** para explorar as funcionalidades do plano selecionado.
- Durante os 7 dias, você conecta seu WhatsApp, adiciona atendentes e atende clientes reais para certificar-se de que a plataforma atende perfeitamente à sua rotina.

---

## 3. Emitem Nota Fiscal (NF-e)?
- **Sim!**
- Todas as assinaturas geram recibos e notas fiscais de prestação de serviços de software correspondentes aos pagamentos efetuados, com download automático disponível em \`/settings/billing\`.

---

## 4. Meus dados e conversas estão seguros?
- Sim, segurança é prioridade na Dialogy.
- Toda a comunicação é protegida por criptografia SSL/TLS em trânsito e criptografia de ponta a ponta no banco de dados.
- O workspace da sua empresa é completamente isolado (arquitetura multi-tenant com segurança RLS no PostgreSQL), garantindo que apenas os membros autorizados por você acessem as informações.

---

## 5. Como o cliente deve proceder para contratar agora?
- Basta acessar **https://dialogy.com.br/register**.
- O cadastro leva menos de 2 minutos.
- Em seguida, acesse \`/settings/billing\` e escolha o plano desejado para iniciar seu teste gratuito!`,
  },
];
