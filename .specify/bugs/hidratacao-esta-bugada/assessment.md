# Bug Assessment: Falha de Sincronização em Tempo Real ao Encerrar ou Transferir Chats

- **Slug**: hidratacao-esta-bugada
- **Created**: 2026-09-14
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> "To com um probleminha relacionado a hidratação. Quando transferimos ou encerramos um cliente para uns encerra normalmente, outros podem não receber o evento e ficar a pessoa em um estado que não é o certo. Exemplo, se eu encerrrar alguém do robô, as vezes fica no robô e quando dou F5 ele vai lá e atualiza."

## Symptom

Ao encerrar ou transferir uma conversa (especialmente chats sob controle do robô/fila), o operador que disparou a ação tem sua interface atualizada imediatamente via mutação local otimista e delta-sync síncrono. No entanto, outros operadores conectados simultaneamente em outros navegadores ou dispositivos frequentemente não recebem o evento de atualização em tempo real, mantendo o cliente exibido no estado anterior (por exemplo, preso na aba "Robô") até que ocorra um recarregamento manual da página (F5).

## Reproduction

1. Abrir a aplicação Dialogy em dois navegadores/sessões distintas (Usuário A e Usuário B) com acesso ao mesmo workspace.
2. Certificar-se de que há uma conversa ativa na aba "Robô" (`status: 'gerais'`, sem responsável humano ou tag de fila).
3. No Usuário A, executar o encerramento do chat (seja via botão de encerramento rápido no card da lista ou via diálogo de encerramento).
4. Observar a tela do Usuário A: a conversa é removida imediatamente da aba "Robô".
5. Observar a tela do Usuário B: o chat permanece visível na aba "Robô" e seu estado não atualiza para "Encerrado".
6. No Usuário B, pressionar `F5`: a página recarrega e o chat é exibido corretamente na aba "Encerrados" ou deixa a aba "Robô".

## Suspected Code Paths

- `src/lib/realtime/broadcast.ts:134-158` (`broadcastRealtimeEvent`) — O canal Supabase no servidor é instanciado sem `{ config: { private: true } }`. Quando dispara `httpSend` (REST) ou `broadcastOverWebsocket`, publica como canal público (`private=false`), enquanto os clientes frontend escutam em canal privado (`private=true`). No servidor Realtime do Supabase, assinantes de canais privados não recebem mensagens publicadas em canais públicos do mesmo tópico.
- `src/components/layout/customer-chat-layout.tsx:1492-1507` (`handleRealtimeChatUpdate`) e `src/components/layout/mobile-chat-layout.tsx:1365-1380` — Quando `isChatVisibleForOwnership` retorna falso (ex: filtro 'mine' para chat sem agente), se o chat for o atualmente selecionado (`snapshot.selectedChatId === newChatData.id`), a remoção é ignorada mas a função retorna antecipadamente (`return;`), impedindo a atualização de status no store Zustand para o operador que está visualizando o atendimento.
- `src/app/api/agent/chats/close/route.ts:140-180` — Rota de encerramento via API externa/agente comita a transação no PostgreSQL mas não invoca `broadcastHydratedChatUpdate(workspace_id, chatId)`, fazendo com que encerramentos automatizados nunca emitam evento para o frontend.
- `src/components/chat/chat-list.tsx:1706-1737` — Os contadores das abas (`tabCounts`) dependem de `inboxCounts` do store Zustand. Quando um chat muda de status via Realtime, `inboxCounts` não é ajustado incrementalmente até o próximo polling/delta-sync, criando discrepância visual entre a lista e o badge numérico da aba.

## Root Cause Hypothesis

A causa-raiz primária é uma divergência de configuração entre o publicador no servidor e os ouvintes no cliente Supabase Realtime (Confiança: **Alta**).
Os clientes frontend se conectam aos canais `workspace:${workspaceId}:chats` com a flag `private: true` (`privateChannelConfig` em `chat-subscriptions.ts`). Contudo, o módulo de broadcast do servidor (`broadcast.ts`) instancia o canal via `getSupabaseAdmin().channel(topic)` omitindo `private: true`. Dessa forma, o método `httpSend` do SDK Supabase dispara um POST sem o parâmetro `?private=true`, fazendo com que o servidor Realtime do Supabase trate a transmissão como pública e silenciosamente descarte o envio para os assinantes autenticados no canal privado. Somado a isso, o operador que executou a ação sempre vê a mudança ocorrer por causa da UI otimista local (`removeChat`) e do `runDeltaSync` imediato em sua máquina, mascarando a falha de entrega para os demais operadores até que estes realizem um `F5`.

## Proposed Remediation

**Preferred**:
1. **Corrigir o canal de broadcast no servidor (`src/lib/realtime/broadcast.ts`)**:
   Garantir que tanto a chamada REST (`httpSend`) quanto o fallback WebSocket (`broadcastOverWebsocket`) utilizem a configuração `{ config: { private: true } }` ao obter o canal do tópico do workspace, alinhando a privacidade da publicação com a assinatura dos clientes.
2. **Corrigir o tratamento do chat selecionado no listener Realtime (`customer-chat-layout.tsx` e `mobile-chat-layout.tsx`)**:
   Quando `shouldKeepVisible` for falso mas o chat for o atualmente selecionado (`snapshot.selectedChatId === newChatData.id`), atualizar os campos de status/encerramento no store em vez de abortar com `return;` silencioso, garantindo que o painel e os cabeçalhos reflitam o encerramento em tempo real.
3. **Incluir broadcast nas rotas faltantes (`src/app/api/agent/chats/close/route.ts`)**:
   Chamar `broadcastHydratedChatUpdate(workspace_id, chatId)` após o commit da transação de encerramento.
4. **Reconciliar contadores das abas (`inboxCounts`)**:
   Ao processar transição de status no `handleRealtimeChatUpdate`, atualizar as contagens de abas no `useInboxStore` ou disparar um delta-sync debounced quando uma conversa cruzar fronteiras de status ('gerais' ↔ 'atendimentos' ↔ 'encerrados').

**Alternatives**:
- Adicionar trigger nativo no PostgreSQL na tabela `chats` (semelhante ao existente em `messages` com `messages_broadcast_trigger`). *Trade-off*: Exige nova migração SQL de banco de dados e função PL/pgSQL que carregue dados enriquecidos (lateral joins de tags/equipe), aumentando a complexidade em relação ao ajuste direto no serviço TypeScript.

**Files likely to change**:
- `src/lib/realtime/broadcast.ts`
- `src/components/layout/customer-chat-layout.tsx`
- `src/components/layout/mobile-chat-layout.tsx`
- `src/app/api/agent/chats/close/route.ts`
- `tests/realtime-broadcast-fallback.spec.ts`

**Tests to add or update**:
- Teste unitário em `tests/realtime-broadcast-fallback.spec.ts` validando que `broadcastRealtimeEvent` passa `{ config: { private: true } }` para os canais de workspace e chat.
- Teste em `tests/` validando que o payload de `handleRealtimeChatUpdate` atualiza o status de chats selecionados mesmo quando o ownership filter estiver ativo.

## Risks & Considerations

- **Compatibilidade do Supabase Realtime**: Assegurar que o endpoint `httpSend` com `private: true` seja suportado pela versão em execução do Supabase Realtime (requer service_role ou token com permissão `broadcast` na tabela `realtime.messages`).
- **Performance de Re-renderização**: A atualização de contadores e remoção otimizada deve evitar recálculos desnecessários na lista virtualizada de chats.

## Open Questions

- Nenhum bloqueante identificado. A causa-raiz e o mecanismo de propagação foram isolados no código-fonte.
