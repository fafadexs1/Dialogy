# Roteiro: Permissão "business_management"

> **Atenção:** A Meta rejeita `business_management` se achar que `pages_show_list` já basta.
> **O SEGREDO:** Você deve explicar que o app é um **CRM Empresarial/Multi-Tenancy**. Não queremos apenas "listar páginas", queremos **verificar a Propriedade Empresarial (Business Ownership)** da página para garantir que ela pertença à organização correta dentro do nosso sistema.

---

## 1. O Conceito (Justificativa Forte)
A `business_management` é necessária para ler o contexto do **Gerenciador de Negócios (Business Manager)**.
*   **Por que precisamos?** Para verificar se a Página conectada pertence a um Business Manager verificado e permitir que o usuário gerencie as configurações de integração (webhooks) nesse nível empresarial.
*   **Argumento:** "We are a Business CRM. We need `business_management` to identify the Business Manager owner of the Page (`/me/businesses` or `page?fields=business`). This ensures we link the Facebook Page to the correct Corporate Workspace in our app, preventing employees from linking personal-ownership pages to corporate accounts."

---

## 2. Passo a Passo da Gravação

### Cena 1: Login com Escopo Empresarial
1.  Comece no Dialogy (Tela de Integrações).
2.  Clique em "Continuar com Facebook".
3.  **CRUCIAL:** Na janela do Facebook, clique em "Editar Acesso/Configurações" se necessário para mostrar a lista de permissões.
4.  **Destaque visualmente** a permissão **"Access and manage your business"** (ou similar) sendo marcada.
5.  *Narração:* "The user grants `business_management` permission during the OAuth flow."

### Cena 2: Conexão e Verificação (The "Why")
6.  Após o login, a lista de páginas aparece.
7.  Selecione uma página que você sabe que está dentro de um BM (Business Manager).
8.  Clique em Conectar.
9.  **Enquanto carrega/conecta:**
10. *Narração:* "At this stage, our system queries the Graph API to verify the Business Manager ownership of this Page. We use `business_management` to ensure this Page belongs to the user's corporate Business Manager, ensuring strict data governance for our Agency clients."
11. *Narração:* "Without this permission, we cannot verify the Business entity, which is a compliance requirement for our Enterprise users."

### Cena 3: O Resultado (Settings Management)
12. Mostre a página conectada e funcionando.
13. *Narração:* "Once validated via `business_management`, the Page is successfully linked to the Corporate Workspace, allowing the team to manage assets securely."

---

## 3. Checklist de Envio
*   **Vídeo:** Screencast seguindo os passos acima.
*   **Descrição (Copie e Cole/Adapte):**
    "Our application is a CRM for Agencies and Enterprises using Business Manager. We require `business_management` to query the `business` field on the Page object and the user's `/businesses` edge. This is critical to:
    1. Verify that the connected Page belongs to a legitimate Business Manager (not a personal asset).
    2. Map the Page to the correct Corporate Workspace in our multi-tenancy architecture.
    3. `pages_show_list` is insufficient because it does not reveal the Business Manager ownership structure required for our corporate compliance and asset governance."
