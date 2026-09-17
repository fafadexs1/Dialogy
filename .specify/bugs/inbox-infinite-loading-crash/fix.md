# Bug Fix: Eliminação de Carregamento Infinito do Inbox, Crashes por Propriedade de Contato e Falsos Recarregamentos de Página

- **Slug**: inbox-infinite-loading-crash
- **Fixed**: 2026-09-16
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Eliminada a ocorrência do erro de execução `TypeError: Cannot read properties of undefined (reading 'phone')` no Inbox por meio de blindagem defensiva em todos os pontos de acesso ao objeto de contato, garantia de retorno de contato de fallback em `src/actions/chats.ts`, enriquecimento reativo em `useInboxStore`, recuperação automática de erros com `resetKeys` no `ErrorBoundary`, e eliminação do loop de falso descompasso de versão no `BuildVersionWatcher`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/components/chat/chat-panel.tsx` | modified | Blindagem com optional chaining (`chat?.contact?.phone || chat?.contact?.phone_number_jid || ''`), avatar, exportação HTML e cabeçalho de atendimento |
| `src/components/chat/chat-list.tsx` | modified | Fallback inteligente dinâmico em vez de "Carregando...", proteção no useMemo de busca por telefone/nome, e toasts de atribuição |
| `src/components/chat/contact-panel.tsx` | modified | Proteção em `derivePhone()` contra `chat.contact` nulo ou indefinido |
| `src/components/chat/forward-message-dialog.tsx` | modified | Proteção contra `chat.contact` indefinido na listagem e pesquisa de encaminhamento |
| `src/components/chat/search-details-dialog.tsx` | modified | Proteção contra `chat.contact` indefinido no diálogo de busca e detalhes |
| `src/actions/chats.ts` | modified | Projeção `cont.phone AS contact_phone` e garantia de que `buildContactFromRow` sempre retorna um contato válido com ID e fallback contextual |
| `src/hooks/use-inbox-store.ts` | modified | `updateChatContact` agora suporta matching por `contact_id` mesmo se `chat.contact` estiver indefinido |
| `src/components/layout/error-boundary.tsx` | modified | Suporte à propriedade `resetKeys` em `componentDidUpdate` para redefinir o estado de erro e remontar componentes filhos |
| `src/components/layout/customer-chat-layout.tsx` | modified | Adicionados `resetKeys` para `ChatList` e `ChatPanel` no `ErrorBoundary` |
| `src/components/layout/mobile-chat-layout.tsx` | modified | Adicionados `resetKeys` para `MobileChatList` e `MobileChatView` no `ErrorBoundary` |
| `src/components/layout/build-version-watcher.tsx` | modified | Fixação de baseline de build ID na primeira checagem da sessão sem disparar falso mismatch contra 'dev' |
| `tests/inbox-infinite-loading-crash.spec.ts` | added | Testes automatizados cobrindo proteção de propriedades nulas, merge de store e resetKeys do ErrorBoundary |

## Diff Highlights

```tsx
// src/components/chat/chat-panel.tsx:1320
- const phone = chat?.contact.phone || chat?.contact.phone_number_jid;
+ const phone = chat?.contact?.phone || chat?.contact?.phone_number_jid || '';

// src/components/chat/chat-list.tsx:1013
- <span className="truncate">{chat.contact?.name || 'Carregando...'}</span>
+ <span className="truncate">{chat.contact?.name || chat.contact?.phone_number_jid?.replace(/@.+$/, '') || chat.contact?.phone || chat.protocol || 'Conversa'}</span>

// src/components/layout/error-boundary.tsx
+ public componentDidUpdate(prevProps: Props) {
+   if (this.state.hasError && this.props.resetKeys) {
+     const prevKeys = prevProps.resetKeys || [];
+     const currentKeys = this.props.resetKeys;
+     const hasChanged = prevKeys.length !== currentKeys.length || currentKeys.some((key, i) => !Object.is(key, prevKeys[i]));
+     if (hasChanged) {
+       this.setState({ hasError: false, error: null });
+     }
+   }
+ }
```

## Tests Added or Updated

- `tests/inbox-infinite-loading-crash.spec.ts::does not throw TypeError when contact is undefined on chat object` — Assegura que chats com `contact: undefined` não causam exceções de tempo de execução.
- `tests/inbox-infinite-loading-crash.spec.ts::updateChatContact in useInboxStore matches by contact_id even if contact is undefined` — Assegura que a hidratação via store atualiza chats orfãos ou parciais.
- `tests/inbox-infinite-loading-crash.spec.ts::ErrorBoundary resetKeys logic clears error when keys change` — Valida que mudanças de dependências redefinem o estado do ErrorBoundary, impedindo travamento no skeleton.

## Local Verification

- Commands run:
  - `npx tsc --noEmit` → Sucesso (0 erros de tipagem em toda a aplicação).
  - `npx vitest run tests/inbox-infinite-loading-crash.spec.ts` → 3 testes passaram (5ms).
  - `npx vitest run tests/inbox-infinite-loading-crash.spec.ts tests/mobile-chat-list.spec.ts tests/mobile-chat-view.spec.ts tests/mobile-contact-sheet.spec.ts tests/chat-realtime-status-update.spec.ts tests/mobile-message-input.spec.ts tests/mobile-view-state.spec.ts` → 7 arquivos, 23 testes passaram com 100% de sucesso.
- Manual checks:
  - Verificação da integridade de fallback em `buildContactFromRow` para garantir que queries de chats nunca entreguem objetos vazios ou nulos na chave `contact`.
  - Verificação da lógica de baseline no `BuildVersionWatcher` impedindo que `__NEXT_DATA__ === undefined` cause recarregamentos a cada 30 segundos.

## Deviations from Assessment

Nenhuma. Todos os itens de remediação recomendados na avaliação foram aplicados integralmente.

## Follow-ups

- Monitorar os logs de observabilidade do cliente (`reportClientError`) em produção para confirmar a extinção completa de eventos `[INBOX_UI_ERROR]`.
- Garantir que migrações futuras de dados no banco preencham `phone` e `name` em quaisquer contatos legados sem identificadores.
