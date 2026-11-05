# Quickstart & Verification Guide: Redefinição da Experiência Mobile como Chat Nativo

**Feature**: `001-redefinir-modo-mobile` | **Date**: 2026-09-14

## Overview

Este guia detalha como validar e testar a nova experiência móvel do Dialogy em cenários automatizados e emulados no navegador.

---

## 1. Pré-requisitos e Execução do Servidor

```bash
# Iniciar o servidor de desenvolvimento
npm run dev
```

Abra o navegador em `http://localhost:3000/inbox` e ative o modo de emulação de dispositivos móveis do DevTools (F12 → `Ctrl+Shift+M` ou `Cmd+Shift+M`):
- Selecione um dispositivo padrão: **iPhone 14 Pro** (393 x 852) ou **Pixel 7** (412 x 915);
- Certifique-se de que a viewport esteja com largura menor que `768px` para acionar o `MobileChatLayout`.

---

## 2. Cenários de Validação Manual

### Cenário 1: Lista de Conversas Móvel
- **Ação**: Visualizar a tela inicial de `/inbox` em modo móvel.
- **Resultado Esperado**:
  - A barra inferior com abas "CRM" e "Ajustes" com selo "Em breve" NÃO é exibida.
  - A lista ocupa a altura completa da tela até a barra do navegador.
  - As abas horizontais no topo (*Robô*, *Fila*, *Atendendo*, *Encerrados*) alternam instantaneamente a listagem ao toque.

### Cenário 2: Conversa em Tela Cheia e Navegação
- **Ação**: Tocar em um card de cliente da lista.
- **Resultado Esperado**:
  - A tela transiciona para a conversa em tela cheia (100% da viewport).
  - O cabeçalho exibe botão de voltar (`←`), avatar, nome do cliente e status da conversa.
  - Ao clicar na seta `←`, a interface retorna instantaneamente para a lista de conversas.

### Cenário 3: Ancoragem e Estabilidade do Teclado Virtual
- **Ação**: Tocar no campo de digitação na conversa aberta.
- **Resultado Esperado**:
  - O campo de texto permanece ancorado imediatamente acima do teclado virtual sem ser encoberto.
  - A lista de mensagens rola para manter a última mensagem visível.
  - A digitação de texto com quebras de linha expande a caixa até 4 linhas sem quebrar o layout.

### Cenário 4: Gaveta Inferior de Contexto (Bottom Sheet)
- **Ação**: Tocar no nome ou foto do cliente no cabeçalho do chat.
- **Resultado Esperado**:
  - Uma gaveta inferior deslizante se abre suavemente exibindo telefone, tags e notas.
  - Os botões "Transferir Conversa" e "Encerrar Atendimento" estão acessíveis e operacionais.

---

## 3. Validação Automatizada (Testes de Regressão e Tipagem)

Execute as suítes de teste automatizadas que validam o comportamento e a integridade de tipos:

```bash
# Executar testes unitários do subsistema móvel e realtime
npx vitest run tests/mobile-inbox-reconciliation.spec.ts tests/chat-realtime-status-update.spec.ts tests/realtime-broadcast-fallback.spec.ts

# Executar checagem estrita de tipos TypeScript
npm run typecheck
```
