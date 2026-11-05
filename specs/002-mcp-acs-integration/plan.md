# Implementation Plan: Integração Robusta com MCP do ACS e Consulta Obrigatória a /como-usar

**Branch**: `002-mcp-acs-integration` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-mcp-acs-integration/spec.md`

## Summary

O objetivo desta entrega é transformar a integração MCP da Dialogy em uma arquitetura de alta performance, resiliente e estrita para a operação remota de roteadores e ONTs através do servidor MCP do ACS. A solução introduz:
1. **Transporte HTTP JSON-RPC 2.0 Resiliente**: Fallback direto sem bloqueios de streaming SSE para endpoints HTTP, com latência sub-100ms e suporte a tokens de autenticação (`ACS_SERVICE_TOKEN`).
2. **Sincronização Fiel das 9 Ferramentas**: Puxa com 100% de integridade os schemas, tipos, parâmetros obrigatórios e anotações de segurança de cada ferramenta do ACS.
3. **Consulta Obrigatória ao Guia `/como-usar` pela IA**: Injeção de diretrizes mandatórias nos prompts do sistema (`process-chat.ts`, `agent-loop.ts`, `auto-responder.ts`) e garantia de acesso à ferramenta `get_tool_manual` e aos manuais técnicos em Markdown, fazendo com que a IA siga à risca as instruções oficiais de diagnóstico e configuração.
4. **Tratamento de Erros Acionáveis**: Propagação de `remedial_suggestion` e `error_code` do MCP para auto-correção imediata pelo modelo.
5. **Experiência do Operador**: Visualização dos manuais de `/como-usar` diretamente na interface de integrações MCP da Dialogy.

## Technical Context

**Language/Version**: TypeScript 5.4+ (Node.js 20+)
**Primary Dependencies**: `@modelcontextprotocol/sdk`, Next.js 15 App Router, Genkit, Zod, React 19, Lucide React
**Storage**: PostgreSQL com Prisma ORM e `workspace_integrations` (JSONB)
**Testing**: Vitest (`npm test`)
**Target Platform**: Servidor Web / API Next.js e Workers de Autopilot
**Project Type**: Web Application + AI Agent Runtime
**Performance Goals**: Sincronização e teste de ferramentas em < 2s; despacho de tool call < 1s
**Constraints**: Zero plain-text credentials; isolamento multi-inquilino rígido por `workspace_id`

## Constitution Check

- [x] **Principle I: Multi-Tenant & Workspace Isolation**: Todas as configurações de servidor MCP, credenciais e ferramentas são vinculadas e filtradas estritamente por `workspaceId`.
- [x] **Principle II: Type Safety & Schema Integrity**: Tipagem estrita em TypeScript, schemas validados via Zod e JSON Schema, sem uso de implicit `any`.
- [x] **Principle III: Resilient Channel & Provider Decoupling**: Timeout configurável, circuit breaker, retry em caso de falha transitória e tratamento de erros do ACS MCP.
- [x] **Principle IV: Test-First & Quality Gate Enforcement**: Testes de unidade e integração automatizados cobrindo transporte, sincronização, enriquecimento de manuais e injeção de prompt.
- [x] **Principle V: Observability & Graceful Degradation**: Telemetria estruturada de latência, saúde de conexão e gravação de auditoria de execução de ferramentas.

## Project Structure

### Documentation (this feature)

```text
specs/002-mcp-acs-integration/
├── spec.md              # Especificação de negócio e requisitos funcionais
├── plan.md              # Este plano técnico de implementação
├── research.md          # Decisões de arquitetura e transporte
├── data-model.md        # Estruturas de dados e contratos
├── quickstart.md        # Roteiro de validação automatizada
├── checklists/
│   └── requirements.md  # Validação de qualidade do spec
└── tasks.md             # Tarefas de implementação ordenadas
```

### Source Code Impacted

```text
src/
├── services/
│   ├── mcp/
│   │   ├── client.ts              # [MODIFY] Adicionar transporte JSON-RPC direto resiliente & timeout inteligente
│   │   ├── types.ts               # [MODIFY] Expandir tipos com 'direct_http' e metadados de manuais
│   │   ├── store.ts               # [MODIFY] Persistência de manuais e metadados enriquecidos
│   │   └── manuals.ts             # [NEW] Cliente de consulta aos manuais /como-usar (/manuals e get_tool_manual)
│   ├── agent-tools/
│   │   └── runtime.ts             # [MODIFY] Tratar structuredContent.remedial_suggestion nos erros MCP
│   ├── workflow-runtime/
│   │   ├── agent-loop.ts          # [MODIFY] Instrução mandatória de consulta a /como-usar e regras de roteadores
│   │   └── autopilot-tool-bridge.ts # [MODIFY] Enriquecimento e validação de tools MCP do ACS
│   └── autopilot/
│       └── runtime/
│           └── process-chat.ts    # [MODIFY] Injetar regras estritas de roteadores e consulta a /como-usar no prompt
├── actions/
│   └── mcp.ts                     # [MODIFY] Ações de teste, sincronização de tools e manuais
└── app/
    └── integrations/
        └── mcp/
            └── page.tsx           # [MODIFY] Drawer/visualizador de manuais /como-usar e teste aprimorado
```

## Implementation Phases

### Phase 1: Transporte Resiliente e Sincronização Robusta de Ferramentas
- Refatorar `src/services/mcp/client.ts` para implementar o **Direct JSON-RPC 2.0 Transport**:
  - Tenta POST JSON-RPC direto com fallback suave.
  - Não trava em streamings SSE que não transmitem mensagens JSON-RPC.
  - Sincroniza todas as 9 ferramentas do ACS MCP sem perda de schemas ou timeout.

### Phase 2: Cliente de Manuais `/como-usar` e Enriquecimento de Ferramentas
- Criar `src/services/mcp/manuals.ts` para consultar `/manuals` ou chamar `get_tool_manual`.
- Atualizar a sincronização em `src/actions/mcp.ts` para puxar os manuais de `/como-usar` e anexar as instruções operacionais de cada ferramenta.
- Implementar ação para sincronizar os manuais oficiais como Knowledge Base Document no workspace da Dialogy.

### Phase 3: Enforçamento de Regras Estritas nos Prompts da IA
- Atualizar `process-chat.ts` (Autopilot), `agent-loop.ts` (Workflow Runtime) e `auto-responder.ts`:
  - Se ferramentas do ACS estiverem habilitadas, injetar as instruções mandatórias de operação de roteador:
    - Obrigatoriedade de consultar `/como-usar` via `get_tool_manual` antes de agir.
    - Zero Plaintext Secrets (proibição de expor credenciais).
    - Exigência de `confirm: true` e justificativa auditada para `reboot_router`.
    - Chamadas atômicas para `configure_wifi`.
- Atualizar `runMcpCallTool` para capturar `structuredContent.remedial_suggestion` e repassar para a IA em caso de erro.

### Phase 4: Interface e Visualização de `/como-usar` na Dialogy
- No painel `/integrations/mcp`, adicionar visualizador nativo dos manuais de `/como-usar` com suporte a Markdown.
- Botão "Testar Conexão e Sincronizar" com diagnóstico em tempo real.

### Phase 5: Testes Automatizados e Verificação
- Testes unitários com Vitest para o transporte MCP direto, cliente de manuais e formatação de prompts.
- Validação contra o servidor real `router-mcp` ativo na porta 8090.
