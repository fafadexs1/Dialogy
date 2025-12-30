# Roteiro: Permissão "pages_manage_metadata"

> **Contexto:** A Meta rejeitou dizendo que o caso de uso é "inválido/desnecessário".
> **Nossa Justificativa:** O App precisa dessa permissão para inscrever automativamente a Página nos Webhooks (`subscribed_apps`) via API assim que o usuário conecta a página. Sem isso, não recebemos as mensagens em tempo real.

---

## 1. O Conceito (O que falar/explicar)
Durante o vídeo, ou na descrição do envio, você deve enfatizar:
*   "We use `pages_manage_metadata` to automatically subscribe the connected Page to our App's Webhooks using the `/subscribed_apps` edge."
*   "This ensures that our CRM receives messages, delivery updates, and read receipts in real-time without requiring manual configuration by the user in the App Settings."
*   "This improves the user experience by making the setup 'plug-and-play'."

---

## 2. Passo a Passo da Gravação

### Cena 1: Conexão da Página (Setup Flow)
1.  Comece na tela de **Integrações > Messenger**.
2.  Clique em "Continuar com Facebook".
3.  Faça o fluxo de login e selecione uma Página.
4.  Clique em "Conectar" (ou salvar).

### Cena 2: A "Mágica" (Explicação Técnica)
5.  Assim que o loading terminar e a página aparecer como "Conectada":
6.  *Narração:* "At this moment (`createMetaChannel`), our backend uses the Page Access Token to call the Graph API `{page_id}/subscribed_apps` endpoint."
7.  *Narração:* "This programmatically subscribes our app to receive `messages`, `messaging_postbacks`, and `message_reads` for this specific page."

### Cena 3: Prova de Funcionamento (Mensagem)
8.  Envie uma mensagem de um Facebook pessoal para a Página conectada.
9.  Mostre a mensagem chegando no Dialogy.
10. *Narração:* "Because we successfully subscribed to the webhooks using `pages_manage_metadata`, the message arrives instantly in our inbox."

---

## 3. Checklist de Envio
*   **Vídeo:** Anexe o screencast.
*   **Descrição (IMPORTANTE):**
    "We use `pages_manage_metadata` to programmatically subscribe the User's Page to our App Webhooks (via the `/{page-id}/subscribed_apps` edge) immediately after they connect their Page. This automates the setup process, ensuring the app receives `messages`, `messaging_postbacks`, and `read_receipts` without manual configuration. This is essential for our CRM functionality."
