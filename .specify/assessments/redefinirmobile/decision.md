# Decision: Redefinição da Experiência Mobile como Chat Nativo

- **Slug**: redefinirmobile
- **Decided**: 2026-09-14
- **Verdict**: go
- **Artifacts reviewed**: intake.md | research.md | problem.md | concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | strong | A interface móvel atual é um encapsulamento do desktop (`ChatPanel.tsx` com 2.800+ linhas) com botões pequenos de mouse e abas estáticas vazias; a fricção operacional em smartphones é real e recorrente. |
| Evidence strength | adequate | Validado diretamente no código-fonte dos layouts móveis (`mobile-chat-layout.tsx`), nas limitações documentadas do Visual Viewport e nos padrões de referência da indústria (WhatsApp/Telegram). |
| Value vs. inaction | strong | Entregar uma experiência de chat rápida evita que atendentes usem canais pessoais não monitorados e destrava a resposta imediata a leads e clientes fora do computador. |
| Feasibility / appetite | strong | A Opção B (Interface Mobile Dedicada) reaproveita 100% do estado Zustand (`useInboxStore`) e do Realtime já existentes, exigindo apenas a criação de uma camada de apresentação móvel limpa dentro de um apetite médio (semanas). |
| Strategic fit | strong | Alinhado com os princípios constitucionais do Dialogy de excelência na experiência conversacional e isolamento modular. |
| Risk posture | strong | Riscos de sobreposição de teclado e manutenção identificados; mitigados por container `100dvh`/`visualViewport`, desacoplamento da UI do desktop e uso de *bottom sheets* para ações secundárias. |

## Verdict & Rationale

**Veredito: GO.**
A iniciativa foi aprovada para avançar ao Spec-Driven Development com a **Opção B (Interface Mobile Dedicada e Limpa - Mobile-First Web View)**. O problema é legítimo, a solução é viável sem complexidades de distribuição em lojas de aplicativos e o impacto na produtividade dos atendentes é imediato. Ao reutilizar a camada de dados e isolar a visualização móvel do complexo componente desktop, o projeto garante qualidade sem criar dívida técnica.

## If go — Handoff to `/speckit-specify`

- **Problem**: Atendentes e gestores no smartphone lidam com uma interface de desktop comprimida que sofre com botões pequenos, poluição visual e teclado virtual cobrindo o campo de digitação; é necessária uma experiência de mensageria com fluidez nativa (estilo WhatsApp / Telegram).
- **Chosen approach**: Opção B — Interface Mobile Dedicada e Limpa (Mobile-First Web View), com arquitetura de 2 telas (Lista Enxuta e Chat em Tela Cheia), teclado ancorado com estabilidade (`100dvh` / `visualViewport`) e ações secundárias centralizadas em *bottom sheet*.
- **In scope / out of scope**:
  - *In scope*: Substituição do wrap do `ChatPanel`/`ChatList` no `MobileChatLayout` por `MobileChatListView` e `MobileChatView` dedicados; remoção das abas inferiores estáticas ("CRM" e "Ajustes"); gaveta inferior deslizante para contexto do contato, tags, encerramento e transferência; suporte a safe-area de iOS e Android.
  - *Out of scope*: Compilação e publicação de aplicativo nativo via Expo (EAS / lojas); construtor de automações (Agent Studio) e relatórios avançados em smartphone; alterações em rotas de backend ou esquemas de banco de dados.
- **Success metrics**: Zero ocorrências de teclado cobrindo o input de digitação; navegação fluida em 1 toque entre lista e conversa aberta; operação confortável com uma só mão.
- **Carried-forward open questions**:
  - Refinar no `spec.md` os detalhes dos micro-componentes do chat (anexos rápidos, gravação de áudio móvel e visualização de mídias).
  - Avaliar inclusão de gestos táteis adicionais (como swipe para voltar ou swipe para responder).
