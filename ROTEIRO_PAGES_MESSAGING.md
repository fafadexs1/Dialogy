# Roteiro: Permissão "pages_messaging"

> **Contexto:** Esta é a permissão principal para enviar e receber mensagens do Facebook Messenger. A Meta quer ver um teste **Fim-a-Fim (End-to-End)**: uma mensagem chegando na Página e o app respondendo.

> **Requisito Chave:** Mostrar a mensagem sendo digitada e enviada pela interface do seu App, e aparecendo imediatamente no Messenger do usuário final (Facebook pessoal).

---

## 1. Preparação (CRUCIAL)
Você vai precisar de **dois dispositivos** ou **duas janelas do navegador** visíveis na gravação:
1.  **Janela 1 (Seu App):** Logado no Dialogy (Visão do Agente).
2.  **Janela 2 (Facebook Pessoal):** Logado como um usuário comum que vai mandar mensagem para a Página.

---

## 2. Passo a Passo da Gravação

### Cena 1: O Cliente Inicia (Incoming Message)
1.  Na **Janela 2 (Facebook)**, abra a Página conectada.
2.  Clique em "Enviar Mensagem".
3.  Digite: "Olá, gostaria de saber sobre o produto."
4.  Envie.

### Cena 2: O Agente Recebe (App Perspective)
5.  Mude para a **Janela 1 (Dialogy)**.
6.  Mostre a mensagem chegando na Inbox em tempo real (ou dê refresh se necessário, mas idealmente realtime).
7.  Clique na conversa.
8.  *Narração:* "The app receives the user's message via webhook, enabled by the `pages_messaging` permission."

### Cena 3: O Agente Responde (Outgoing Message)
9.  Digite uma resposta na interface do Dialogy.
    *   Exemplo: "Olá! Posso te ajudar com isso."
10. Clique em **Enviar**.
11. Mostre a mensagem status "Enviada" no chat.
12. *Narração:* "The agent replies to the user. This functionality relies on `pages_messaging` to POST to the Graph API."

### Cena 4: Entrega Confirmada (Closing the Loop)
13. Mude rapidamente para a **Janela 2 (Facebook)**.
14. Mostre a resposta do agente aparecendo na janela de chat do usuário.
15. *Narração:* "The user receives the response instantly, completing the support cycle."

---

## 3. Checklist de Envio
*   **Vídeo:** Anexe o screencast Fim-a-Fim.
*   **Descrição:**
    "The `pages_messaging` permission is used to provide bidirectional customer support. This video demonstrates a user sending a message to the Page, the App receiving it via webhooks, and the Agent replying via the API, delivering a seamless support experience."
