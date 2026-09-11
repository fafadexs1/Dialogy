import type { KnowledgeBaseDocument, KnowledgeCollection } from '../src/lib/types';

export const DIALOGY_WORKSPACE_ID = '5c3a91e9-b243-4436-80ba-42434bc5ca97';
export const DIALOGY_AUTOPILOT_CONFIG_ID = '5f55a62d-a34a-4f61-81dc-28a2f52b145a';
export const DIALOGY_SYSTEM_AGENT_ID = '3715bd42-f36d-4ea3-893b-c1b2bf81cf32';

export const DIALOGY_SUPPORT_SYSTEM_PROMPT = `Você é o "Dialogy Suporte Virtual", o especialista e assistente oficial de suporte técnico e operacional da plataforma Dialogy.

Sua missão é ajudar os usuários a dominar cada funcionalidade da plataforma, ensinando exatamente como navegar, como configurar e como resolver qualquer dúvida ou problema operacional.

DIRETRIZES DE ATENDIMENTO:
1. Sempre seja cordial, claro, técnico porém didático, prestativo e profissional.
2. Instruções de "Como Chegar": Sempre que o usuário perguntar onde fica algo ou como acessar determinada tela, forneça o caminho exato pela interface (ex: "Para acessar isso, vá no menu lateral esquerdo na Sidebar e clique em...").
3. Fundamentação em Fatos: Utilize as informações da Base de Conhecimento RAG para fornecer respostas precisas e atualizadas sobre Inbox, CRM, Campanhas, Nexus Studio, Autopilot, Integrações (WhatsApp/Evolution, Telegram, Instagram, IA, MCP, Webchat, SGP), Equipes e Configurações.
4. Explicação de "Como Funciona": Detalhe as opções disponíveis na tela, o comportamento esperado do sistema e as melhores práticas.
5. Resolução de Problemas: Forneça passos práticos de verificação e solução (troubleshooting) quando o usuário relatar erros ou dificuldades.
6. Transbordo Humano: Se o usuário expressar que precisa falar diretamente com um atendente humano da Dialogy ou desejar abrir um chamado oficial, oriente-o a acessar a Central de Ajuda em "/support" no menu de conta ou utilize a transferência se estiver disponível.`;

export const DIALOGY_COLLECTIONS: KnowledgeCollection[] = [
  {
    id: 'navegacao-geral',
    name: 'Navegação & Geral',
    description: 'Visão geral da plataforma, sidebar, temas, idiomas e workspaces.',
    color: '#3b82f6',
    isDefault: true,
  },
  {
    id: 'inbox-atendimento',
    name: 'Inbox & Atendimento',
    description: 'Chat omnichannel, mensagens, áudio com transcrição, mídias, notas internas e copilot.',
    color: '#10b981',
  },
  {
    id: 'crm-vendas',
    name: 'CRM & Funil de Vendas',
    description: 'Kanban de oportunidades, estágios, automações de vendas e métricas.',
    color: '#f59e0b',
  },
  {
    id: 'campanhas-disparos',
    name: 'Campanhas & Disparos',
    description: 'Disparos de mensagens em massa no WhatsApp, segmentação e regras anti-ban.',
    color: '#ec4899',
  },
  {
    id: 'automacao-nexus',
    name: 'Automação & Nexus Flow',
    description: 'Nexus Flow Studio visual em nós, atendentes inteligentes e robôs.',
    color: '#8b5cf6',
  },
  {
    id: 'integracoes-canais',
    name: 'Integrações & Canais',
    description: 'WhatsApp Evolution API, Telegram, Instagram, Messenger, Provedores de IA, MCP e Webchat.',
    color: '#06b6d4',
  },
  {
    id: 'provedores-sgp',
    name: 'Integração SGP & ERPs',
    description: 'Consulta de contratos, faturas, Pix Copia e Cola e desbloqueio em confiança.',
    color: '#14b8a6',
  },
  {
    id: 'equipes-permissoes',
    name: 'Equipes & Permissões',
    description: 'Departamentos, filas de atendimento, horários de expediente e níveis de acesso.',
    color: '#6366f1',
  },
  {
    id: 'configuracoes-contas',
    name: 'Configurações & Conta',
    description: 'Configurações de workspace, perfil de usuário, planos Stripe, atalhos e suporte.',
    color: '#64748b',
  },
];

