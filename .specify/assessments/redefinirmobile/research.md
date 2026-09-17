# Idea Research: Redefinição da Experiência Mobile como Chat Nativo

- **Slug**: redefinirmobile
- **Created**: 2026-09-14
- **Evidence confidence (overall)**: medium

## Users & Demand

- **Operadores remotos e em trânsito**: Atendentes, gestores e vendedores utilizam smartphones para responder clientes fora do horário comercial ou durante deslocamentos, exigindo resposta rápida em uma mão só — [source: `src/components/layout/mobile-chat-layout.tsx` e histórico de produto | ASSUMPTION] (confidence: medium).
- **Insatisfação com interfaces híbridas desktop**: Usuários relatam que a interface móvel atual se comporta como uma versão desktop comprimida em vez de um aplicativo de chat de smartphone, gerando atritos visuais e perda de agilidade — [source: intake.md | ASSUMPTION] (confidence: medium).
- **Comportamento observado**: No código atual de `mobile-chat-layout.tsx`, existem abas de navegação inferior ("CRM", "Ajustes") que exibem telas estáticas com selos "Em breve" (linhas 1823, 1832, 1841), demonstrando que o foco primário e útil do operador no celular é 100% a conversa de atendimento — [source: `src/components/layout/mobile-chat-layout.tsx:1803-1860`] (confidence: high).

## Prior Art

- **Interno (Next.js Web - `mobile-chat-layout.tsx`)**: Tenta reutilizar os mesmos componentes do desktop (`ChatList` e `ChatPanel`), aplicando classes condicionais (`md:hidden`/`md:flex`). Resulta em cabeçalhos pesados, múltiplos botões pequenos, modais desktop reduzidos e problemas de redimensionamento do teclado virtual — [source: `src/components/layout/mobile-chat-layout.tsx` e `src/components/chat/chat-panel.tsx`] (confidence: high).
- **Interno (React Native / Expo - pasta `/mobile`)**: Existe um projeto Expo no repositório (`mobile/README.md`) criado como protótipo de aplicativo nativo com API dedicada (`/api/mobile/inbox/bootstrap`). No entanto, ele requer compilação/distribuição via EAS (APK/IPA) e não é o ambiente primário de acesso web/PWA dos clientes atuais — [source: `mobile/README.md`] (confidence: high).
- **Interno (`MobileContactPanel`)**: O painel de contato já foi convertido em uma gaveta inferior deslizante (`Sheet side="bottom"`), mostrando que padrões mobile nativos (bottom sheets) funcionam bem na base de código — [source: `src/components/chat/mobile-contact-panel.tsx:51-65`] (confidence: high).
- **Externo (WhatsApp Web Mobile / Telegram Web / Chatwoot Mobile)**: Adotam arquitetura estrita de duas telas: (1) Lista limpa de conversas com pesquisa e abas horizontais; (2) Tela de conversa em tela cheia com cabeçalho compacto (avatar + nome + botão voltar), mensagens em balões ergonômicos e barra de input fixa acoplada ao teclado virtual — [source: Análise de UX comparada de mensageria móvel | ASSUMPTION] (confidence: high).

## Market & Context

- **Padrão mental do usuário**: No Brasil e na América Latina, o WhatsApp é a referência universal de usabilidade de chat. Qualquer ferramenta de atendimento no celular que desvie dessa ergonomia (ex: menus complexos, cliques extras para ver mensagens, inputs fora de foco) gera frustração imediata no operador — [source: ASSUMPTION] (confidence: high).
- **Custo de não fazer nada**: Operadores continuam usando o celular apenas para emergências, cometendo erros de envio ou fechamento de conversas por toques acidentais em botões pequenos feitos para mouse, ou abandonam o atendimento móvel aguardando retorno ao computador — [source: ASSUMPTION] (confidence: medium).

## Data & Constraints

- **Viewport e Teclado Virtual (iOS Safari / Android Chrome)**: O uso de `100vh` em browsers mobile faz com que o teclado virtual cubra o campo de digitação ou cause pulos na tela. O layout mobile precisa utilizar `dvh` (`100dvh`), `interactive-widget=resizes-content` na meta viewport, e/ou escuta do `window.visualViewport` — [source: Especificação W3C Visual Viewport API e padrões Tailwind `h-dvh`] (confidence: high).
- **Áreas Seguras de Dispositivos (Safe Area Insets)**: Notches, ilha dinâmica (Dynamic Island) e barras de navegação por gestos de iPhones/Android modernos requerem aplicação estrita de `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)` — [source: `src/components/chat/chat-panel.tsx:2143`] (confidence: high).
- **Unificação de Estado e Realtime**: O modo mobile não precisa reinventar a camada de dados: ele já consome com sucesso o `useInboxStore` (Zustand) e as assinaturas Supabase Realtime (`workspace:*` e `room:*`), o que permite focar exclusivamente na camada de apresentação/UI — [source: `src/components/layout/mobile-chat-layout.tsx:1470-1530`] (confidence: high).

## Evidence Against the Idea

- **Duplicação da camada de visualização do chat**: Se criarmos um componente `MobileChatView` ou refatorarmos o layout mobile para ser independente do `ChatPanel` desktop, novas funcionalidades de chat (novos tipos de anexo, ações de IA, players de mídia) precisarão ser mantidas ou adaptadas em dois locais.
- **Dilema Web PWA vs. App Nativo Expo**: A existência da pasta `/mobile` com Expo pode gerar confusão de direcionamento técnico. Redesenhar o modo mobile no Next.js (web/PWA) atende imediatamente a todos os operadores que usam navegador no celular sem exigir publicação na App Store / Google Play, mas não oferece notificações push nativas em segundo plano sem configuração de Web Push APNs no iOS.

## Gaps & Open Questions

- [NEEDS CLARIFICATION: O objetivo imediato é aprimorar o modo mobile do Next.js (Web/PWA acessível no navegador do celular) ou finalizar o aplicativo nativo Expo na pasta `/mobile`?]
- [NEEDS CLARIFICATION: A navegação inferior com abas de "CRM" e "Configurações" (atualmente estáticas) deve ser removida para focar 100% no fluxo de mensagens, ou mantida com funcionalidades reduzidas?]
- [NEEDS CLARIFICATION: Quais recursos do ChatPanel desktop podem ser simplificados ou ocultados no mobile para despoluir a tela (ex: copiloto de sugestão de IA flutuante, seleção de instâncias, tags complexas)?]

## Sources

- Repositório local: `src/components/layout/mobile-chat-layout.tsx`
- Repositório local: `src/components/chat/chat-panel.tsx`
- Repositório local: `src/components/chat/mobile-contact-panel.tsx`
- Repositório local: `mobile/README.md`
- Intake original: `.specify/assessments/redefinirmobile/intake.md`
