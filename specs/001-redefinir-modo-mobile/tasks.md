# Tasks: Redefinição da Experiência Mobile como Chat Nativo

**Branch**: `001-redefinir-modo-mobile` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Inicialização da infraestrutura móvel desacoplada e definições de tokens CSS.

- [X] T001 [P] Create mobile chat component directory `src/components/chat/mobile/` and define TypeScript interfaces in `src/types/mobile-chat.ts` for `MobileViewState` (`activeChatId: string | null`, `activeTab: MobileInboxTab`, `searchQuery: string`, `isContactSheetOpen: boolean`, `isTransferDialogOpen: boolean`, `isCloseDialogOpen: boolean`), `MobileInboxTab` (`'robo' | 'gerais' | 'atendimentos' | 'encerrados'`), and `MobileKeyboardMetrics` (`isOpen: boolean`, `keyboardHeight: number`, `viewportHeight: number`)
- [X] T002 [P] Configure mobile safe-area utility classes and dynamic viewport tokens (`h-[100dvh]`, `pt-[env(safe-area-inset-top)]`, `pb-[env(safe-area-inset-bottom)]`) in `src/app/globals.css`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pré-requisitos fundamentais que bloqueiam a implementação das histórias de usuário.

**⚠️ CRITICAL**: Nenhuma história de usuário deve ser iniciada até a conclusão desta fase.

- [X] T003 [P] Implement `useVisualViewport` hook in `src/hooks/use-visual-viewport.ts` listening to `window.visualViewport` `resize` and `scroll` events to update `MobileKeyboardMetrics` (`isOpen: boolean`, `keyboardHeight: number`, `viewportHeight: number`) and dynamic CSS variable `--keyboard-offset`
- [X] T004 [P] Create Vitest unit test suite for mobile navigation state and visual viewport calculations in `tests/mobile-view-state.spec.ts`
- [X] T005 Configure Next.js viewport export with `interactive-widget=resizes-content` in `src/app/layout.tsx` to ensure native Android Chrome content resizing when keyboard opens

**Checkpoint**: Base de viewport e tipos estabelecida — o desenvolvimento das histórias de usuário pode começar.

---

## Phase 3: User Story 1 - Atendimento e Conversação em Tela Cheia (Priority: P1) 🎯 MVP

**Goal**: Permitir ao atendente visualizar e responder mensagens em tela cheia (100% viewport) com balões legíveis, cabeçalho limpo com avatar e nome, e botão de retorno (`←`) para a lista.

**Independent Test**: Tocar em qualquer conversa na lista abre o chat ocupando 100% da tela; o cabeçalho exibe botão de voltar (`←`), avatar e nome do cliente; tocar em `←` retorna para a lista sem perda de estado.

### Tests for User Story 1 ⚠️

> **NOTE: Escrever os testes primeiro e garantir que falhem antes da implementação**

- [X] T006 [P] [US1] Create unit test in `tests/mobile-chat-view.spec.ts` validating fullscreen rendering, back button navigation triggering `onBack`, and message rendering from `useInboxStore`

### Implementation for User Story 1

- [X] T007 [P] [US1] Implement `MobileChatHeader` component in `src/components/chat/mobile/mobile-chat-header.tsx` with `ArrowLeft` back button, contact avatar fallback, truncated contact name, connection status badge, and click trigger for contact sheet
- [X] T008 [P] [US1] Implement `MobileMessageList` and `MobileMessageBubble` in `src/components/chat/mobile/mobile-message-list.tsx` supporting message `type` (`'text' | 'image' | 'audio' | 'video' | 'document' | 'system'`), delivery `status` (`'sent' | 'delivered' | 'read' | 'pending' | 'failed'`), timestamp formatting, audio player, and auto-scroll to bottom
- [X] T009 [US1] Implement `MobileChatView` container in `src/components/chat/mobile/mobile-chat-view.tsx` integrating `MobileChatHeader`, `MobileMessageList`, back button handler calling `onBack`, and messages state from `useInboxStore`
- [X] T010 [US1] Update `src/components/layout/mobile-chat-layout.tsx` to conditionally render `MobileChatView` in full viewport (`h-[100dvh]`) when `selectedChatId !== null`, passing `onBack` handler that clears `selectedChatId` and syncs URL via `replaceChatPath`

**Checkpoint**: User Story 1 funcional de forma independente (MVP: Atendimento e leitura em tela cheia com navegação limpa).

---

## Phase 4: User Story 2 - Estabilidade e Visibilidade do Campo de Digitação com Teclado Virtual (Priority: P1)

**Goal**: Garantir que a barra de digitação e o botão de envio fiquem perfeitamente ancorados imediatamente acima do teclado virtual em iOS e Android, sem que o teclado cubra o texto digitado.

