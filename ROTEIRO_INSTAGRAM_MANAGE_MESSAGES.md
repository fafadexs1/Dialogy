# Roteiro: Permissão "instagram_manage_messages"

> **Contexto:** A Meta rejeitou o vídeo anterior porque "não mostrou uma mensagem sendo enviada do app e aparecendo no cliente nativo". Eles exigem um teste **Fim-a-Fim (End-to-End)** visível.

> **O que o Analista pediu:** "...re-record showing: (1) asset selection (Page, account, or number visible), (2) a live send action from your app, and (3) the delivered message in the native client."

---

## 1. Preparação (CRUCIAL)
Você vai precisar de **dois dispositivos** ou **duas janelas do navegador** visíveis na gravação (ou alternar rapidamente entre elas):
1.  **Janela 1 (Seu App):** Onde você está logado como Agente no Dialogy.
2.  **Janela 2 (Cliente Nativo/Celular):** Onde você está logado na **Conta de Teste do Instagram** (o usuário final que vai receber a mensagem). *Pode ser o Instagram Web (Direct Messages) ou a tela do celular espelhada.*

---

## 2. Passo a Passo da Gravação

### Cena 1: Login e Seleção da Página (Asset Selection)
1.  Comece na tela de login/integração.
2.  Mostre (rapidamente) que a conta do Instagram Business está conectada.
3.  Vá para o **Inbox (Chat)**.
4.  Selecione a conversa com o usuário de teste do Instagram.
5.  *Narração:* "Here we select the Instagram Business account and the conversation with the user."

### Cena 2: Envio da Mensagem (Live Send Action)
6.  Na interface de chat do Dialogy, digite uma mensagem única.
    *   *Exemplo:* "Hello from Dialogy App Review Test [Data/Hora]"
7.  Clique em **Enviar**.
8.  *Visual:* Mostre a mensagem aparecendo no histórico do chat como "Enviada".
9.  *Narração:* "The agent sends a support message using the 'instagram_manage_messages' permission."

### Cena 3: Recebimento no Cliente Nativo (Delivered Message)
10. **IMEDIATAMENTE** mude para a Janela 2 (Instagram Web ou Celular).
11. Mostre a mensagem chegando na DM do usuário de teste.
12. **Abra a mensagem** para mostrar o conteúdo exato que você digitou.
13. *Narração:* "Here we can see the message delivered instantly to the user's native Instagram app."

### Cena 4: Resposta do Usuário (Opcional, mas bom)
14. Digite uma resposta no Instagram Nativo ("Thanks for the help").
15. Volte para o Dialogy.
16. Mostre a resposta chegando.
17. *Narração:* "And the user's reply is received back in our platform."

---

## 3. Checklist de Envio
*   **Vídeo:** Anexe o novo screencast.
*   **Descrição:** "Este vídeo demonstra o fluxo completo de mensagens bidirecionais possibilitado pela permissão `instagram_manage_messages`, incluindo o envio pelo app e a entrega no cliente nativo do Instagram."
