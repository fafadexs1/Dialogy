# Phase 1: Quickstart Validation Guide

**Feature**: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar
**Date**: 2026-09-14
**Spec**: [spec.md](./spec.md)

---

## 1. Pré-requisitos

1. Servidor ACS e MCP rodando:
   - ACS backend em `http://localhost:8000`
   - MCP do ACS em `http://localhost:8090` (ou iniciado via `custom-acs/iniciar.bat`)
2. Dialogy rodando ou acessível via testes automatizados.

---

## 2. Cenários de Validação Práticos

### Cenário 1: Teste de Conexão e Sincronização de Ferramentas MCP
**Objetivo**: Validar que o Dialogy conecta ao ACS `router-mcp` sem travar e sincroniza as 9 ferramentas em < 2s.

```bash
# Executar script de validação de conexão MCP
npx vitest run tests/unit/services/mcp/acs-router-transport.test.ts
```

**Resultado Esperado**:
- Status: `healthy`
- 9 ferramentas retornadas: `list_routers`, `get_router_details`, `get_wifi_diagnostics`, `configure_wifi`, `list_connected_clients`, `scan_wifi_spectrum`, `reboot_router`, `get_operation_status`, `get_tool_manual`.
- Latência medida < 2000ms.

---

### Cenário 2: Consulta a `/como-usar` e Leitura de Manuais
**Objetivo**: Comprovar que a IA ou o operador consegue puxar o manual completo em Markdown de `/como-usar`.

```bash
# Teste de recuperação de manual técnico oficial
npx vitest run tests/unit/services/mcp/acs-manuals.test.ts
```

**Resultado Esperado**:
- Chamada para `get_tool_manual` com `{ tool_name: "configure_wifi" }` retorna o conteúdo Markdown oficial detalhando regras atômicas, bandas permitidas e requisitos de senha.
- Chamada sem argumentos retorna o índice do catálogo com todas as ferramentas e categorias.

---

### Cenário 3: Injeção de Regras Estritas no Prompt da IA
**Objetivo**: Verificar que quando uma ferramenta do ACS está habilitada no agente, o prompt do sistema impõe a consulta a `/como-usar` e proíbe reboots não-confirmados ou senhas fracas.

```bash
# Teste de montagem de prompt do Autopilot / Workflow Runtime
npx vitest run tests/unit/services/autopilot/acs-router-prompt.test.ts
```

**Resultado Esperado**:
- O prompt montado contém explicitamente a instrução:
  `"Consulte obrigatoriamente as instruções de /como-usar chamando get_tool_manual antes de executar qualquer diagnóstico ou alteração em roteadores."`
- O prompt proíbe expor credenciais em texto claro (Zero Plaintext Secrets).

---

### Cenário 4: Tratamento de Erro Acionável (`remedial_suggestion`)
**Objetivo**: Garantir que se a IA enviar argumentos inválidos (ex.: senha curta para `configure_wifi`), o servidor retorne a sugestão corretiva e ela seja entregue à IA.

**Resultado Esperado**:
- A resposta contém `isError: true` e a mensagem corretiva:
  `"A senha Wi-Fi deve ter no mínimo 8 caracteres. Oriente o cliente a escolher uma senha com pelo menos 8 dígitos."`
