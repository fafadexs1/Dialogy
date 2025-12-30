# Roteiro: Permissão "instagram_basic"

> **Contexto:** A Meta rejeitou o vídeo anterior porque ele não mostrava o "fluxo completo". Para `instagram_basic`, eles querem ver:
> 1. O clique no botão "Login with Facebook".
> 2. O popup de permissões aparecendo (e sendo aceito).
> 3. O aplicativo exibindo os dados básicos (Nome, Foto, Username) obtidos com essa permissão.

---

## 1. O que configurar antes
*   Certifique-se de que sua conta de teste tenha uma **Página do Facebook** conectada a uma **Conta Instagram Business**.
*   Deslogue do Facebook no navegador (ou use uma janela anônima se possível, mas gravando a tela inteira) para garantir que o popup peça credenciais ou confirmação. **O ideal é que o popup apareça.**

---

## 2. Passo a Passo da Gravação

### Cena 1: Início da Integração
1.  Comece na tela de **Integrações** do Dialogy.
2.  Clique no card **Instagram Business**.
3.  *Narração:* "We are integrating an Instagram Business account to our platform."

### Cena 2: O Fluxo de Login (CRÍTICO)
4.  Clique no botão **"Buscar Páginas via Facebook"** (ou "Continuar com Facebook").
5.  **IMPORTANTE:** A gravação DEVE mostrar o popup do Facebook abrindo.
6.  No popup, clique em "Continuar como [Seu Nome]" ou faça o login.
7.  Se aparecer a tela de escolher contas do Instagram, selecione todas e avance.
8.  Se aparecer a tela de escolher Páginas, selecione todas e avance.
9.  Confirme as permissões e feche o popup.
10. *Narração:* "The user grants the 'instagram_basic' permission via Facebook Login."

### Cena 3: Exibição dos Dados Básicos (O Caso de Uso)
11. De volta ao Dialogy, a lista de contas deve carregar.
12. **PAUSE O MOUSE** sobre uma das contas listadas.
13. *Visual:* Mostre que o card exibe:
    *   Foto de Perfil do Instagram
    *   Username (@exemplo)
    *   Nome da Conta
14. *Narração:* "Using the 'instagram_basic' permission, we fetch and display the Instagram Business Account's name, username, and profile picture so the user can identify and select the correct account to connect."

### Cena 4: Seleção e Conclusão
15. Selecione a conta.
16. Clique em "Próximo" ou "Concluir".
17. *Narração:* "Once selected, the account is linked to the workspace."

---

## 3. Checklist de Envio
*   **Vídeo:** Anexe o novo screencast.
*   **Descrição:** "Permissões de `instagram_basic` são usadas para autenticar o usuário e exibir suas contas do Instagram Business (nome, foto, username) para seleção durante o processo de setup da integração."
