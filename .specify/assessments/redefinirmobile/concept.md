# Concept: Redefinição da Experiência Mobile como Chat Nativo

- **Slug**: redefinirmobile
- **Created**: 2026-09-14
- **Recommended option**: Option B — Interface Mobile Dedicada e Limpa (Mobile-First Web View)

## Options

### Option A — Refatoração de CSS Responsivo no Layout Atual
- **Sketch**: Mantém a estrutura atual compartilhada baseada em `ChatList` e `ChatPanel`, aplicando correções cosméticas via CSS/Tailwind: remoção da barra de abas inferior ("CRM" e "Ajustes"), ajuste de `100dvh` no container e aumento de espaçamentos para toque em botões existentes.
- **Appetite**: small (dias)
- **Trade-offs**:
  - *Ganha*: Menor tempo inicial de código, sem novos arquivos de componentes principais.
  - *Sacrifica*: Continua acoplado ao `ChatPanel` desktop (mais de 2.800 linhas com dezenas de popovers, atalhos de teclado e handlers de mouse). A experiência continuará parecendo um site comprimido e qualquer manutenção no desktop terá alto risco de quebrar o mobile.
- **Rabbit holes**: A cascata de divs e estilos flex/grid do `ChatPanel` desktop dificulta a estabilização perfeita do teclado virtual no iOS Safari sem quebras colaterais.

### Option B — Interface Mobile Dedicada e Limpa (Mobile-First Web View)
- **Sketch**: Constrói uma visão de chat mobile dedicada e desacoplada visualmente do desktop (`MobileChatView` e `MobileChatListView`), consumindo o mesmo estado Zustand (`useInboxStore`) e as mesmas assinaturas Realtime. Remove completamente a navegação inferior com abas "Em breve" e foca em duas telas puras: (1) Lista de conversas com abas horizontais e busca rápida; (2) Tela de conversa em tela cheia com cabeçalho compacto (avatar, nome, status, botão voltar), balões ergonômicos e barra de digitação colada com precisão no teclado virtual (`100dvh` / `visualViewport`), com todas as ações de gestão (dados do lead, encerramento, transferência e notas) centralizadas em uma gaveta inferior deslizante (*bottom sheet*).
- **Appetite**: medium (semanas)
- **Trade-offs**:
  - *Ganha*: Experiência idêntica a aplicativos de mensagens líderes (estilo WhatsApp / Telegram). Teclado virtual 100% estável. Zero poluição visual. Manutenção do desktop totalmente isolada e protegida.
  - *Sacrifica*: Exige manter dois componentes de apresentação de chat (`ChatPanel` para desktop e `MobileChatView` para smartphone).
- **Rabbit holes**: Tentar portar de imediato recursos secundários do desktop (como copiloto de IA com sugestões flutuantes complexas ou edição avançada de rich text).

### Option C — Migração Total para o Aplicativo Nativo Expo (`/mobile`)
- **Sketch**: Descontinuar o modo mobile web e concentrar os esforços em finalizar o app React Native / Expo presente na pasta `/mobile`, publicando-o como aplicativo nas lojas Google Play e Apple App Store.
- **Appetite**: large (meses)
- **Trade-offs**:
  - *Ganha*: Notificações push nativas em segundo plano sem depender de Service Worker/APNs Web e performance nativa de sistema operacional.
  - *Sacrifica*: Ciclo de desenvolvimento muito mais lento e burocrático (aprovação nas lojas, compilação EAS, distribuição em aparelhos de funcionários). Impede o acesso rápido e direto pelo navegador do celular.
- **Rabbit holes**: Processo de revisão e rejeições na Apple App Store / Google Play, além de onboarding complexo para clientes corporativos.

## Recommendation

**Recomendamos a Option B (Interface Mobile Dedicada e Limpa)**.
Ela resolve diretamente a dor central relatada pelo usuário (*"deixar o modo mobile realmente um modo Mobile como se fosse um chat"*) sem a complexidade burocrática das lojas de aplicativos (Option C) e sem carregar a dívida técnica do desktop que condena a Option A à fragilidade. Ao desacoplar a apresentação mobile e reutilizar a camada de dados e Realtime já existente no `useInboxStore`, o Dialogy entrega usabilidade de ponta com um orçamento de esforço equilibrado e seguro.

## Out of Scope (for the recommended option)

- Distribuição de executáveis nativos (APK / IPA / EAS build) para lojas de aplicativos.
- Construtor de automações (Agent Studio) e telas analíticas densas de relatórios no smartphone.
- Reformulação da API do backend ou mudanças em tabelas do banco de dados (reutiliza os contratos e stores atuais).
- Copiloto de IA avançado com sugestões flutuantes sobre o chat no mobile (pode ser simplificado ou mantido em botão discreto).

## Assumptions to Validate

- O hook `useInboxStore` e as rotas de API atuais fornecem todos os dados necessários para renderizar a lista e a conversa sem modificações de backend.
- O navegador móvel (Safari no iOS e Chrome no Android) comporta a navegação em tela cheia com transição suave entre a lista de chats e a conversa ativa sem recarregar a página.
- A remoção das abas inferiores ("CRM" e "Ajustes") com selos "Em breve" não afeta negativamente nenhum fluxo ativo de usuários em produção.
