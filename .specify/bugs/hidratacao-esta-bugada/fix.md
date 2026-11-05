# Bug Fix: Falha de Sincronização em Tempo Real ao Encerrar ou Transferir Chats

- **Slug**: hidratacao-esta-bugada
- **Fixed**: 2026-09-14
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Corrigida a perda de eventos em tempo real configurando `{ config: { private: true } }` nos canais de publicação do Supabase (`workspace:*` e `room:*`), evitando descarte silencioso pelo servidor Realtime. Além disso, foi corrigido o manipulador de eventos no layout do chat para não abortar a atualização de status de conversas selecionadas e disparar o recálculo/sync debounced dos contadores de abas, e adicionado o broadcast faltante no encerramento de conversas via API de agente.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/lib/realtime/broadcast.ts` | modified | Adicionada detecção e configuração de `{ config: { private: true } }` para tópicos `workspace:*` e `room:*` tanto no envio REST quanto no fallback WebSocket. |
| `src/components/layout/customer-chat-layout.tsx` | modified | Evitado `return` prematuro para o chat selecionado em `handleRealtimeChatUpdate` e adicionado agendamento debounced de `runDeltaSync` quando o status ou visibilidade de um chat é alterado. |
| `src/components/layout/mobile-chat-layout.tsx` | modified | Aplicada a mesma correção de sincronização debounced e manutenção de estado do chat selecionado para a versão mobile. |
| `src/app/api/agent/chats/close/route.ts` | modified | Incluída chamada a `broadcastHydratedChatUpdate` logo após o `COMMIT` da transação de encerramento do chat. |
| `src/lib/types.ts` | modified | Adicionados campos `closed_at` e `closedAt` na interface `Chat` para tipagem estrita do TypeScript. |
| `tests/realtime-broadcast-fallback.spec.ts` | modified | Adicionados testes unitários validando a identificação de tópicos privados e a passagem de `{ config: { private: true } }` para canais de workspace e room. |
| `tests/chat-realtime-status-update.spec.ts` | added | Adicionados testes unitários validando a preservação do status de chats selecionados e o comportamento dos filtros de posse ('mine' vs 'everyone'). |

## Diff Highlights

### Broadcast com suporte a canais privados (`src/lib/realtime/broadcast.ts`)
```typescript
export function isPrivateBroadcastTopic(
  topic: string,
  options?: RealtimeBroadcastOptions,
): boolean {
  if (typeof options?.isPrivate === 'boolean') {
    return options.isPrivate;
  }
  return (
    topic.startsWith('workspace:') ||
    topic.startsWith('room:') ||
    topic.startsWith('private:')
  );
}

function getBroadcastChannelOptions(topic: string, options?: RealtimeBroadcastOptions) {
  return isPrivateBroadcastTopic(topic, options) ? { config: { private: true } } : undefined;
}
```

### Atualização do Chat Ativo e Debounce de Delta Sync (`customer-chat-layout.tsx`)
```typescript
    const statusChanged = Boolean(existingChat?.status && incomingStatus !== existingChat.status);
    if (statusChanged) {
      scheduleDebouncedDeltaSync();
    }

    if (!shouldKeepVisible) {
      if (existingChat && snapshot.selectedChatId !== newChatData.id) {
        removeChat(newChatData.id);
        scheduleDebouncedDeltaSync();
      }
      if (snapshot.selectedChatId !== newChatData.id) {
        return;
      }
      // Se for o chat selecionado, não remove imediatamente da tela nem aborta:
      // permite que optimisticUpdate atualize o status para 'encerrados' no store.
    }
```

### Broadcast pós-encerramento via API (`src/app/api/agent/chats/close/route.ts`)
```typescript
            await client.query('COMMIT');

            try {
                await broadcastHydratedChatUpdate(workspace_id, chatId);
            } catch (broadcastError) {
                console.error('[AGENT_CLOSE_CHAT] Failed to broadcast hydrated chat update:', broadcastError);
            }
```

## Tests Added or Updated

- `tests/realtime-broadcast-fallback.spec.ts`
  - `identifies private broadcast topics correctly` — Garante que `workspace:*` e `room:*` sejam marcados como privados.
  - `configures channel with private: true for workspace topic in REST path` — Valida chamada ao Supabase com `{ config: { private: true } }`.
  - `configures channel with private: true in WebSocket fallback for private topics` — Valida conexão websocket privada no fallback.
  - `respects explicit isPrivate option override` — Valida override manual da opção `isPrivate`.
- `tests/chat-realtime-status-update.spec.ts`
  - `updates selected chat status in store even when ownership filter would hide it` — Valida que o chat ativo tem seu status alterado para 'encerrados' mesmo sob filtro 'mine'.
  - `removes unselected chat from store when ownership visibility is lost` — Valida que chats não selecionados continuam sendo removidos da lista quando perdem visibilidade.
  - `evaluates visibility correctly across tab transitions in mine and everyone modes` — Valida a matriz de visibilidade por status e agente atribuído.

## Local Verification

- Comandos executados:
  - `npx vitest run tests/realtime-broadcast-fallback.spec.ts tests/chat-realtime-status-update.spec.ts` → 14 passed (14 tests)
  - `npx vitest run tests/realtime* tests/inbox* tests/mobile-inbox*` → 14 files passed, 78 tests passed
  - `npm run typecheck` (`next typegen && tsc --noEmit`) → Código 0, zero erros de tipo

## Deviations from Assessment

Nenhuma. Todas as alterações seguiram estritamente o plano de remediação preferencial definido no assessment.

## Follow-ups

- Executar `/speckit-bug-test slug=hidratacao-esta-bugada` para validação e verificação final.
