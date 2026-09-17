# Technical Research: Redefinição da Experiência Mobile como Chat Nativo

**Feature**: `001-redefinir-modo-mobile` | **Date**: 2026-09-14

## Executive Summary

Este documento consolida as decisões técnicas tomadas para viabilizar a implementação da **Opção B (Interface Mobile Dedicada e Limpa)** no Dialogy. O objetivo é transformar o modo móvel web em uma experiência autêntica de mensageria (estilo WhatsApp/Telegram), resolvendo definitivamente as instabilidades do teclado virtual, a poluição visual e o acoplamento excessivo com o componente desktop.

---

## Decision 1: Viewport e Ancoragem do Teclado Virtual em Dispositivos Móveis

### Contexto
Em navegadores móveis (Safari no iOS e Chrome no Android), a abertura do teclado virtual (soft keyboard) reduz a área visível (`window.visualViewport`). Se o container principal usar `100vh` ou altura fixa, o teclado sobrepõe o campo de entrada de texto e oculta o botão de envio.

### Decisão
Utilizar uma estratégia híbrida resiliente:
1. **Meta Viewport**: Definir `interactive-widget=resizes-content` na configuração de viewport do Next.js (suportado nativamente no Chrome Android).
2. **CSS Dinâmico (`100dvh`)**: Utilizar `h-[100dvh]` como altura padrão do app shell móvel, acompanhando a barra de navegação retrátil dos navegadores.
3. **Hook de Teclado `useVisualViewport`**: Escutar os eventos `resize` e `scroll` de `window.visualViewport` para atualizar uma variável CSS (`--keyboard-offset`) ou ajustar a altura do container quando o teclado for exibido no iOS Safari, garantindo ancoragem milimétrica do input de texto.

### Alternativas Consideradas
- *Usar apenas `100vh`*: Rejeitado porque no iOS Safari a barra de endereços e o teclado cobrem até 40% da parte inferior da tela.
- *Usar `position: fixed` puro no input*: Rejeitado porque no iOS o `position: fixed` sofre com pulos visuais e dessincronização de rolagem quando o teclado é ativado.

---

## Decision 2: Arquitetura de Componentes Mobile Dedicados

### Contexto
O layout móvel atual (`mobile-chat-layout.tsx`) importava diretamente os componentes desktop `ChatList.tsx` (2.893 linhas) e `ChatPanel.tsx` (2.850 linhas), tentando adaptá-los com regras de CSS `md:hidden` / `md:flex`. Isso tornava a renderização pesada, poluída e cheia de comportamentos feitos para mouse.

### Decisão
Criar uma suíte de componentes dedicada em `src/components/chat/mobile/`:
1. **`MobileChatList`**:
   - Cabeçalho minimalista com identificação do workspace e campo de pesquisa rápida;
   - Abas horizontais deslizantes por toque com contadores (*Robô*, *Fila*, *Atendendo*, *Encerrados*);
   - Cards de conversa leves (avatar, nome do cliente, badge de canal WhatsApp/Meta, prévia da última mensagem, timestamp e contador de não lidas);
   - Remoção total da barra inferior obsoleta de "CRM" e "Ajustes".
2. **`MobileChatView`**:
   - Modo 100% tela cheia ao selecionar uma conversa;
   - Cabeçalho compacto: botão de retorno (`ArrowLeft`), foto do contato, nome truncado, status da conversa e gatilho de toque para abrir detalhes;
   - Área de histórico de mensagens otimizada para toque com balões limpos, suporte a áudio gravado/recebido, imagens e status de entrega;
   - Barra de digitação móvel simplificada: botão de anexo rápido (`+`), campo auto-expansível (máximo 4 linhas), botão de áudio/envio.
3. **`MobileContactSheet`**:
   - Reutilização e aprimoramento da gaveta inferior (`Sheet side="bottom"` baseada em `mobile-contact-panel.tsx`) para todas as ações secundárias: visualização de telefone, canal, protocolo, etiquetas, notas internas, diálogo de transferência e encerramento de chamado.

### Alternativas Consideradas
- *Continuar refatorando `ChatPanel.tsx` existente*: Rejeitado para evitar adicionar centenas de condicionais móveis em um arquivo já complexo de 2.800 linhas, protegendo o desktop contra regressões.

---

## Decision 3: Reutilização do Estado Global e Camada Realtime

### Contexto
O Dialogy já possui uma camada madura de sincronização de dados via `useInboxStore` (Zustand) e eventos Supabase Realtime (`workspace:*` e `room:*`).

### Decisão
Os novos componentes móveis (`MobileChatList` e `MobileChatView`) consumirão diretamente os seletores existentes do `useInboxStore`:
- `chats`, `selectedChatId`, `setSelectedChatId`;
- `currentChatMessages`, `appendMessagesToChat`, `upsertChats`, `removeChat`;
- Disparo de ações de envio via `guardedSendAgentMessage` e encerramento via `closeChatAction`.

Dessa forma, a redefinição mobile é **100% focada na camada de apresentação (UI/UX)**, garantindo integridade de dados e consistência em tempo real sem novas migrações de banco ou rotas de API.

---

## Decision 4: Ergonomia Tátil e Safe-Area Insets (PWA / Notches)

### Contexto
iPhones modernos possuem entalhes (*Notch* e *Dynamic Island*) no topo e barra de navegação gestual na base. Celulares Android possuem barras de navegação do sistema.

### Decisão
- Aplicar `pt-[env(safe-area-inset-top)]` no cabeçalho superior e `pb-[env(safe-area-inset-bottom)]` na barra inferior de digitação;
- Garantir alvos de toque mínimos de 44x44 pixels (padrão WCAG / Apple HIG) para botões de voltar, envio e anexos;
- Prevenir zoom involuntário em campos de formulário configurando `font-size: 16px` mínimo nos inputs de texto em dispositivos móveis.
