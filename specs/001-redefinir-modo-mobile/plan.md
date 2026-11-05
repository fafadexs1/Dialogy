# Implementation Plan: Redefinição da Experiência Mobile como Chat Nativo

**Branch**: `001-redefinir-modo-mobile` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-redefinir-modo-mobile/spec.md`

## Summary

Redefinir a experiência móvel do Dialogy através da criação de uma suíte de apresentação dedicada e desacoplada do desktop (`MobileChatList`, `MobileChatView` e `MobileContactSheet`), eliminando as abas inferiores vazias ("CRM" e "Ajustes") e fornecendo navegação fluida em tela cheia com ancoragem perfeita do campo de texto sobre o teclado virtual móvel (`100dvh` / `visualViewport`), mantendo 100% de compatibilidade com o store Zustand (`useInboxStore`) e os eventos em tempo real do Supabase.

## Technical Context

**Language/Version**: TypeScript 5.x / Next.js 15+ (App Router)

**Primary Dependencies**: React 19, Tailwind CSS, Lucide React, Radix UI / Shadcn (Sheet, Dialog, Avatar), Zustand (`useInboxStore`), Supabase Realtime Client

**Storage**: Cache local IndexedDB via Dexie (`cacheService`), PostgreSQL via Prisma (reutilização das tabelas existentes sem migrações de banco)

**Testing**: Vitest (`npx vitest`), TypeScript compiler check (`next typegen && tsc --noEmit`)

**Target Platform**: Navegadores móveis (Safari no iOS, Chrome no Android, modo PWA tela cheia) em viewports `< 768px`

**Project Type**: Web application / Mobile-First responsive chat view

**Performance Goals**: Transição imediata entre lista e conversa (< 100ms), 60fps de rolagem de histórico, zero sobreposição ou pulo de tela ao abrir/fechar o teclado virtual

**Constraints**: Respeito a áreas seguras (`safe-area-inset-top`, `safe-area-inset-bottom`), suporte a gestos de toque confortáveis com uma mão só (alvos mínimos de 44x44px)

**Scale/Scope**: 1 layout orquestrador refatorado (`mobile-chat-layout.tsx`) + 3 componentes dedicados em `src/components/chat/mobile/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Princípio I (Isolamento Multi-Tenant)**: APROVADO. Todas as consultas e mutações de dados permanecem isoladas estritamente por `workspaceId`.
- **Princípio II (Tipagem Estrita TypeScript)**: APROVADO. Todos os novos componentes e contratos utilizam tipos estritos sem `any` implícito, validados por `npm run typecheck`.
- **Princípio III (Resiliência de Canais)**: APROVADO. Reutiliza o subsistema de broadcast com canais privados (`workspace:*` e `room:*`) e recuperação debounced de sincronização.
- **Princípio IV (Verificação e Testes)**: APROVADO. Suíte Vitest cobre as transições de estado, visibilidade e fluxo de concorrência.
- **Princípio V (Observabilidade)**: APROVADO. Manutenção de logs estruturados de depuração (`inboxDebug`) para diagnóstico de eventos de interface móvel.

## Project Structure

### Documentation (this feature)

```text
specs/001-redefinir-modo-mobile/
├── spec.md              # Feature specification
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Technical research & decisions (Phase 0)
├── data-model.md        # Entities & UI View State (Phase 1)
├── quickstart.md        # Verification & test guide (Phase 1)
└── contracts/           # Component interface contracts (Phase 1)
    └── mobile-chat-ui.contract.md
```

### Source Code Layout

```text
src/
├── components/
│   ├── chat/
│   │   ├── mobile/
│   │   │   ├── mobile-chat-list.tsx      # Lista de conversas móvel com busca e abas
│   │   │   ├── mobile-chat-view.tsx      # Conversa em tela cheia com cabeçalho compacto
│   │   │   ├── mobile-message-input.tsx  # Barra de digitação ancorada ao visualViewport
│   │   │   └── mobile-contact-sheet.tsx  # Gaveta inferior para ações e dados do lead
│   │   └── mobile-contact-panel.tsx      # Base existente reutilizada/estendida
│   └── layout/
│       ├── mobile-chat-layout.tsx        # Orquestrador móvel principal refatorado
│       └── responsive-inbox-layout.tsx   # Alternador responsivo (< 768px)
tests/
├── mobile-inbox-reconciliation.spec.ts   # Testes de reconciliação móvel
└── chat-realtime-status-update.spec.ts   # Testes de estado e transição de chamados
```

## Complexity Tracking

> Nenhuma violação constitucional detectada. O escopo é 100% contido na camada de apresentação (UI), eliminando complexidade desnecessária e reaproveitando a infraestrutura de dados existente.
