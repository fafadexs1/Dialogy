# Roteiro: Permissão "Human Agent" (Agente Humano)

> **Contexto:** A Meta rejeitou o pedido porque quer entender **por que** você precisa responder após 24h. A permissão "Human Agent" estende a janela de resposta para 7 dias. Você deve provar que seu app é uma **ferramenta para agentes humanos** (CRM/Helpdesk) e que existem casos onde a resposta não é imediata.

---

## 1. O Conceito (O que falar/explicar)
Durante o vídeo, ou na descrição do envio, você deve enfatizar:
*   "Our application is a CRM/Customer Service platform used by human support teams."
*   "Ideally, we respond quickly, but some inquiries require internal investigation (e.g., checking stock, verifying shipping with 3rd parties) which can take longer than 24 hours."
*   "We need the Human Agent permission to allow our support team to get back to the customer once the issue is resolved, ensuring a good user experience."

---

## 2. Passo a Passo da Gravação

### Cena 1: O Painel de Atendimento (The Inbox)
1.  Mostre a tela de **Inbox** do Dialogy com várias conversas.
2.  *Ação:* Navegue entre conversas.
3.  *Narração:* "This is the Agent Inbox where our support team manages customer conversations."

### Cena 2: O Cenário de Atraso (The Use Case)
4.  Selecione uma conversa (idealmente uma que tenha uma mensagem de usuário simulada como "Onde está meu pedido?" ou "Tenho um problema complexo").
5.  *Ação:* O agente (você) clica na conversa.
6.  *Simulação:* Digite uma nota interna ou apenas narre: "Here, the customer asked about a complex issue. The agent needs to verify with the logistics department."
7.  *Narração:* "Since this investigation might take more than 24 hours, the standard messaging window would close."

### Cena 3: A Resposta do Agente (The Human Response)
8.  *Visual:* Mostre claramente a **Interface de Digitação** (Input de texto).
9.  *Ação:* Digite uma resposta manual. Ex: "Olá, verificamos seu caso com a logística e..."
10. *Narração:* "Upon resolving the issue, the Human Agent returns to the app to reply to the user using the Human Agent tag features."
11. Clique em **Enviar**.
12. Mostre a mensagem aparecendo no chat com o status de enviada.

### Cena 4: Configuração (Opcional mas bom)
13. Se houver alguma configuração de "Atribuir a Agente" (Assign to Agent), mostre isso. Isso prova que existe um humano responsável.

---

## 3. Checklist de Envio
Ao enviar novamente para análise:
*   **Vídeo:** Anexe o screencast feito com este roteiro.
*   **Descrição:** Cole o texto em inglês explicando o caso de uso (item 1).
*   **Código:** Mencione que o backend, ao detectar uma resposta manual de um agente, envia a tag `HUMAN_AGENT` via API (nós acabamos de adicionar esse suporte no código).