**Independent Test**: Focar no campo de digitação em dispositivo móvel; o teclado virtual se abre e a barra de texto é reposicionada sobre ele; digitação de múltiplas linhas expande o campo até 4 linhas sem quebrar o layout; o botão de envio permanece visível e acionável.

### Tests for User Story 2 ⚠️

- [X] T011 [P] [US2] Create unit test in `tests/mobile-message-input.spec.ts` verifying keyboard height offset calculation, multi-line auto-expansion, and send action dispatching

### Implementation for User Story 2

- [X] T012 [P] [US2] Create `MobileMessageInput` component in `src/components/chat/mobile/mobile-message-input.tsx` with auto-expanding textarea (up to 4 lines, minimum `16px` font size to prevent iOS zoom), attachment trigger (`+`), audio record button, and send button (minimum 44x44px touch targets)
- [X] T013 [US2] Integrate `useVisualViewport` hook in `src/components/chat/mobile/mobile-message-input.tsx` applying dynamic bottom padding / offset corresponding to `keyboardHeight` and safe-area inset `pb-[env(safe-area-inset-bottom)]`
- [X] T014 [US2] Wire `MobileMessageInput` send actions to `src/components/chat/mobile/mobile-chat-view.tsx` invoking `guardedSendAgentMessage` from `useInboxStore`, clearing input draft on success and retaining textarea focus for continuous typing

**Checkpoint**: User Stories 1 e 2 funcionais juntas — atendimento em tela cheia com digitação estável e ancorada sobre o teclado.

---

## Phase 5: User Story 3 - Gestão do Atendimento e Contexto via Gaveta Deslizante (Priority: P2)

**Goal**: Centralizar dados cadastrais do cliente, etiquetas, notas internas, diálogo de transferência de conversa e fluxo de encerramento em uma gaveta inferior deslizante (`Sheet side="bottom"`), acessível ao tocar no cabeçalho do chat.

**Independent Test**: Tocar no cabeçalho do cliente com a conversa aberta; uma gaveta inferior se abre exibindo telefone, tags e notas; o operador pode transferir o chamado ou encerrar com seleção de motivo em no máximo 3 toques.

### Tests for User Story 3 ⚠️

- [X] T015 [P] [US3] Create unit test in `tests/mobile-contact-sheet.spec.ts` validating sheet open/close lifecycle, transfer submission payload, and close conversation dialog flow

### Implementation for User Story 3

- [X] T016 [P] [US3] Implement `MobileContactSheet` component in `src/components/chat/mobile/mobile-contact-sheet.tsx` using Radix/Shadcn `Sheet` with `side="bottom"`, displaying contact phone, email, channel, protocol, tags, and internal notes
- [X] T017 [US3] Integrate "Transferir Conversa" flow into `MobileContactSheet` in `src/components/chat/mobile/mobile-contact-sheet.tsx` displaying available agents and teams for one-tap transfer confirmation
- [X] T018 [US3] Integrate "Encerrar Atendimento" flow into `MobileContactSheet` in `src/components/chat/mobile/mobile-contact-sheet.tsx` with `closeReasons` (`CloseReasonTag[]`) selector, optional resolution notes, and callback returning to conversation list
- [X] T019 [US3] Connect `MobileContactSheet` open/close state trigger to header click in `src/components/chat/mobile/mobile-chat-view.tsx`

**Checkpoint**: User Stories 1, 2 e 3 funcionais — atendimento, digitação e gestão completa (transferir/encerrar) disponíveis no mobile.

---

## Phase 6: User Story 4 - Triage e Filtragem Rápida na Lista de Conversas (Priority: P3)

**Goal**: Fornecer lista limpa e veloz para triagem, com seletores horizontais de fila (*Robô*, *Fila*, *Atendendo*, *Encerrados*), busca por texto em tempo real e badges de mensagens não lidas.

**Independent Test**: Na tela de lista móvel, alternar entre as abas filtra instantaneamente os contatos exibidos; digitar um termo busca contatos por nome ou número; badges numéricos refletem conversas não lidas.

### Tests for User Story 4 ⚠️

- [X] T020 [P] [US4] Create unit test in `tests/mobile-chat-list.spec.ts` verifying tab filtering (`'robo' | 'gerais' | 'atendimentos' | 'encerrados'`), text search filtering, and unread badge display

### Implementation for User Story 4

- [X] T021 [P] [US4] Implement `MobileChatCard` item component in `src/components/chat/mobile/mobile-chat-card.tsx` displaying contact avatar, name, channel indicator, last message snippet, formatted timestamp, and unread badge (`unreadCount: number`)
- [X] T022 [US4] Implement `MobileChatList` component in `src/components/chat/mobile/mobile-chat-list.tsx` featuring search bar, horizontal queue tabs (`'robo' | 'gerais' | 'atendimentos' | 'encerrados'`) with real-time badges from `useInboxStore.inboxCounts`, and virtualized list of `MobileChatCard`
- [X] T023 [US4] Connect ownership toggle (`'mine' | 'everyone'`) and infinite scroll loading (`onLoadMore`, `hasMore`, `isLoadingMore`) in `src/components/chat/mobile/mobile-chat-list.tsx`
- [X] T024 [US4] Wire `MobileChatList` into `src/components/layout/mobile-chat-layout.tsx` when `selectedChatId === null`, triggering `onSelectChat` to open `MobileChatView`

