# UI Component Contracts: Redefinição da Experiência Mobile como Chat Nativo

**Feature**: `001-redefinir-modo-mobile` | **Date**: 2026-09-14

## Overview

Este documento define os contratos de propriedades, eventos e comportamento dos componentes da interface móvel desacoplada.

---

## 1. `MobileChatLayout` (Orquestrador Móvel)

**Arquivo**: `src/components/layout/mobile-chat-layout.tsx`

### Props
```typescript
export interface MobileChatLayoutProps {
  initialUser: User;
  chatId: string | null;
  initialData: InitialChatsPayload | null;
  preserveClientState?: boolean;
}
```

### Comportamento
- Gerencia o ciclo de vida do layout móvel em viewport `< 768px`.
- Mantém o listener do Realtime Supabase (`handleRealtimeChatUpdate`) e recuperação debounced de sincronização (`scheduleDebouncedDeltaSync`).
- Renderiza condicionalmente:
  - `selectedChatId === null` → `<MobileChatList />`
  - `selectedChatId !== null` → `<MobileChatView />`

---

## 2. `MobileChatList` (Lista de Conversas Móvel)

**Arquivo**: `src/components/chat/mobile/mobile-chat-list.tsx`

### Props
```typescript
export interface MobileChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  currentUser: User;
  ownershipFilter: 'mine' | 'everyone';
  onOwnershipFilterChange: (filter: 'mine' | 'everyone') => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}
```

### Eventos e Ações
- **Busca em tempo real**: Filtragem local instantânea por nome, telefone e protocolo.
- **Seleção de fila**: Abas horizontais comutando entre `robo`, `gerais` (Fila), `atendimentos` (Atendendo) e `encerrados`.
- **Badge de contagem**: Exibe a quantidade de conversas ativas por fila consumindo `inboxCounts` do `useInboxStore`.

---

## 3. `MobileChatView` (Conversa em Tela Cheia)

**Arquivo**: `src/components/chat/mobile/mobile-chat-view.tsx`

### Props
```typescript
export interface MobileChatViewProps {
  chat: Chat;
  currentUser: User;
  onBack: () => void;
  onActionSuccess?: () => void;
  closeReasons?: CloseReasonTag[];
  workspaceTimezone?: string;
}
```

### Sub-componentes e Contratos
1. **`MobileChatHeader`**:
   - Botão de voltar `ArrowLeft` (dispara `onBack`);
   - Avatar do contato + nome truncado + status visual;
   - Toque em qualquer ponto do cabeçalho dispara abertura do `MobileContactSheet`.
2. **`MobileMessageList`**:
   - Renderização virtual/otimizada de `chat.messages`;
   - Balões com formatação de data/hora, status de entrega (`sent`/`delivered`/`read`), player de áudio integrado e preview de imagem;
   - Rolagem automática ao receber nova mensagem.
3. **`MobileMessageInput`**:
   - Ancoragem ao `visualViewport` via classe `h-[100dvh]` e padding dinâmico;
   - Caixa de texto auto-expansível;
   - Ação de envio de texto e envio de áudio/mídia.

---

## 4. `MobileContactSheet` (Gaveta de Contexto do Contato)

**Arquivo**: `src/components/chat/mobile/mobile-contact-sheet.tsx`

### Props
```typescript
export interface MobileContactSheetProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  currentUser: User;
  closeReasons?: CloseReasonTag[];
  onTransferSuccess?: () => void;
  onCloseSuccess?: () => void;
}
```

### Funcionalidades Integradas
- Visualização de Telefone, E-mail, Protocolo e Canal;
- Gerenciamento de Etiquetas/Tags;
- Botão "Transferir Conversa" (abre diálogo de seleção de atendente);
- Botão "Encerrar Atendimento" (abre diálogo com seleção de motivo e notas).
