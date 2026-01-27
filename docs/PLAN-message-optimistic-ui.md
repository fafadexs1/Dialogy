# Implementação de Optimistic UI no Chat

Este plano descreve a implementação da interface otimista (Optimistic UI) para o envio de mensagens. O objetivo é remover o "delay" perceptível (relógio) e mostrar a mensagem imediatamente ao usuário, atualizando os status de confirmação conforme o progresso (Banco de Dados -> API -> Leitura).

## User Review Required

> [!IMPORTANT]
> **Definição de Estados Visuais**
> Para atender ao pedido "tirar o relógio", a mensagem aparecerá instantaneamente. Os ícones de status seguirão este fluxo:
> 1.  **Imediato (Local)**: A mensagem aparece no chat. **Sem ícone** de status (limpo).
> 2.  **Salvo no Banco (Server)**: Ícone altera para **1 Check (Cinza)**.
> 3.  **Enviado para API (WhatsApp/Meta)**: Ícone altera para **2 Checks (Cinza)**.
> 4.  **Lido**: Ícone altera para **2 Checks (Azul)** (já existente).
>
> **Falhas**: Se o envio falhar, aparecerá um ícone de **Erro (Vermelho)** com opção de reenviar.

## Proposed Changes

### Frontend - Chat Logic

#### [MODIFY] [message-input.tsx](src/components/chat/message-input.tsx)
-   Modificar a função de submit:
    -   Gerar um UUID v4 no frontend.
    -   Criar objeto `optimisticMessage` com os dados atuais.
    -   Adicionar imediatamente à lista de mensagens (via store ou state local).
    -   Chamar a Server Action `sendAgentMessageAction` passando o UUID gerado.

#### [MODIFY] [chat-store.ts](src/lib/store/chat-store.ts) (ou equivalente)
-   Adicionar suporte para mensagens otimistas na store (se necessário misturar com as do backend).
-   Garantir que quando o evento `REALTIME INSERT` chegar (via Supabase), ele não duplique a mensagem (fazer *merge* pelo UUID).

#### [MODIFY] [message-item.tsx](src/components/chat/message-item.tsx)
-   Atualizar a lógica de exibição dos ticks (checks):
    -   Se `status === 'sending'` (local): Mostrar nada ou ícone de "aguardando" discreto (se preferir).
    -   Se `status === 'sent'` (banco): 1 Check.
    -   Se `status === 'delivered'` (api): 2 Checks.
    -   Se `status === 'read'`: 2 Checks Azuis.
    -   Se `status === 'error'`: Ícone de erro.

### Backend - Verification

#### [NO CHANGE REQUIRED] [messages.ts](src/actions/messages.ts)
-   A função `sendAgentMessageAction` já aceita `messageId` opcional.
-   A função `internalSendMessage` já usa o ID fornecido se existir.
-   O fluxo de `PENDING` (Banco) -> `SENT` (API) já existe e dispara eventos via Realtime.

## Verification Plan

### Automated Tests
-   Não aplicável para interações visuais complexas de UI/Realtime neste escopo.

### Manual Verification
1.  **Envio Normal**:
    -   Abrir Chat.
    -   Enviar "Teste 1".
    -   Verificar: Mensagem aparece **imediatamente** (sem delay de rede).
    -   Verificar: Após ~50-200ms, aparece **1 Check** (Salvo no DB).
    -   Verificar: Após ~1-2s (tempo da Evolution API), aparece **2 Checks** (Enviado).
2.  **Duplicidade**:
    -   Verificar se a mensagem não pisca ou duplica quando o Realtime confirma a inserção.
3.  **Erro (Simulado)**:
    -   Forçar erro no backend (ou desconectar internet) e verificar se UI mostra erro.