**Checkpoint**: Todas as 4 histórias de usuário funcionais de ponta a ponta.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Remoção do shell legado com abas estáticas, verificação de qualidade e testes de regressão.

- [X] T025 Remove legacy bottom navigation bar ("CRM" and "Ajustes" placeholder tabs) and dead shell wrappers from `src/components/layout/mobile-chat-layout.tsx`
- [X] T026 Finalize mobile layout orchestration in `src/components/layout/mobile-chat-layout.tsx` ensuring clean switching between `<MobileChatList />` (when `selectedChatId === null`) and `<MobileChatView />` (when `selectedChatId !== null`)
- [X] T027 Run automated Vitest test suite `npx vitest run tests/mobile-*.spec.ts` ensuring all tests pass
- [X] T028 Run strict TypeScript verification `npm run typecheck` (`next typegen && tsc --noEmit`) and verify 0 errors
- [X] T029 Validate manual verification scenarios according to `specs/001-redefinir-modo-mobile/quickstart.md` in mobile emulation mode

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — execução imediata.
- **Foundational (Phase 2)**: Depende de Phase 1 — BLOQUEIA todas as histórias de usuário.
- **User Story 1 (Phase 3 - P1)**: Depende de Phase 2 — Entrega o MVP.
- **User Story 2 (Phase 4 - P1)**: Depende de Phase 2 e integra com `MobileChatView` de US1.
- **User Story 3 (Phase 5 - P2)**: Depende de Phase 2 e integra com o cabeçalho de `MobileChatView`.
- **User Story 4 (Phase 6 - P3)**: Depende de Phase 2 — Pode ser desenvolvido em paralelo com US2/US3.
- **Polish (Phase 7)**: Depende da conclusão das histórias de usuário desejadas.

### User Story Completion Order

```text
Foundational (Phase 2)
        │
        ├──> User Story 1 (P1: Conversação Tela Cheia) ──> [MVP VALIDADO]
        │           │
        │           ├──> User Story 2 (P1: Teclado Virtual & Input)
        │           │
        │           └──> User Story 3 (P2: Bottom Sheet & Ações)
        │
        └──> User Story 4 (P3: Lista Limpa, Busca & Abas)
                    │
                    v
            Polish & Regression (Phase 7)
```

---

## Parallel Opportunities

- **Phase 1**: `T001` (tipos) e `T002` (CSS safe-area) podem ser executados em paralelo.
- **Phase 2**: `T003` (`useVisualViewport`) e `T004` (testes base) podem ser executados em paralelo.
- **Phase 3 (US1)**: `T006` (teste), `T007` (`MobileChatHeader`) e `T008` (`MobileMessageList`) podem ser executados em paralelo.
- **Phase 4 (US2)**: `T011` (teste) e `T012` (`MobileMessageInput`) podem ser executados em paralelo.
- **Phase 5 (US3)**: `T015` (teste) e `T016` (`MobileContactSheet`) podem ser executados em paralelo.
- **Phase 6 (US4)**: `T020` (teste) e `T021` (`MobileChatCard`) podem ser executados em paralelo.

---

## Parallel Example: User Story 1

```bash
# Executar testes e subcomponentes de US1 em paralelo:
Task T006: "Create unit test in tests/mobile-chat-view.spec.ts"
Task T007: "Implement MobileChatHeader in src/components/chat/mobile/mobile-chat-header.tsx"
Task T008: "Implement MobileMessageList in src/components/chat/mobile/mobile-message-list.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Completar Phase 1: Setup (`src/types/mobile-chat.ts`, `globals.css`).
2. Completar Phase 2: Foundational (`useVisualViewport`, metadata de viewport).
3. Completar Phase 3: User Story 1 (`MobileChatHeader`, `MobileMessageList`, `MobileChatView`).
4. **STOP & VALIDATE**: Testar abertura de conversa em tela cheia e retorno à lista.

### Incremental Delivery
1. **Incremento 1 (MVP)**: US1 — Conversa em tela cheia funcional com botão de voltar.
2. **Incremento 2**: US2 — Ancoragem perfeita do teclado virtual e expansão de texto.
3. **Incremento 3**: US3 — Bottom sheet para transferência e encerramento com motivo.
4. **Incremento 4**: US4 — Lista mobile com busca em tempo real e abas horizontais de fila.
5. **Incremento 5**: Phase 7 — Remoção de código legado, testes de regressão e typecheck final.
