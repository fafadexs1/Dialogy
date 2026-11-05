# Tasks: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar

**Input**: Design artifacts from `/specs/002-mcp-acs-integration/`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Data Model**: [data-model.md](./data-model.md)

---

## Phase 1: Setup & Data Model Extension

**Purpose**: Estender tipagens e modelos de dados para suportar transporte HTTP direto e metadados de manuais `/como-usar`.

- [x] T001 Estender `McpServerTransport` em `src/services/mcp/types.ts` adicionando `'direct_http'` e metadados de manuais (`ManualCatalogResponse`, `ToolManualInfo`).
- [x] T002 [P] Atualizar `src/services/mcp/store.ts` para persistir e recuperar o novo transporte e metadados de manuais no `workspace_integrations`.

---

## Phase 2: Foundational & User Story 1 - Transporte Resiliente e Descoberta das 9 Ferramentas (P1) 🎯 MVP

**Goal**: Permitir que a Dialogy conecte imediatamente ao servidor MCP do ACS na porta 8090 sem travar em streams SSE, sincronizando as 9 ferramentas ricas com schemas estritos.

**Independent Test**: Executar `testMcpServerConnectionAction` ou teste automatizado contra `http://localhost:8090/mcp` e obter as 9 ferramentas em < 2 segundos.

- [x] T003 Implementar cliente HTTP JSON-RPC 2.0 direto com fallback em `src/services/mcp/client.ts` para suportar POST direto de `initialize`, `tools/list` e `tools/call`.
- [x] T004 Atualizar `listMcpServerTools` em `src/services/mcp/client.ts` para usar o transporte direto resiliente para endpoints HTTP, extraindo schemas completos, títulos, descrições e anotações de segurança.
- [x] T005 Atualizar `callMcpServerTool` em `src/services/mcp/client.ts` para executar ferramentas via transporte direto quando aplicável.
- [x] T006 [P] Criar teste automatizado em `tests/unit/services/mcp/acs-router-transport.test.ts` verificando descoberta de ferramentas e formato JSON-RPC 2.0.

**Checkpoint**: User Story 1 completa e testável de forma independente.

---

## Phase 3: User Story 2 - Consulta Obrigatória a /como-usar e Enforçamento de Regras pela IA (P1)

**Goal**: Garantir que o atendente inteligente (Autopilot / Workflow Runtime) consulte as instruções do guia `/como-usar` (via `get_tool_manual` ou manuais sincronizados) e siga estritamente as regras de diagnóstico, Zero Plaintext Secrets, operações atômicas e confirmação de reboot.

**Independent Test**: Verificar se os prompts gerados em `process-chat.ts` e `agent-loop.ts` contêm as regras mandatórias do ACS e orientam o uso de `get_tool_manual` antes de qualquer ação operacional.

- [x] T007 Criar serviço de manuais `src/services/mcp/manuals.ts` para consultar `/manuals` e `/manuals/:tool_name?format=raw` ou chamar `get_tool_manual`.
- [x] T008 [P] Criar server actions `syncMcpManualsAction` e `getMcpToolManualAction` em `src/actions/mcp.ts` para disponibilizar os manuais no servidor e cliente.
- [x] T009 Atualizar `buildEnabledAgentToolsDescription` em `src/services/autopilot/runtime/process-chat.ts` para detectar ferramentas do ACS e injetar diretrizes estritas de operação (consulta obrigatória a `/como-usar`, Zero Plaintext Secrets, reboots auditados).
- [x] T010 Atualizar `buildAgentSystemPrompt` em `src/services/workflow-runtime/agent-loop.ts` para incluir a política operacional de roteadores e consulta ao `/como-usar`.
- [x] T011 Atualizar `runMcpCallTool` em `src/services/agent-tools/runtime.ts` e `autopilot-tool-bridge.ts` para repassar `remedial_suggestion` e `error_code` do ACS MCP diretamente para o contexto do modelo em caso de erro.
- [x] T012 [P] Criar teste automatizado em `tests/unit/services/autopilot/acs-router-prompt.test.ts` validando a injeção correta das diretrizes de `/como-usar` no prompt.

**Checkpoint**: User Stories 1 e 2 completas e integradas.

---

## Phase 4: User Story 3 - Visualizador dos Manuais de /como-usar e Usabilidade do Operador (P2)

**Goal**: Fornecer na interface de integrações MCP da Dialogy (`/integrations/mcp`) acesso fácil e visual aos manuais de `/como-usar` e sincronização direta com a base de conhecimento RAG.

**Independent Test**: Acessar `/integrations/mcp`, visualizar o servidor ACS cadastrado, clicar em "Ver Manuais / Como Usar" e visualizar a documentação renderizada com abas por ferramenta.

- [x] T013 Implementar visualizador/drawer de manuais técnicos de `/como-usar` em `src/app/integrations/mcp/page.tsx` com renderização de Markdown e busca.
- [x] T014 Implementar ação em `src/actions/mcp.ts` para salvar/atualizar os manuais oficiais do ACS como Documento de Conhecimento na base RAG do workspace (`ACS: Como Usar - Manuais Oficiais`).

---

## Phase 5: Polish, Validação End-to-End e Verificação

**Purpose**: Garantir qualidade, conformidade com a Constituição da Dialogy e funcionamento ponta a ponta com o servidor real do ACS.

- [x] T015 Testar conexão, sincronização e chamadas de ferramenta diretamente contra o servidor real `router-mcp` ativo em `http://localhost:8090/mcp`.
- [x] T016 Executar testes automatizados com `npx vitest run tests/unit/services/mcp/ tests/unit/services/autopilot/`.
- [x] T017 Executar `npm run typecheck` e `npm run lint` para garantir 0 erros de TypeScript e formatação limpa.
- [x] T018 Documentar o fluxo de uso no guia de integração e fechar o walkthrough.