export const DIALOGY_KNOWLEDGE_DOCUMENTS: KnowledgeBaseDocument[] = [
  {
    id: 'd1a10610-0001-4000-8000-000000000001',
    name: 'Guia Geral de Navegação e Interface da Plataforma Dialogy',
    category: 'platform_navigation',
    contextRole: 'fact',
    collectionIds: ['navegacao-geral'],
    tags: ['navegação', 'interface', 'sidebar', 'tema', 'idioma', 'workspace', 'menu'],
    summary: 'Instruções completas sobre a estrutura visual da plataforma Dialogy, menus da Sidebar, alternador de workspaces, temas claro/escuro e troca de idiomas.',
    canonicalAnswer: 'A navegação na Dialogy é realizada pela Sidebar lateral esquerda. Nela você encontra os hubs: Inbox (/inbox), Clientes & Vendas (/crm, /campaigns, /analytics), Automação (/nexus, /automations/robots), Integrações (/integrations), Equipe & Acesso (/team) e o menu de Conta no rodapé para alternar temas, idiomas e configurações do workspace.',
    workflowHints: [
      'Orientar o usuário a localizar a barra lateral esquerda (Sidebar)',
      'Explicar o alternador de workspaces no topo e o menu de conta no rodapé',
      'Descrever a troca de temas claro/escuro e idiomas',
    ],
    content: `# Guia Geral de Navegação e Interface da Plataforma Dialogy

## 1. Visão Geral da Interface
A interface da plataforma Dialogy foi projetada para alta produtividade em atendimento ao cliente e gestão de vendas. O layout é dividido em:
- **Barra Lateral Esquerda (Sidebar)**: Acesso rápido e permanente a todos os módulos da plataforma através de ícones funcionais e menus suspensos (flyouts).
- **Painel Central**: Onde o módulo selecionado é exibido (ex: Inbox com conversas ativas, Funil Kanban no CRM, Canvas do Nexus Studio).
- **Painel Lateral Direito (Opcional / Contextual)**: Utilizado no Inbox para exibir detalhes do contato (Contact Panel), campos do CRM, notas operacionais e integrações ERP.

## 2. Como Navegar pelos Menus da Sidebar
A Sidebar fica fixa à esquerda da tela e organiza as ferramentas em 6 seções principais:

### 1. Inbox (Atendimento Primário)
- **Como chegar**: Clique no ícone de **Caixa de Entrada (Inbox)** no topo da Sidebar ou acesse a rota direta \`/inbox\`.
- **Finalidade**: Central omnichannel de conversas ativas, envio de áudios, transcrições por IA, notas internas e transferência de chamados.

### 2. Clientes & Vendas (Flyout)
- **Como chegar**: Clique no ícone de **Contatos / Prancheta** na Sidebar para abrir o menu:
  - **CRM** (\`/crm\`): Funil de vendas Kanban, movimentação de oportunidades, automações de vendas e métricas.
  - **Campanhas** (\`/campaigns\`): Criação e acompanhamento de disparos em massa via WhatsApp com cadência anti-bloqueio.
  - **Analytics** (\`/analytics\`): Relatórios de tempo de resposta (TMR), tempo de atendimento (TMA) e produtividade da equipe.

### 3. Automação & Inteligência (Flyout)
- **Como chegar**: Clique no ícone de **Faísca / Sparkles** na Sidebar:
  - **Nexus** (\`/nexus\`): Editor visual de fluxos de conversação baseado em nós interativos (canvas).
  - **Robôs / Atendentes** (\`/automations/robots\`): Cadastro e gestão de Atendentes Inteligentes (IA/Autopilot), Robôs Padrão (Webhooks/n8n/Typebot) e Marketing.

### 4. Integrações (Flyout)
- **Como chegar**: Clique no ícone de **Grade / Cabos (Integrations)**:
  - **Catálogo de Integrações** (\`/integrations\`): Visão geral de todas as integrações disponíveis.
  - **WhatsApp** (\`/integrations/evolution-api\`): Conexão e leitura de QR Code da Evolution API.
  - **Provedores de IA** (\`/integrations/ai\`): Chaves e modelos OpenAI, Gemini, Claude, DeepSeek, Groq e modelos locais.
  - **MCP** (\`/integrations/mcp\`): Conexão de servidores do Model Context Protocol para estender capacidades das IAs.
  - **Mercado Livre** (\`/integrations/mercadolivre\`): Perguntas e mensagens pós-venda integradas.
  - **Outros canais**: Telegram (\`/integrations/telegram\`), Instagram Direct (\`/integrations/meta-instagram\`), Messenger (\`/integrations/meta-messenger\`), Webchat para sites (\`/integrations/webchat\`) e ERP SGP (\`/integrations/sgp\`).

### 5. Equipe & Acesso (Flyout)
- **Como chegar**: Clique no ícone de **Usuários (Team)** na Sidebar:
  - **Equipes / Departamentos** (\`/team\`): Filas de atendimento, horários de expediente e mensagens de fora de horário.
  - **Membros** (\`/team/members\`): Convite e gestão de operadores e supervisores.
  - **Permissões** (\`/team/permissions\`): Regras de privilégios de acesso.
  - **Comunidade** (\`/comunidade\`): Canal interno de avisos e discussões.

### 6. Conta, Configurações e Rodapé
- **Como chegar**: No rodapé inferior da Sidebar, clique no seu **Avatar de Perfil**:
  - **Perfil** (\`/settings/profile\`): Alteração de nome, foto, senha, idioma e tema.
  - **Configurações do Workspace** (\`/settings/workspace\`): Fuso horário, nome da empresa, templates de mensagens.
  - **Faturamento e Planos** (\`/settings/billing\`): Detalhes da assinatura Stripe e limites de uso.
  - **Indicações** (\`/referrals\`): Programa de benefícios e parcerias.
  - **Suporte** (\`/support\`): Central de abertura de tickets com o time de suporte da Dialogy.

## 3. Alternador de Workspaces (Multi-Empresa)
- No topo da Sidebar, clique no logotipo/nome da empresa atual para abrir a lista de Workspaces em que você possui acesso.
- Você pode alternar instantaneamente entre empresas sem precisar deslogar ou trocar de usuário.

## 4. Troca de Tema (Claro / Escuro)
- Para alterar entre o Modo Claro (Light) e Modo Escuro (Dark):
  - Abra o menu de Conta clicando no seu avatar no rodapé da Sidebar.
  - Acesse \`/settings/profile\` e selecione o tema de sua preferência, ou utilize o alternador rápido quando disponível na barra superior.

## 5. Troca de Idioma
- A plataforma suporta **Português (Brasil)**, **Inglês (Estados Unidos)** e **Espanhol (Espanha)**.
- Para alterar o idioma: acesse o menu de conta no rodapé da Sidebar > \`/settings/profile\` > Seletor de Idioma. Toda a interface e mensagens do sistema se adaptarão automaticamente.`,
  },
  {
    id: 'd1a10610-0002-4000-8000-000000000002',
    name: 'Manual do Inbox: Operação de Atendimento e Chat Omnichannel',
    category: 'inbox_attendance',
    contextRole: 'procedure',
    collectionIds: ['inbox-atendimento'],
    tags: ['inbox', 'chat', 'atendimento', 'filtros', 'conversas', 'mensagens', 'omnichannel'],
    summary: 'Como operar o Inbox da Dialogy, gerenciar conversas ativas, aplicar filtros por equipe e tags, buscar clientes e responder em tempo real.',
    canonicalAnswer: 'Para acessar o Inbox, clique no ícone de caixa de entrada no topo da barra lateral esquerda (/inbox). Use as abas superiores para filtrar conversas entre "Meus", "Todos", "Filas", "Aguardando" e "Resolvidos", ou filtre por tags e canais de origem.',
    workflowHints: [
      'Indicar acesso ao /inbox',
      'Explicar o funcionamento das abas de filtragem (Meus, Todos, Filas, Aguardando, Resolvidos)',
      'Explicar o fluxo de envio e visualização de mensagens',
    ],
    content: `# Manual do Inbox: Operação de Atendimento e Chat Omnichannel

## 1. O que é o Inbox?
O Inbox é o coração operacional da Dialogy. É onde convergem todas as mensagens originadas do WhatsApp, Telegram, Instagram Direct, Facebook Messenger e Webchat do site em uma única caixa de entrada limpa, ágil e em tempo real.

## 2. Como Chegar ao Inbox
- Clique no ícone de **Inbox (Caixa de Entrada)** no topo da barra lateral esquerda da tela.
- Rota direta no navegador: \`/inbox\` (ou \`/inbox/[chatId]\` para uma conversa específica).

## 3. Estrutura e Abas de Filtragem de Conversas
Na coluna de conversas à esquerda do Inbox, você tem controle total da fila através das abas de navegação:
- **Meus**: Exibe apenas os atendimentos que estão formalmente atribuídos ao seu usuário.
- **Todos**: Mostra todas as conversas do workspace que o seu nível de permissão autoriza visualizar.
- **Filas / Equipes**: Agrupa os atendimentos pendentes nas filas de cada setor (ex: Comercial, Suporte, Financeiro).
- **Aguardando**: Conversas onde o cliente enviou mensagem e está aguardando retorno humano (não assumidas ainda).
- **Resolvidos / Encerrados**: Histórico de atendimentos finalizados. Permite consultar conversas anteriores ou reabrir se o cliente enviar nova mensagem.

## 4. Barra de Busca e Filtro por Tags
- **Busca por Texto**: No campo de busca no topo da lista de conversas, digite o nome do contato, número de telefone com DDD ou trecho da mensagem para localizar conversas instantaneamente.
- **Filtro por Tags (Etiquetas)**: Clique no seletor de tags para isolar apenas conversas com tags específicas (ex: "Lead Quente", "Problema de Conexão", "Prioridade Alta").
- **Filtro por Canal**: Visualize apenas conversas de uma determinada instância de WhatsApp, Instagram ou Telegram.

## 5. Como Assumir e Conduzir um Atendimento
1. Na lista de conversas, clique sobre o contato para carregar a conversa no painel central.
2. Se a conversa estiver sem atendente ou com robô/IA, clique no botão **"Assumir Atendimento"** no topo da tela para atribuí-la ao seu operador.
3. O status do atendimento é atualizado para toda a equipe, evitando que dois operadores respondam ao mesmo cliente ao mesmo tempo.
4. Digite a resposta na barra de digitação (Composer) e tecle **Enter** ou clique no botão de envio.`,
  },
  {
    id: 'd1a10610-0003-4000-8000-000000000003',
    name: 'Áudio, Transcrição com IA e Envio de Mídias no Inbox',
    category: 'inbox_media',
    contextRole: 'procedure',
    collectionIds: ['inbox-atendimento'],
    tags: ['áudio', 'transcrição', 'voz', 'mídias', 'fotos', 'vídeos', 'documentos', 'pdf', 'player'],
    summary: 'Procedimentos de gravação e envio de áudios, reprodução com controle de velocidade, transcrição automática de voz para texto por IA e envio de arquivos no Inbox.',
    canonicalAnswer: 'No Inbox (/inbox), grave áudios segurando o ícone de microfone no composer. Áudios recebidos de clientes possuem player com velocidade ajustável (1x, 1.5x, 2x) e transcrição automática por IA logo abaixo do balão. Para anexar fotos, vídeos ou PDFs, clique no ícone de clipe no composer.',
    workflowHints: [
      'Orientar o uso do microfone no composer para gravar áudio',
      'Explicar o player com velocidades 1x/1.5x/2x',
      'Ressaltar a transcrição automática de áudio recebido',
      'Descrever o envio de arquivos e fotos com visualizador integrado',
    ],
    content: `# Áudio, Transcrição com IA e Envio de Mídias no Inbox

## 1. Gravação e Envio de Mensagens de Áudio
Para gravar áudio no Inbox:
1. No canto inferior direito da barra de digitação (Composer), localize o ícone de **Microfone**.
2. Clique no ícone de microfone para iniciar a gravação. O navegador solicitará permissão de microfone no primeiro uso (certifique-se de permitir).
3. Durante a gravação, uma barra de onda sonora e o cronômetro serão exibidos.
4. Você pode:
   - **Ouvir antes de enviar**: Pausar a gravação e reproduzir para conferir o áudio.
   - **Cancelar**: Clicar na lixeira ou no botão cancelar para descartar.
   - **Enviar**: Clicar no botão de envio (avião de papel) para enviar imediatamente ao cliente.

## 2. Player de Áudio Avançado e Controle de Velocidade
- Todos os áudios recebidos ou enviados possuem um player moderno integrado.
- **Controle de Velocidade**: Clique no botão de velocidade para alternar entre **1x**, **1.5x** e **2x**, permitindo escutar áudios longos na metade do tempo.
- **Barra de Progresso Arrastável**: Arraste o ponto da reprodução para o segundo exato que deseja ouvir.

## 3. Transcrição Automática de Áudios por IA
- Quando um cliente envia um áudio via WhatsApp ou Telegram, o Dialogy processa o áudio através de inteligência artificial de transcrição.
- A transcrição em texto aparece **diretamente abaixo do player de áudio**.
- **Benefício**: Os atendentes e o Copilot de IA podem ler a dúvida do cliente em segundos sem precisar tocar o som no ambiente de trabalho.
- O histórico de texto transcrito também é indexado para que você encontre a conversa através da barra de busca de texto.

## 4. Envio de Imagens, Vídeos e Documentos (PDF, DOCX, XLSX)
1. Na barra de digitação, clique no ícone de **Clipe de Papel** ou de **Imagem**.
2. Selecione o arquivo no seu computador (ou simplesmente arraste e solte o arquivo direto na tela do chat).
3. Uma tela de pré-visualização abrirá permitindo:
   - Visualizar a imagem ou documento.
   - Adicionar uma legenda de texto explicativa.
   - Utilizar o editor de imagens embutido para cortar, rotacionar ou ajustar antes do envio.
4. Clique em **Enviar**. O arquivo será entregue instantaneamente no WhatsApp/canal do cliente.`,
  },
  {
    id: 'd1a10610-0004-4000-8000-000000000004',
    name: 'Notas Internas, Transferência de Atendimento e Encerramento de Chat',
    category: 'inbox_collaboration',
    contextRole: 'procedure',
    collectionIds: ['inbox-atendimento'],
    tags: ['nota interna', 'transferência', 'encerramento', 'fechamento', 'protocolo', 'colaboração'],
    summary: 'Instruções para registrar notas internas confidenciais no chat, transferir conversas entre atendentes ou equipes e encerrar o atendimento com tags de motivo.',
    canonicalAnswer: 'Para criar uma nota interna, digite "@" no início da mensagem ou alterne para a aba "Nota Interna". Para transferir, clique no botão de transferência no topo da conversa e selecione a equipe ou operador. Para encerrar, clique em "Encerrar Atendimento" no topo direito, selecione o motivo e confirme.',
    workflowHints: [
      'Explicar que notas com @ são visíveis apenas para a equipe interna e nunca para o cliente',
      'Descrever a transferência por fila ou atendente com nota explicativa',
      'Descrever o modal de encerramento com seleção de tag de motivo',
    ],
    content: `# Notas Internas, Transferência de Atendimento e Encerramento de Chat

## 1. Notas Internas (Comunicação Confidencial da Equipe)
As notas internas permitem que a equipe colabore dentro da própria conversa sem que o cliente veja nada.

### Como criar uma Nota Interna:
- **Método 1 (Atalho Rápido)**: No campo de digitação, comece a mensagem com o caractere \`@\` (ex: \`@Cliente informou que vai pagar amanhã cedo\`). O campo de texto mudará de cor indicando o modo de nota.
- **Método 2 (Aba do Composer)**: Acima da barra de digitação, clique na aba **"Nota Interna"**.
- O balão de nota interna possui fundo amarelo/destacado com ícone de cadeado.
- **Segurança Absoluta**: O cliente no WhatsApp/canal externo NUNCA recebe essa mensagem. Ela fica visível exclusivamente no painel da Dialogy para os operadores e supervisores.

## 2. Transferência de Atendimento entre Atendentes e Filas
Quando um atendimento precisa ser encaminhado para outro setor ou especialista:
1. No topo da conversa ativa, clique no botão de **Transferir Atendimento** (ícone de duas setas ou usuário com seta).
2. Uma janela suspensa se abrirá com duas opções:
   - **Transferir para Equipe / Fila**: Selecione a fila de destino (ex: *Suporte Técnico*, *Financeiro*, *Vendas*). O atendimento ficará disponível para qualquer operador online daquele setor.
   - **Transferir para Atendente Específico**: Escolha diretamente o colega que continuará o contato.
3. **Nota de Transferência (Opcional)**: Digite um breve resumo do motivo da transferência (ex: *Cliente com dúvida no contrato de adesão já confirmou os dados cadastrais*). Essa nota será anexada no histórico para o próximo operador ler antes de falar.
4. Clique em **Confirmar Transferência**.

## 3. Encerramento de Atendimento com Motivo e Protocolo
Ao concluir a demanda do cliente:
1. No canto superior direito do painel de conversa, clique no botão vermelho/cinza **"Encerrar Atendimento"** (ícone de check ou fechar).
2. O modal de encerramento será exibido solicitando:
   - **Motivo do Encerramento (Tag Obrigatória ou Recomendada)**: Selecione a tag que melhor define o desfecho (ex: *Dúvida Solucionada*, *Venda Ganha*, *Fatura Enviada*, *Cliente Não Respondeu*).
   - **Observações Finais (\`close_notes\`)**: Anote qualquer detalhe importante para auditoria futura.
   - **Enviar Mensagem de Despedida**: Marque a caixa se desejar enviar a mensagem automática de encerramento do workspace (ex: "Seu atendimento foi concluído com sucesso. Obrigado pelo contato!").
3. Clique em **Confirmar Encerramento**. A conversa sairá da sua aba "Meus" e irá para "Resolvidos".
4. O cliente pode consultar o número de protocolo do atendimento que fica registrado no topo do painel.`,
  },
  {
    id: 'd1a10610-0005-4000-8000-000000000005',
    name: 'Copilot, Smart Replies e Inteligência Artificial no Composer',
    category: 'inbox_copilot',
    contextRole: 'fact',
    collectionIds: ['inbox-atendimento'],
    tags: ['copilot', 'ia', 'smart replies', 'sugestões', 'composer', 'resumo', 'tradução', 'produtividade'],
    summary: 'Como utilizar o Copilot de IA no Composer da Dialogy para receber sugestões de respostas em um clique, aprimorar a escrita, traduzir e resumir conversas.',
    canonicalAnswer: 'O Copilot no Inbox (/inbox) sugere respostas automáticas (Smart Replies) acima do composer com base no contexto. Ao clicar no ícone de faísca (IA) no composer, você pode escolher: "Melhorar Escrita", "Resumir Histórico", "Traduzir Mensagem" ou "Gerar Resposta".',
    workflowHints: [
      'Explicar que Smart Replies aparecem acima do composer',
      'Descrever as ações do menu de faísca (Melhorar escrita, resumir, traduzir, gerar)',
    ],
    content: `# Copilot, Smart Replies e Inteligência Artificial no Composer

## 1. O que é o Copilot de IA da Dialogy?
O Copilot é o assistente generativo que atua lado a lado com os atendentes humanos no Inbox, acelerando o tempo de resposta e garantindo um padrão de comunicação impecável.

## 2. Como Funciona o Smart Replies (Sugestões Rápidas de Resposta)
- Assim que o cliente envia uma mensagem, o motor de IA da Dialogy analisa o histórico da conversa e os documentos da Base de Conhecimento RAG.
- Se configurado, cards de sugestão de resposta inteligente (**Smart Replies**) aparecem logo acima da barra de mensagem no Composer.
- Cada card exibe uma resposta pronta e contextualizada.
- **Uso em 1 clique**:
  - Clique na sugestão para inseri-la no campo de texto para revisão.
  - Se desejar, faça pequenos ajustes manuais e aperte Enter para enviar.

## 3. Menu de Inteligência Artificial no Composer
No canto inferior da barra de digitação, clique no ícone de **Faísca / Sparkles** para abrir o menu do Copilot:

### 1. "Melhorar Escrita"
- Digite uma resposta rápida ou rascunho informal e clique em "Melhorar Escrita".
- A IA ajusta a gramática, pontuação e o tom de voz para soar profissional, polido e empático, mantendo exatamente o sentido original da sua frase.

### 2. "Resumir Histórico da Conversa"
- Em atendimentos longos com dezenas de mensagens trocadas, clique em "Resumir Histórico".
- A IA gera em segundos um resumo executivo contendo:
  - O motivo inicial do contato do cliente.
  - O que já foi testado ou discutido.
  - O que está pendente no momento.
- Ideal para operadores que acabaram de receber um atendimento transferido.

### 3. "Traduzir Mensagem"
- Quando atender um cliente que fala outro idioma (inglês, espanhol, francês, etc.), clique em "Traduzir".
- O Copilot traduz a mensagem do cliente para português ou traduz a sua resposta para o idioma nativo do cliente antes de enviar.

### 4. "Gerar Resposta com Base de Conhecimento"
- Pede à IA para elaborar a melhor resposta técnica para a pergunta atual do cliente consultando os documentos cadastrados no RAG do workspace.`,
  },
  {
    id: 'd1a10610-0006-4000-8000-000000000006',
    name: 'Painel Lateral do Contato (Contact Panel) e Gestão de CRM no Chat',
    category: 'inbox_contact_panel',
    contextRole: 'fact',
    collectionIds: ['inbox-atendimento', 'crm-vendas'],
    tags: ['contact panel', 'painel do contato', 'campos customizados', 'tags', 'tarefas', 'histórico'],
    summary: 'Como utilizar o painel lateral direito de informações do contato no Inbox para editar dados cadastrais, tags, campos customizados de CRM e visualizar histórico.',
    canonicalAnswer: 'No Inbox (/inbox/[chatId]), o painel lateral direito exibe os dados do contato: nome, telefone, e-mail, canal, tags coloridas, campos customizados do CRM (ex: CPF, plano, endereço), notas históricas e painel integrado do SGP/ERP.',
    workflowHints: [
      'Explicar onde fica o painel lateral direito no chat',
      'Descrever edição de campos customizados e tags',
      'Mencionar a integração com ERP/SGP exibida no painel',
    ],
    content: `# Painel Lateral do Contato (Contact Panel) e Gestão de CRM no Chat

## 1. O que é o Contact Panel?
O Contact Panel é a barra lateral direita exibida dentro de qualquer conversa ativa no Inbox. Ele consolida toda a inteligência e o histórico do cliente em uma visão 360º sem que você precise sair da tela do chat.

## 2. Como Acessar o Contact Panel
- Ao abrir uma conversa no Inbox (\`/inbox/[chatId]\`), o painel lateral direito abre automaticamente em telas desktop.
- Em telas menores ou notebooks, clique no ícone de **Informações / Usuário** no canto superior direito do topo do chat para abrir ou recolher o painel.

## 3. Seções do Contact Panel

### 1. Dados Básicos do Contato
- **Foto / Avatar**: Imagem de perfil do WhatsApp ou avatar gerado com as iniciais.
- **Nome do Contato**: Clique no ícone de lápis para editar o nome do cliente.
- **Telefone Formatado**: Número internacional completo com código do país e DDD (ex: +55 11 99999-9999).
- **E-mail**: E-mail cadastrado do cliente.
- **Canal de Origem**: Ícone indicando de onde a conversa veio (WhatsApp Evolution, Telegram, Instagram Direct, Messenger ou Webchat).

### 2. Gestão de Tags (Etiquetas)
- Exibe as tags atribuídas ao contato em formato de pílulas coloridas (ex: *VIP*, *Financeiro Pendente*, *Fibra 500MB*).
- Clique no botão **"+" (Adicionar Tag)** para selecionar uma nova tag criada no workspace.
- Clique no "x" de uma tag para removê-la instantaneamente.

### 3. Campos Customizados do CRM
- Exibe todos os campos personalizados que seu workspace criou nas configurações do CRM:
  - Documentos: CPF, CNPJ, RG.
  - Endereço: Rua, Número, Bairro, CEP, Cidade.
  - Dados Contratuais: Plano Contratado, Valor da Mensalidade, Data de Vencimento, Status de Instalação.
- **Edição em Tempo Real**: Altere qualquer valor diretamente pelo campo de texto ou seletor e o Dialogy salvará a informação automaticamente no banco de dados do CRM.

### 4. Integração com SGP / ERP de Provedores (Quando Ativo)
- Para provedores de telecomunicações que utilizam a integração com o SGP:
  - O painel exibe automaticamente os contratos vinculados àquele CPF.
  - Status do sinal da fibra (Online / Offline).
  - Últimas faturas com botões de ação rápida para copiar linha digitável e código Pix.

### 5. Histórico e Notas Operacionais
- Linha do tempo das interações anteriores do cliente com outros atendentes ou robôs.
- Registro de tarefas pendentes e lembretes vinculados àquele contato.`,
  },
  {
    id: 'd1a10610-0007-4000-8000-000000000007',
    name: 'Manual do CRM: Funil Kanban, Oportunidades e Gestão de Vendas',
    category: 'crm_kanban',
    contextRole: 'procedure',
    collectionIds: ['crm-vendas'],
    tags: ['crm', 'kanban', 'funil', 'vendas', 'oportunidades', 'leads', 'estágios', 'deals'],
    summary: 'Como operar o funil de vendas Kanban no CRM da Dialogy, criar oportunidades, arrastar cards entre estágios de negociação e gerenciar valores.',
    canonicalAnswer: 'Acesse o CRM pelo menu lateral em Clientes & Vendas > CRM (/crm). O funil visual Kanban permite criar oportunidades com o botão "+ Nova Oportunidade", definir valores financeiros, contatos vinculados e arrastar os cards entre os estágios até Ganho ou Perdido.',
    workflowHints: [
      'Indicar acesso ao /crm',
      'Explicar a dinâmica drag and drop das colunas Kanban',
      'Explicar como criar e editar uma oportunidade',
    ],
    content: `# Manual do CRM: Funil Kanban, Oportunidades e Gestão de Vendas

## 1. O que é o CRM da Dialogy?
O CRM (Customer Relationship Management) da Dialogy é integrado nativamente ao Inbox e aos Atendentes de IA. Ele transforma conversas casuais em oportunidades comerciais organizadas visualmente em um funil Kanban.

## 2. Como Chegar ao CRM
- Na barra lateral esquerda (Sidebar), clique no ícone do menu **Clientes & Vendas** e selecione a opção **CRM**.
- Rota direta no navegador: \`/crm\`.

## 3. Estrutura do Funil Kanban
O CRM apresenta colunas representando as fases do seu ciclo comercial:
- **Novo Lead**: Contatos recém-chegados pelo WhatsApp ou formulários que demonstraram interesse.
- **Qualificação**: Contatos que estão sendo avaliados para verificar perfil de compra, localização ou capacidade técnica.
- **Apresentação de Planos / Proposta**: Oportunidades onde os planos ou orçamentos já foram apresentados ao cliente.
- **Negociação**: Fase final de alinhamento de valores, datas de instalação ou condições de pagamento.
- **Ganho (Fechado)**: Oportunidades convertidas com sucesso em novos clientes e receita.
- **Perdido**: Oportunidades que não evoluíram, com registro do motivo de perda.

## 4. Como Criar uma Nova Oportunidade
1. Na tela do CRM (\`/crm\`), clique no botão **"+ Nova Oportunidade"** no topo superior direito (ou no botão "+" no topo de qualquer coluna de estágio).
2. Preencha os campos da oportunidade:
   - **Título**: Nome descritivo da negociação (ex: *Contratação Plano Fibra 600MB - João Silva*).
   - **Contato**: Digite o nome ou telefone do contato existente no sistema (ou cadastre um novo na hora).
   - **Valor Estimado (R$)**: O valor da mensalidade ou do contrato comercial.
   - **Estágio Inicial**: Selecione a coluna onde o card deve entrar (padrão: "Novo Lead").
   - **Responsável**: Atribua o vendedor ou atendente responsável pelo fechamento.
   - **Data Prevista de Fechamento**: Prazo estimado para conclusão.
3. Clique em **Salvar**. O card aparecerá imediatamente na coluna do Kanban.

## 5. Como Mover Cards entre Estágios (Drag and Drop)
- Para avançar uma oportunidade no funil, basta **clicar, segurar e arrastar o card** para a coluna seguinte.
- **Ao mover para "Ganho"**: O sistema registra a data de conversão e alimenta os gráficos de receita no Dashboard.
- **Ao mover para "Perdido"**: Uma janela solicitará a seleção do **Motivo de Perda** (ex: *Preço Alto*, *Falta de Cobertura*, *Optou por Concorrente*, *Desistência*). Esse dado é vital para relatórios de inteligência comercial.

## 6. Acesso Rápido ao Chat Diretamente do Card
- Em cada card do Kanban, há um botão de atalho com o ícone do WhatsApp / Chat. Clique nele para pular direto para a conversa daquele cliente no Inbox sem perder tempo buscando.`,
  },
  {
    id: 'd1a10610-0008-4000-8000-000000000008',
    name: 'Automações de CRM e Dashboard de Métricas de Vendas',
    category: 'crm_automations',
    contextRole: 'fact',
    collectionIds: ['crm-vendas'],
    tags: ['automações crm', 'dashboard crm', 'conversão', 'ticket médio', 'métricas de vendas', 'gatilhos'],
    summary: 'Como configurar automações de estágio no CRM da Dialogy e acompanhar o dashboard de taxa de conversão, ticket médio e tempo no funil.',
    canonicalAnswer: 'No CRM (/crm), acesse as abas superiores "Automações" e "Dashboard". Em Automações você cria regras para disparar mensagens, aplicar tags ou mudar de estágio automaticamente. No Dashboard você acompanha taxa de conversão, ticket médio e tempo de ciclo de vendas.',
    workflowHints: [
      'Explicar as abas Automações e Dashboard no topo do /crm',
      'Descrever regras baseadas em movimentação de estágio',
      'Explicar as métricas de conversão e ticket médio',
    ],
    content: `# Automações de CRM e Dashboard de Métricas de Vendas

## 1. Abas Superiores do CRM
No topo da página do CRM (\`/crm\`), existem três abas de navegação fundamentais:
1. **Funil (Kanban)**: Visualização dos cards e movimentação de negócios.
2. **Automações**: Criação de regras de automação acionadas por eventos do funil.
3. **Dashboard**: Painel de inteligência de negócios com gráficos e métricas de vendas.

## 2. Automações do CRM (Como Funciona)
As automações eliminam tarefas manuais repetitivas da equipe de vendas:
- **Gatilhos Disponíveis**:
  - *Lead Criado*: Quando uma nova oportunidade é adicionada.
  - *Estágio Alterado*: Quando o card é movido para uma coluna específica (ex: movido para "Proposta").
  - *Oportunidade Ganha*: Quando a venda é concluída com sucesso.
  - *Oportunidade Perdida*: Quando o negócio não é fechado.
- **Ações Automatizadas**:
  - *Enviar Mensagem no WhatsApp*: Dispara uma mensagem personalizada com templates (ex: enviar confirmação de dados ao entrar em "Qualificação").
  - *Atribuir Tag*: Adiciona ou remove etiquetas no contato (ex: adiciona tag "Cliente Fechado").
  - *Notificar Equipe*: Alerta o vendedor responsável via notificação.
  - *Atualizar Campos*: Modifica campos customizados automaticamente.

## 3. Dashboard e Métricas de Vendas (Como Analisar)
Ao clicar na aba **Dashboard** no CRM, você tem acesso aos seguintes indicadores:
- **Taxa de Conversão Geral**: Percentual de leads que entraram no funil e chegaram ao estágio "Ganho".
- **Conversão por Estágio (Gargalo do Funil)**: Mostra onde os clientes estão travando ou desistindo (ex: quantos passaram de "Apresentação" para "Proposta").
- **Ticket Médio**: Valor financeiro médio de cada oportunidade ganha.
- **Tempo Médio no Funil (Ciclo de Vendas)**: Quantos dias ou horas em média um lead leva desde o primeiro contato até o fechamento.
- **Ranking de Motivos de Perda**: Gráfico em pizza demonstrando as principais razões pelas quais as oportunidades não fecharam (ex: 45% Cobertura Indisponível, 30% Preço, 25% Concorrência).
- **Desempenho por Vendedor / Atendente**: Número de vendas fechadas e volume financeiro gerado por operador.`,
  },
  {
    id: 'd1a10610-0009-4000-8000-000000000009',
    name: 'Campanhas de Mensagens em Massa (Broadcasting) e Regras Anti-Ban',
    category: 'campaigns_broadcasting',
    contextRole: 'procedure',
    collectionIds: ['campanhas-disparos'],
    tags: ['campanhas', 'disparos', 'broadcasting', 'mensagens em massa', 'whatsapp', 'anti-ban', 'delay'],
    summary: 'Procedimento passo a passo para criar campanhas de disparo de mensagens em massa no WhatsApp via Dialogy, com segmentação por tags, variáveis dinâmicas e proteção anti-bloqueio.',
    canonicalAnswer: 'Acesse o módulo em Clientes & Vendas > Campanhas (/campaigns) e clique em "+ Nova Campanha". Selecione a instância de WhatsApp, segmente os contatos por tags ou CRM, redija a mensagem com {nome}, configure o intervalo anti-ban (ex: 15 a 30s) e envie imediatamente ou agende.',
    workflowHints: [
      'Indicar acesso a /campaigns e botão Nova Campanha (/campaigns/new)',
      'Descrever os 5 passos: Instância, Segmentação, Mensagem/Mídia, Anti-Ban e Agendamento',
      'Enfatizar o delay aleatório inteligente para proteção anti-ban',
    ],
    content: `# Campanhas de Mensagens em Massa (Broadcasting) e Regras Anti-Ban

## 1. O que são as Campanhas da Dialogy?
O módulo de Campanhas permite realizar disparos de mensagens ativas e personalizadas para centenas ou milhares de contatos no WhatsApp de forma automatizada, profissional e segura.

## 2. Como Chegar às Campanhas
- Na barra lateral esquerda (Sidebar), clique no ícone **Clientes & Vendas** e selecione a opção **Campanhas**.
- Rota direta: \`/campaigns\` (lista de campanhas) ou \`/campaigns/new\` (criação de nova campanha).

## 3. Passo a Passo: Criando uma Campanha de Disparos

### Passo 1: Informações Gerais e Instância
1. Clique no botão **"Nova Campanha"**.
2. Dê um nome identificador para a campanha (ex: *Oferta Black Friday - Clientes Inativos*).
3. **Instância de Envio**: Escolha qual das suas instâncias de WhatsApp conectadas será utilizada para realizar os envios.

### Passo 2: Segmentação de Contatos
Escolha quem receberá a mensagem:
- **Por Tags**: Selecione uma ou mais tags (ex: contatos marcados com "Interessados Fibra" e "Ex-Clientes").
- **Por Estágio do CRM**: Dispare apenas para contatos que estão em uma fase específica do funil (ex: coluna "Proposta Enviada").
- O sistema exibirá uma contagem prévia do número de contatos elegíveis para o disparo.

### Passo 3: Composição da Mensagem e Variáveis Dinâmicas
- Digite o texto da mensagem.
- **Variáveis Dinâmicas**: Insira tags como \`{nome}\` ou \`{telefone}\`. No momento do envio, o Dialogy substitui automaticamente \`{nome}\` pelo primeiro nome real cadastrado de cada cliente, tornando a mensagem totalmente pessoal e humanizada.
- **Anexo de Mídia (Opcional)**: Anexe uma foto promocional (JPEG/PNG), vídeo curto ou arquivo PDF com catálogo.

### Passo 4: Intervalo Anti-Ban (Proteção de Chip)
- O WhatsApp possui algoritmos severos de detecção de spam caso receba dezenas de mensagens por segundo de um mesmo número.
- O Dialogy possui motor de cadência anti-ban com **delay aleatório inteligente**:
  - Configure um intervalo mínimo e máximo entre envios (recomendado: **entre 15 e 35 segundos**).
  - O sistema varia o tempo de espera a cada mensagem disparada, simulando o comportamento de digitação de um humano real e mantendo seu número 100% seguro.

### Passo 5: Agendamento ou Envio Imediato
- Escolha **"Disparar Agora"** para iniciar a fila de processamento imediatamente.
- Ou selecione **"Agendar"** e defina a data e hora exata em que a campanha começará a rodar.

## 4. Acompanhamento de Métricas em Tempo Real
Na lista de campanhas (\`/campaigns\`), você acompanha:
- Quantidade total de mensagens programadas, enviadas com sucesso e falhas.
- Taxa percentual de entrega e visualização.
- Número de clientes que responderam à campanha (essas conversas entram automaticamente no Inbox para seus atendentes ou robôs continuarem o atendimento).`,
  },
  {
    id: 'd1a10610-0010-4000-8000-000000000010',
    name: 'Analytics: Métricas de Atendimento, Produtividade e Relatórios',
    category: 'analytics_reports',
    contextRole: 'fact',
    collectionIds: ['navegacao-geral', 'equipes-permissoes'],
    tags: ['analytics', 'relatórios', 'tmr', 'tma', 'produtividade', 'atendimento', 'métricas'],
    summary: 'Como consultar o painel de Analytics da Dialogy para acompanhar indicadores-chave de atendimento (TMR, TMA, volume de conversas, horários de pico e ranking de operadores).',
    canonicalAnswer: 'Acesse o Analytics em Clientes & Vendas > Analytics (/analytics). No painel você visualiza Tempo Médio de Resposta (TMR), Tempo Médio de Atendimento (TMA), volume de mensagens por hora e produtividade de cada atendente e equipe.',
    workflowHints: [
      'Indicar rota /analytics',
      'Explicar TMR (Tempo Médio de Primeira Resposta) e TMA (Tempo Médio de Atendimento)',
      'Explicar filtros de data e relatórios por equipe',
    ],
    content: `# Analytics: Métricas de Atendimento, Produtividade e Relatórios

## 1. O que é o Analytics da Dialogy?
O Analytics é a central de Business Intelligence para supervisores e gestores de atendimento. Ele traduz milhares de mensagens em indicadores de qualidade, velocidade e eficiência da sua operação.

## 2. Como Chegar ao Analytics
- Na barra lateral esquerda (Sidebar), clique no ícone **Clientes & Vendas** e selecione a opção **Analytics**.
- Rota direta: \`/analytics\`.

## 3. Indicadores-Chave de Desempenho (KPIs)

### 1. TMR (Tempo Médio de Primeira Resposta)
- Mede o tempo decorrido desde o momento em que o cliente manda a primeira mensagem até o primeiro atendente (ou robô) responder.
- Essencial para garantir que novos clientes não fiquem esperando na fila.

### 2. TMA (Tempo Médio de Atendimento)
- Mede a duração média total de uma conversa, desde a primeira interação até o encerramento do chat.
- Ajuda a dimensionar o tamanho da equipe necessário para atender o volume da empresa.

### 3. Volume Total de Conversas e Mensagens
- Quantidade de conversas abertas, em andamento e finalizadas no período selecionado.
- Comparativo entre mensagens recebidas de clientes vs mensagens enviadas pela equipe.

### 4. Gráfico de Horários de Pico
- Demonstra visualmente quais horas do dia e dias da semana concentram o maior número de contatos de clientes (ex: terças e quintas das 10h às 12h e das 14h às 16h).
- Permite escalar mais atendentes nos horários de maior demanda.

### 5. Produtividade Individual por Atendente
- Tabela com todos os operadores do workspace exibindo:
  - Quantidade de conversas assumidas e encerradas.
  - Tempo médio de resposta individual de cada colaborador.
  - Avaliação de satisfação (quando pesquisa ativa).

### 6. Desempenho por Fila / Departamento
- Comparativo entre setores: qual equipe atende mais rápido (Suporte N1 vs Comercial vs Financeiro) e onde estão os maiores gargalos.

## 4. Filtros por Período e Exportação de Dados
- No topo da página de Analytics, clique no seletor de calendário para filtrar:
  - *Hoje*, *Últimos 7 dias*, *Últimos 30 dias*, *Mês Atual* ou *Intervalo Personalizado*.
- Utilize o botão de exportar relatório caso precise gerar planilhas para reuniões de diretoria.`,
  },
  {
    id: 'd1a10610-0011-4000-8000-000000000011',
    name: 'Nexus Flow Studio: Construtor Visual de Fluxos de IA e Chatbots',
    category: 'nexus_studio',
    contextRole: 'procedure',
    collectionIds: ['automacao-nexus'],
    tags: ['nexus', 'fluxos', 'canvas', 'nós', 'studio', 'automação', 'chatbot', 'árvore de decisão'],
    summary: 'Como utilizar o Nexus Flow Studio para construir fluxos de automação visual baseados em nós no canvas interativo da Dialogy.',
    canonicalAnswer: 'Acesse o Nexus pelo menu lateral em Automação & Inteligência > Nexus (/nexus). O Studio visual permite arrastar nós para o canvas (nós de mensagem, pergunta/coleta, decisão if/else, RAG de conhecimento, ferramentas e transbordo humano), conectar portas e clicar em "Salvar e Publicar".',
    workflowHints: [
      'Indicar rota /nexus',
      'Descrever o canvas visual interativo',
      'Explicar os nós principais: Mensagem, Pergunta/Input, Condição, RAG e Handoff',
      'Explicar o processo de salvar e publicar a versão',
    ],
    content: `# Nexus Flow Studio: Construtor Visual de Fluxos de IA e Chatbots

## 1. O que é o Nexus Flow Studio?
O Nexus Flow Studio é a ferramenta de ponta da Dialogy para criar árvores de conversação, fluxos guiados e automações avançadas sem escrever uma única linha de código. Ele combina nós visuais determinísticos com inteligência artificial generativa.

## 2. Como Chegar ao Nexus Flow Studio
- Na barra lateral esquerda (Sidebar), clique no ícone de **Faísca (Automação & Inteligência)** e selecione a opção **Nexus**.
- Rota direta: \`/nexus\`.

## 3. O Canvas Visual e a Conexão por Portas
- A área de trabalho do Nexus é um **canvas infinito** onde você pode dar zoom com o scroll do mouse e mover o painel livremente.
- Cada elemento de lógica é um **Nó (Card)** com portas de entrada (lado esquerdo) e portas de saída (lado direito).
- Para ligar a ordem de execução, clique na bolinha de saída de um nó e **arraste uma linha até a bolinha de entrada** do próximo nó.

## 4. Tipos de Nós Disponíveis no Nexus

### 1. Nó de Início / Gatilho (Trigger Node)
- Ponto de partida do fluxo. Disparado quando o cliente manda qualquer mensagem, envia uma palavra-chave configurada ou quando um novo contato é criado.

### 2. Nó de Mensagem (Message Node)
- Envia uma mensagem direta de texto para o cliente.
- Suporta formatação, quebras de linha e variáveis (ex: \`Olá {nome}, seja muito bem-vindo à Dialogy!\`).

### 3. Nó de Pergunta / Coleta de Dados (Question / Input Node)
- Faz uma pergunta ao cliente e aguarda a resposta do usuário.
- Pode gravar a resposta diretamente em uma variável do fluxo ou em um **Campo Customizado do CRM** (ex: coleta o CPF e grava no campo de documento).

### 4. Nó de Condição / Decisão (If/Else Condition Node)
- Analisa regras lógicas e bifurca o fluxo.
- Exemplos de regras:
  - Se o cliente já tiver a tag "Cliente Ativo", vá para o caminho A.
  - Se não tiver, vá para o caminho B.
  - Se a mensagem contiver a palavra "segunda via", vá para o caminho C.

### 5. Nó de Base de Conhecimento (RAG Node)
- Conecta a conversa diretamente à base de conhecimento vetorial do agente.
- A IA consulta os documentos cadastrados e gera a resposta precisa com base nos fatos da empresa antes de prosseguir.

### 6. Nó de Ação / Ferramenta (Tool Node)
- Executa ações no sistema: atribuir tag, criar negócio no CRM, chamar webhook externo ou consultar contratos no SGP.

### 7. Nó de Transbordo Humano (Handoff Node)
- Encerra o fluxo automatizado e transfere a conversa imediatamente para uma fila de atendimento humano específica (ex: fila do Suporte).

### 8. Nó de Encerramento (Close Node)
- Finaliza o atendimento de forma elegante com mensagem de despedida e aplicação de tag de conclusão.

## 5. Publicação e Testes de Fluxo
- **Testar Fluxo**: Utilize o simulador interativo na barra lateral do Studio para bater papo com o fluxo em tempo real e ver os nós acendendo conforme são executados.
- **Salvar e Publicar**: Quando o fluxo estiver pronto, clique em **"Salvar e Publicar"** no canto superior direito. As alterações passam a valer instantaneamente para os novos contatos.`,
  },
  {
    id: 'd1a10610-0012-4000-8000-000000000012',
    name: 'Atendentes Inteligentes (Autopilot) e Robôs de Atendimento',
    category: 'autopilot_agents',
    contextRole: 'procedure',
    collectionIds: ['automacao-nexus'],
    tags: ['robôs', 'atendentes inteligentes', 'autopilot', 'ia', 'persona', 'prompt', 'modelos', 'transbordo'],
    summary: 'Como configurar Atendentes Inteligentes no Dialogy via Autopilot e gerenciar Robôs em /automations/robots, definindo personas, modelos de IA e políticas de transbordo.',
    canonicalAnswer: 'Acesse Robôs pelo menu Automação & Inteligência > Robôs (/automations/robots). Crie ou edite um Atendente Inteligente vinculando-o a uma configuração de Autopilot, onde você define a Persona/Prompt de Sistema, modelo LLM (DeepSeek, GPT-4o, etc.), base RAG e regras de transferência para equipes humanas.',
    workflowHints: [
      'Indicar rota /automations/robots e /autopilot',
      'Diferenciar os 3 tipos: Atendente Inteligente, Padrão e Marketing',
      'Explicar a configuração da Persona no Autopilot e ferramentas',
    ],
    content: `# Atendentes Inteligentes (Autopilot) e Robôs de Atendimento

## 1. O que são os Robôs e Atendentes Inteligentes?
No Dialogy, robôs são entidades virtuais com permissão para interagir em chats, enviar mensagens ativas e orquestrar ferramentas operacionais.

## 2. Como Chegar à Gestão de Robôs
- Na barra lateral esquerda (Sidebar), clique em **Automação & Inteligência** e selecione a opção **Robôs**.
- Rota direta: \`/automations/robots\` (gestão de robôs) e \`/autopilot\` (configuração avançada de IA).

## 3. Os Três Tipos de Robôs no Sistema
Ao clicar em **"Novo Robô"** em \`/automations/robots\`, você pode escolher:
1. **Atendente Inteligente (\`intelligent_attendant\`)**:
   - Totalmente movido por Modelos de Linguagem (LLMs) via Autopilot.
   - Compreende áudios transcritos, interpreta intenções complexas, busca na base RAG e aciona ferramentas como transferir e fechar conversas.
   - Vinculado obrigatoriamente a uma configuração do Autopilot e a uma Equipe do workspace.
2. **Padrão (\`default\`)**:
   - Robô integrador conectado a Webhooks externos (ex: n8n, Typebot, plataformas legadas ou sistemas próprios).
   - O Dialogy envia as mensagens recebidas para a URL do webhook e o robô externo responde via API.
3. **Marketing (\`marketing\`)**:
   - Robô especializado em envio de disparos de campanhas e prospecção ativa.

## 4. Como Configurar o Atendente Inteligente (Autopilot)
Ao editar as configurações de um agente de IA no Autopilot:

### 1. Persona e Prompt de Sistema (\`knowledge_base\`)
- Onde você define a identidade do agente: nome fantasia, empresa que representa, tom de fala (amigável, formal, vendedor), regras obrigatórias e restrições (ex: "Nunca passe informações de concorrentes", "Sempre solicite o CPF antes de consultar contratos").

### 2. Seleção de Modelo de IA (\`ai_model\`)
- Escolha o modelo que processará os diálogos:
  - *DeepSeek (deepseek-chat / deepseek-v4-flash)*: Extremamente econômico, rápido e com excelente raciocínio em português.
  - *OpenAI (gpt-4o / gpt-4o-mini)*: Alta precisão e fluidez.
  - *Anthropic (claude-3-5-sonnet)*: Excelente compreensão de instruções complexas.
  - *Google Gemini*: Respostas rápidas e processamento avançado.
  - *Modelos Locais (Ollama / LM Studio)*: Privacidade total rodando em infraestrutura própria.

### 3. Ferramentas Habilitadas (\`enabled_tool_names\`)
- Permissões que o robô possui para executar ações no chat:
  - \`transfer_chat\`: Capacidade de transferir o cliente para um atendente humano quando não souber responder.
  - \`close_chat\`: Capacidade de encerrar o atendimento após resolver a dúvida.
  - \`add_internal_note\`: Anotar informações técnicas no chat.
  - \`crm_update_contact_custom_fields\`: Salvar dados coletados diretamente no CRM.

### 4. Políticas de Transbordo Humano
- Configure gatilhos que forçam o transbordo para operadores humanos:
  - Sentimento negativo ou frustração expressa pelo cliente.
  - Solicitação explícita ("Quero falar com um humano").
  - Perguntas não cobertas pela Base de Conhecimento.`,
  },
  {
    id: 'd1a10610-0013-4000-8000-000000000013',
    name: 'RAG e Base de Conhecimento: Indexação Vetorial e Busca Semântica BGE-M3',
    category: 'rag_architecture',
    contextRole: 'fact',
    collectionIds: ['automacao-nexus'],
    tags: ['rag', 'base de conhecimento', 'embeddings', 'bge-m3', 'pgvector', 'busca semântica', 'chunks'],
    summary: 'Como funciona a arquitetura de RAG na Dialogy, organização em coleções, indexação vetorial neural BGE-M3 de 1024 dimensões e fusão híbrida RRF.',
    canonicalAnswer: 'A Base de Conhecimento RAG da Dialogy organiza o conhecimento em coleções temáticas e documentos Markdown. Cada documento é dividido em chunks semânticos e indexado na tabela embeddings_documents com vetores neurais BGE-M3 de 1024 dimensões, garantindo respostas baseadas em fatos reais.',
    workflowHints: [
      'Explicar que o RAG impede alucinações da IA',
      'Descrever a separação por coleções e metadados',
      'Explicar o modelo BGE-M3 de 1024 dimensões e busca híbrida RRF',
    ],
    content: `# RAG e Base de Conhecimento: Indexação Vetorial e Busca Semântica BGE-M3

## 1. O que é o RAG da Dialogy?
RAG (Retrieval-Augmented Generation ou Geração Aumentada por Recuperação) é a tecnologia que conecta seu atendente de IA aos manuais, políticas, procedimentos e documentos reais da sua empresa.
- **Fim das Alucinações**: Em vez de "adivinhar" respostas, a IA consulta a sua base de dados antes de falar e responde estritamente o que foi documentado.

## 2. Como Funciona a Arquitetura RAG na Dialogy
1. **Coleções de Conhecimento (\`knowledge_collections\`)**:
   - Permitem agrupar documentos por tópicos (ex: *Navegação Geral*, *Políticas Financeiras*, *Suporte Técnico Fibra*, *Planos Comerciais*).
   - Você pode atribuir diferentes coleções a diferentes agentes.
2. **Documentos em Formato Rico (Markdown)**:
   - A plataforma aceita documentos estruturados em Markdown com títulos (\`#\`, \`##\`), listas de verificação, tabelas e orientações passo a passo.
3. **Divisão Semântica em Chunks**:
   - Durante a ingestão, o sistema divide automaticamente textos longos em pedaços lógicos de informação (chunks), mantendo o título pai e contexto para que nenhuma informação fique isolada.
4. **Embeddings Neurais BGE-M3 (1024 Dimensões)**:
   - Cada chunk é convertido em um vetor matemático denso de 1024 dimensões usando o modelo estado da arte \`onnx-community/bge-m3-ONNX\`.
   - Os vetores são armazenados na tabela \`embeddings_documents\` do PostgreSQL com a extensão \`pgvector\` e indexação de alta velocidade HNSW.
5. **Busca Híbrida com RRF (Reciprocal Rank Fusion)**:
   - Quando o cliente faz uma pergunta, o Dialogy executa duas buscas simultâneas:
     - **Busca Vetorial**: Encontra chunks pelo significado e intenção semântica (mesmo se o cliente usar sinônimos).
     - **Busca Léxica (Palavras-chave)**: Encontra termos exatos (códigos, números de modelo, nomes próprios).
   - O algoritmo RRF funde os melhores resultados e entrega para a IA formular a resposta final.

## 3. Como Cadastrar Documentos na Base de Conhecimento
1. Acesse o editor do agente no Autopilot ou Nexus.
2. Na aba **Base de Conhecimento**, clique em **"+ Adicionar Documento"**.
3. Preencha o nome do documento, selecione a coleção e cole o conteúdo detalhado.
4. Adicione **Tags** semânticas e uma **Resposta Canônica** (a resposta ideal resumida para perguntas diretas).
5. Clique em **Salvar**. O sistema realizará a indexação vetorial instantaneamente.`,
  },
  {
    id: 'd1a10610-0014-4000-8000-000000000014',
    name: 'Integração WhatsApp via Evolution API: Conexão e Gerenciamento',
    category: 'integrations_whatsapp',
    contextRole: 'procedure',
    collectionIds: ['integracoes-canais'],
    tags: ['whatsapp', 'evolution api', 'qr code', 'conexão', 'instância', 'status', 'webhooks'],
    summary: 'Procedimento passo a passo para conectar números de WhatsApp no Dialogy através da Evolution API lendo o QR Code, gerenciar instâncias e resolver desconexões.',
    canonicalAnswer: 'Para conectar o WhatsApp, acesse Integrações > WhatsApp (/integrations/evolution-api). Clique em "Adicionar Conexão", informe o nome da instância, escaneie o QR Code no seu celular em Aparelhos Conectados e aguarde o status mudar para Online (verde).',
    workflowHints: [
      'Indicar acesso a /integrations/evolution-api',
      'Descrever os passos de criação de instância e leitura de QR Code',
      'Explicar o monitoramento de status Online/Offline e reconexão',
    ],
    content: `# Integração WhatsApp via Evolution API: Conexão e Gerenciamento

## 1. Visão Geral da Integração WhatsApp
O Dialogy integra-se com o WhatsApp através da Evolution API, fornecendo uma conexão robusta, veloz e sem taxas por mensagem trocada. A integração suporta texto, áudios com reprodução e transcrição, fotos, vídeos, documentos, status de entrega e digitação em tempo real.

## 2. Como Chegar à Conexão do WhatsApp
- Na barra lateral esquerda (Sidebar), clique no ícone de **Grade / Integrações** e selecione a opção **WhatsApp**.
- Rota direta: \`/integrations/evolution-api\`.

## 3. Passo a Passo: Conectando uma Nova Instância via QR Code
1. Na tela de instâncias do WhatsApp (\`/integrations/evolution-api\`), clique no botão **"Nova Instância"** ou **"Adicionar Conexão"**.
2. **Nome da Instância**: Digite um nome para identificar o número no sistema (ex: *Suporte Geral*, *Vendas São Paulo*). Evite caracteres especiais.
3. O Dialogy solicitará a criação da instância no servidor e gerará um **QR Code dinâmico** na tela.
4. Pegue o celular onde o WhatsApp está instalado:
   - No Android: Toque nos três pontinhos no canto superior direito > **Aparelhos conectados** > **Conectar um aparelho**.
   - No iPhone: Toque na aba **Configurações** no canto inferior direito > **Aparelhos conectados** > **Conectar um aparelho**.
5. Aponte a câmera do celular para a tela do computador e faça a leitura do QR Code.
6. Em poucos segundos, o Dialogy atualizará a tela e o card da instância exibirá:
   - **Status**: \`Conectado (Online)\` com indicador verde.
   - Número de telefone identificado com DDD.
   - Foto de perfil do número.

## 4. Webhooks e Configuração Automática
- O Dialogy configura automaticamente os webhooks de mensagens e status. Você não precisa copiar ou colar URLs de webhooks manualmente.
- Todas as mensagens enviadas para aquele número começarão a cair imediatamente no seu Inbox.

## 5. Como Lidar com Desconexões e Reconectar
- Caso o celular perca sinal de internet prolongado ou o usuário desconecte o aparelho nas configurações do WhatsApp:
  - O status mudará para \`Desconectado (Offline)\`.
  - Na tela da instância em \`/integrations/evolution-api\`, clique no botão **"Reconectar"** ou **"Gerar Novo QR Code"**.
  - Repita a leitura do QR Code no celular e o canal voltará a operar normalmente sem perder o histórico das conversas anteriores.`,
  },
  {
    id: 'd1a10610-0015-4000-8000-000000000015',
    name: 'Integrações de Redes Sociais: Instagram, Messenger, Telegram e Webchat',
    category: 'integrations_channels',
    contextRole: 'procedure',
    collectionIds: ['integracoes-canais'],
    tags: ['instagram', 'messenger', 'telegram', 'webchat', 'meta', 'botfather', 'widget', 'script'],
    summary: 'Como conectar canais adicionais de atendimento na Dialogy: Instagram Direct, Facebook Messenger, Telegram Bot e o widget flutuante de Webchat para sites.',
    canonicalAnswer: 'Acesse o menu lateral em Integrações. Para Instagram (/integrations/meta-instagram) e Messenger (/integrations/meta-messenger), conecte via autenticação Meta. Para Telegram (/integrations/telegram), insira o Token do BotFather. Para Webchat (/integrations/webchat), personalize o widget e copie o script HTML.',
    workflowHints: [
      'Listar as rotas de cada canal (/integrations/meta-instagram, meta-messenger, telegram, webchat)',
      'Explicar a integração do Telegram com token do BotFather',
      'Explicar como personalizar e incorporar o widget Webchat com tag <script>',
    ],
    content: `# Integrações de Redes Sociais: Instagram, Messenger, Telegram e Webchat

## 1. Conexão com Instagram Direct
- **Como chegar**: Sidebar > Integrações > **Instagram Direct** (rota: \`/integrations/meta-instagram\`).
- **Como funciona**: Conecta-se oficialmente à Graph API da Meta.
- **Passo a passo**:
  1. Clique em "Conectar com Facebook / Meta".
  2. Faça login com a conta administradora da Página do Facebook vinculada ao perfil profissional do Instagram.
  3. Autorize as permissões de leitura e envio de mensagens no Instagram Direct.
  4. Selecione a conta do Instagram desejada e ative a conexão. Todas as DMs cairão diretamente no Inbox da Dialogy.

## 2. Conexão com Facebook Messenger
- **Como chegar**: Sidebar > Integrações > **Facebook Messenger** (rota: \`/integrations/meta-messenger\`).
- **Passo a passo**:
  1. Clique em "Conectar Página do Facebook".
  2. Selecione a página da sua empresa.
  3. Conceda as permissões de mensagens. Mensagens enviadas para a página aparecerão unificadas no Inbox.

## 3. Conexão com Telegram Bot
- **Como chegar**: Sidebar > Integrações > **Telegram** (rota: \`/integrations/telegram\`).
- **Passo a passo**:
  1. Abra o Telegram no celular ou computador e pesquise pelo usuário oficial \`@BotFather\`.
  2. Envie o comando \`/newbot\` e siga as instruções para escolher o nome e o username do seu bot.
  3. O BotFather fornecerá o **HTTP API Token** (uma sequência longa de letras e números).
  4. No Dialogy em \`/integrations/telegram\`, clique em "Adicionar Bot do Telegram".
  5. Cole o Token no campo indicado e clique em **Salvar e Conectar**.
  6. Seu bot do Telegram está pronto: qualquer mensagem enviada para ele por clientes aparecerá no Inbox.

## 4. Webchat Widget (Chat Flutuante para Sites e Lojas)
- **Como chegar**: Sidebar > Integrações > **Webchat** (rota: \`/integrations/webchat\`).
- **Personalização Visual**:
  - Título do Chat (ex: *Suporte Dialogy*).
  - Cor Primária: Selecione a cor da sua identidade visual.
  - Avatar / Logotipo da empresa.
  - Mensagem de Boas-Vindas inicial.
- **Como Incorporar no seu Site**:
  1. Na aba de código em \`/integrations/webchat\`, copie o trecho de script gerado:
     \`\`\`html
     <script src="https://dialogy.com.br/widget.js" data-workspace-id="SEU_WORKSPACE_ID"></script>
     \`\`\`
  2. Cole esse script antes da tag de fechamento \`</body>\` no HTML do seu site, tema do WordPress ou loja virtual (Shopify, Nuvemshop, etc.).
  3. O botão flutuante aparecerá no canto da página e as conversas entrarão no Inbox da Dialogy.`,
  },
  {
    id: 'd1a10610-0016-4000-8000-000000000016',
    name: 'Provedores de Inteligência Artificial e Servidores MCP (Model Context Protocol)',
    category: 'integrations_ai',
    contextRole: 'procedure',
    collectionIds: ['integracoes-canais'],
    tags: ['ia', 'mcp', 'openai', 'gemini', 'anthropic', 'deepseek', 'groq', 'ollama', 'lm studio'],
    summary: 'Como configurar chaves de API para provedores de inteligência artificial (OpenAI, Gemini, Claude, DeepSeek, Groq) e integrar servidores MCP para estender capacidades dos agentes.',
    canonicalAnswer: 'Acesse Integrações > Provedores de IA (/integrations/ai) para inserir suas chaves de API (OpenAI, DeepSeek, Gemini, Anthropic, Groq) ou conectar modelos locais (Ollama, LM Studio). Em Integrações > MCP (/integrations/mcp), conecte servidores Model Context Protocol para fornecer ferramentas dinâmicas aos agentes.',
    workflowHints: [
      'Indicar rotas /integrations/ai e /integrations/mcp',
      'Listar os provedores suportados e como inserir as chaves',
      'Explicar o papel do MCP na expansão de ferramentas',
    ],
    content: `# Provedores de Inteligência Artificial e Servidores MCP (Model Context Protocol)

## 1. Hub de Provedores de IA
O Dialogy é uma plataforma agnóstica de inteligência artificial. Você pode utilizar o provedor e o modelo que melhor se adequar ao custo e necessidade da sua operação.

## 2. Como Chegar aos Provedores de IA
- Na barra lateral esquerda (Sidebar), clique em **Integrações** e selecione a opção **Provedores de IA**.
- Rota direta: \`/integrations/ai\`.

## 3. Provedores Suportados e Configuração de Chaves
Na página \`/integrations/ai\`, cada provedor possui seu card de configuração:
- **DeepSeek**:
  - Insira sua chave \`DEEPSEEK_API_KEY\`. Modelos: *deepseek-chat*, *deepseek-v4-flash*, *deepseek-coder*. Custo imbatível com altíssima qualidade de raciocínio em português.
- **OpenAI**:
  - Insira sua chave \`OPENAI_API_KEY\`. Modelos: *gpt-4o*, *gpt-4o-mini*, *gpt-4-turbo*.
- **Google Gemini**:
  - Insira sua chave \`GEMINI_API_KEY\`. Modelos: *gemini-1.5-pro*, *gemini-1.5-flash*. Excelente contexto e velocidade.
- **Anthropic Claude**:
  - Insira sua chave \`ANTHROPIC_API_KEY\`. Modelos: *claude-3-5-sonnet*, *claude-3-haiku*.
- **Groq**:
  - Insira sua chave \`GROQ_API_KEY\`. Inferência em chips LPU com respostas ultra-rápidas para *llama-3*.
- **Modelos Locais / Self-Hosted (Ollama / LM Studio)**:
  - Informe a URL base local (ex: \`http://localhost:11434/v1\` ou \`http://localhost:1234/v1\`). Permite rodar modelos open-source sem enviar dados para a nuvem.

## 4. Servidores MCP (Model Context Protocol)
- **Como chegar**: Sidebar > Integrações > **MCP** (rota: \`/integrations/mcp\`).
- **O que é o MCP?** O Model Context Protocol é o padrão aberto da indústria criado pela Anthropic para permitir que agentes de IA se conectem com segurança a bancos de dados externos, APIs internas e servidores de ferramentas em tempo real.
- **Como Adicionar um Servidor MCP**:
  1. Em \`/integrations/mcp\`, clique em **"+ Adicionar Servidor MCP"**.
  2. Forneça o nome descritivo do servidor (ex: *Servidor Estoque ERP*, *Servidor CRM Corporativo*).
  3. Insira a URL do endpoint SSE / HTTP do servidor MCP.
  4. Adicione headers de autenticação (ex: Bearer Token) caso exigido pelo servidor.
  5. Clique em **Testar Conexão e Salvar**.
  6. O Dialogy descobre automaticamente os schemas de ferramentas e as disponibiliza para os Atendentes Inteligentes do Autopilot utilizarem durante o chat.`,
  },
  {
    id: 'd1a10610-0017-4000-8000-000000000017',
    name: 'Integração SGP e ERPs para Provedores de Internet (Telecom)',
    category: 'integrations_sgp',
    contextRole: 'procedure',
    collectionIds: ['provedores-sgp'],
    tags: ['sgp', 'erp', 'provedor', 'fibra', 'faturas', 'pix', 'contratos', 'desbloqueio em confiança'],
    summary: 'Instruções para configurar a integração do SGP no Dialogy e permitir que atendentes e robôs de IA consultem contratos, gerem faturas Pix e realizem desbloqueio em confiança.',
    canonicalAnswer: 'Acesse Integrações > SGP (/integrations/sgp) e informe a URL da API, usuário e token. Uma vez ativo, operadores e robôs de IA podem consultar contratos por CPF/CNPJ, obter faturas em atraso, gerar código Pix Copia e Cola instantâneo e efetuar desbloqueio temporário em confiança.',
    workflowHints: [
      'Indicar rota /integrations/sgp',
      'Descrever a conexão com URL e Token da API do SGP',
      'Listar as capacidades no chat: Contratos, Faturas Pix, Status da ONU e Desbloqueio em Confiança',
    ],
    content: `# Integração SGP e ERPs para Provedores de Internet (Telecom)

## 1. O que é a Integração SGP?
A integração SGP conecta o Dialogy ao software de gestão e faturamento de provedores de internet (ISPs). Ela permite automatizar o atendimento de cobrança, suporte de conectividade e financeiro, reduzindo drasticamente o tempo de atendimento.

## 2. Como Chegar à Configuração do SGP
- Na barra lateral esquerda (Sidebar), clique no ícone de **Integrações** e selecione a opção **SGP**.
- Rota direta: \`/integrations/sgp\`.

## 3. Configuração dos Dados de Acesso
Na página \`/integrations/sgp\`, preencha as credenciais fornecidas pelo seu servidor SGP:
1. **URL Base da API**: Endpoint oficial da API do seu SGP (ex: \`https://sgp.suaempresa.com.br/api/v1\`).
2. **Usuário / App ID**: Identificador da aplicação de integração.
3. **Token de Autenticação / Senha**: Chave segura de acesso à API.
4. Clique em **Testar Conexão e Salvar**. O sistema validará a comunicação imediatamente.

## 4. Funcionalidades Operacionais Disponíveis no Atendimento

### 1. Consulta Automática por CPF ou CNPJ
- Quando o cliente informa o CPF ou CNPJ no chat (ou quando o número de telefone já estiver cadastrado no CRM):
  - O sistema localiza o cadastro no SGP e carrega todos os contratos vinculados.
  - Exibe endereço de instalação, plano contratado, login PPPoE e status do contrato.

### 2. Emissão de Segunda Via e Fatura Pix Instantânea
- O operador humano ou o Atendente Inteligente de IA pode acionar a ferramenta \`sgp_generate_invoice_pix\`:
  - O SGP gera na hora o **código Pix Copia e Cola** com o valor exato da fatura.
  - Envia o código Pix formatado e o link do boleto em PDF diretamente no WhatsApp do cliente.

### 3. Diagnóstico do Status da Conexão (Fibra Óptica / ONU)
- Consulta o status do concentrador/PPPoE:
  - Indica se a conexão do cliente está **Online** ou **Offline**.
  - Exibe data e hora do último logout, facilitando o diagnóstico do suporte antes de agendar visita técnica.

### 4. Desbloqueio Temporário em Confiança
- Para clientes que estão com a conexão suspensa por atraso de pagamento:
  - O operador ou o agente de IA pode validar se o contrato é elegível para desbloqueio temporário.
  - Aciona o comando de desbloqueio em confiança no SGP, liberando a conexão de internet do cliente por até 48 horas enquanto o pagamento é compensado.`,
  },
  {
    id: 'd1a10610-0018-4000-8000-000000000018',
    name: 'Gestão de Equipes, Filas, Horários de Atendimento e Permissões',
    category: 'team_management',
    contextRole: 'procedure',
    collectionIds: ['equipes-permissoes'],
    tags: ['equipes', 'filas', 'membros', 'horário de atendimento', 'business hours', 'permissoes', 'cargos'],
    summary: 'Como criar equipes e departamentos, definir horário de funcionamento semanal com mensagem automática de fora do expediente e configurar permissões de operadores no Dialogy.',
    canonicalAnswer: 'Acesse o menu Equipe & Acesso na Sidebar. Em Equipes (/team) gerencie departamentos e horários de expediente. Em Membros (/team/members) convide operadores por e-mail. Em Permissões (/team/permissions) controle privilégios entre Administrador, Supervisor e Atendente.',
    workflowHints: [
      'Indicar rotas /team, /team/members e /team/permissions',
      'Explicar a configuração do horário de atendimento por dia da semana',
      'Explicar os 3 papéis principais de permissão',
    ],
    content: `# Gestão de Equipes, Filas, Horários de Atendimento e Permissões

## 1. Organização de Equipes e Filas de Atendimento
No Dialogy, atendimentos são roteados com base em Equipes (Departamentos), como Comercial, Suporte N1, Suporte N2, Financeiro e Retenção.

## 2. Como Chegar à Gestão de Equipes
- Na barra lateral esquerda (Sidebar), clique no ícone de **Equipe & Acesso**:
  - **Equipes**: \`/team\`
  - **Membros**: \`/team/members\`
  - **Permissões**: \`/team/permissions\`

## 3. Configurando Equipes e Horários de Atendimento (Business Hours)
1. Acesse \`/team\` e clique no botão **"+ Nova Equipe"** (ou edite uma equipe existente).
2. Dê um nome à equipe (ex: *Suporte Técnico Especializado*).
3. **Membros Associados**: Selecione quais colaboradores fazem parte desse setor.
4. **Horário de Atendimento Semanal (Business Hours)**:
   - Para cada dia da semana (Segunda a Domingo), defina o horário de início e fim do expediente (ex: Segunda a Sexta das 08:00 às 18:00, Sábado das 08:00 às 12:00, Domingo Fechado).
5. **Mensagem de Fora de Expediente (After-Hours Reply)**:
   - Digite a mensagem que o sistema enviará automaticamente caso um cliente entre em contato fora dos horários permitidos (ex: *"Nosso horário de atendimento é de segunda a sexta das 08h às 18h. Registramos sua mensagem e retornaremos no próximo dia útil!"*).
6. Clique em **Salvar Equipe**.

## 4. Convite e Gestão de Membros
1. Acesse \`/team/members\` e clique em **"Convidar Membro"**.
2. Digite o e-mail do colaborador e selecione o cargo inicial.
3. O colaborador receberá um e-mail com link de ativação para definir sua senha de acesso.
4. Na lista de membros, você pode monitorar o status de presença (Online, Ocupado, Offline) de cada um em tempo real.

## 5. Níveis de Acesso e Perfis de Permissão
Na página \`/team/permissions\`, você configura as restrições por cargo:
- **Administrador**: Controle total do workspace. Pode adicionar e remover membros, alterar dados de faturamento, criar integrações, editar robôs e ver todos os chats.
- **Supervisor**: Acesso operacional avançado. Visualiza conversas de todas as equipes, acompanha o Analytics e monitora a produtividade dos operadores.
- **Atendente**: Focado na operação do Inbox. Acessa apenas as conversas que estão atribuídas ao seu usuário ou que estão na fila de espera dos seus setores designados. Bloqueado de ver configurações do workspace ou dados fiscais.`,
  },
  {
    id: 'd1a10610-0019-4000-8000-000000000019',
    name: 'Configurações de Workspace, Perfil, Planos, Atalhos e Central de Suporte',
    category: 'settings_support',
    contextRole: 'procedure',
    collectionIds: ['configuracoes-contas'],
    tags: ['configurações', 'workspace', 'faturamento', 'planos', 'stripe', 'atalhos', 'perfil', 'suporte'],
    summary: 'Como gerenciar as configurações da empresa, fuso horário, templates de mensagens, perfil do usuário, assinatura de planos no Stripe, atalhos de teclado e suporte oficial Dialogy.',
    canonicalAnswer: 'Acesse o menu de conta no rodapé da Sidebar (clique no seu avatar). Lá você encontra Perfil (/settings/profile), Workspace (/settings/workspace), Planos e Faturamento (/settings/billing), Atalhos rápidos (/settings/shortcuts) e Central de Suporte (/support).',
    workflowHints: [
      'Indicar acesso pelo Avatar no rodapé da Sidebar',
      'Descrever /settings/profile, workspace, billing e shortcuts',
      'Destacar o canal oficial de suporte em /support',
    ],
    content: `# Configurações de Workspace, Perfil, Planos, Atalhos e Central de Suporte

## 1. Onde Ficam as Configurações?
Todas as configurações de conta, empresa, faturamento e suporte ficam centralizadas no menu de rodapé da Sidebar:
- Clique no seu **Avatar de Perfil** no canto inferior esquerdo da tela.

## 2. Configurações de Perfil (/settings/profile)
- **Nome e Avatar**: Altere seu nome de exibição e envie sua foto de perfil.
- **Alteração de Senha**: Redefina sua senha de acesso com validação segura.
- **Tema e Idioma**: Defina se prefere o tema Claro ou Escuro e escolha o idioma padrão da interface (Português, Inglês ou Espanhol).

## 3. Configurações do Workspace (/settings/workspace)
- **Nome Fantasia**: O nome oficial da sua empresa no sistema.
- **Fuso Horário (Timezone)**: Fuso horário para registro de data/hora das mensagens e agendamento de campanhas (padrão: \`America/Sao_Paulo\`).
- **Templates Padrão de Mensagens**:
  - *Mensagem de Encerramento*: Texto padrão sugerido ao fechar atendimentos no Inbox.
  - *Mensagem de Transferência*: Mensagem enviada ao cliente quando ele é encaminhado para outro departamento.
- **Medição de Conversão**: Configuração do modo de conversão (deals ganhos) e integração com Google Ads para rastreamento de anúncios do WhatsApp.

## 4. Planos e Faturamento Stripe (/settings/billing)
- Visualização do plano ativo (Starter, Pro, Enterprise).
- Limites de uso contratados: número de operadores autorizados, instâncias de WhatsApp disponíveis e limite de mensagens.
- Histórico de pagamentos com download de faturas e recibos fiscais.
- **Upgrade de Plano**: Clique em "Fazer Upgrade" para alterar seu plano com pagamento seguro via cartão de crédito processado pelo Stripe.

## 5. Atalhos de Teclado e Produtividade (/settings/shortcuts)
- O Dialogy oferece atalhos para que atendentes humanos operem sem tirar as mãos do teclado:
  - Digite \`/\` no início do composer para abrir o menu de respostas rápidas pré-cadastradas.
  - Digite \`@\` para alternar imediatamente para nota interna confidencial.
  - Atalhos de navegação entre conversas anteriores e seguintes na lista do Inbox.

## 6. Central de Suporte e Abertura de Chamados (/support)
- Caso você encontre qualquer dificuldade técnica, inconsistência na plataforma ou dúvida não resolvida:
  - Acesse o menu de conta no rodapé e clique em **Suporte** (rota: \`/support\`).
  - Visualize o histórico de chamados abertos ou clique em **"Novo Chamado"** para enviar sua dúvida diretamente para os engenheiros e especialistas da Dialogy.`,
  },
];
