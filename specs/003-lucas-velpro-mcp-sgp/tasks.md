# Implementation Tasks: Agente Lucas Suporte Técnico Velpro com ACS MCP e Validação SGP

**Branch**: `003-lucas-velpro-mcp-sgp` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Ordered Task List

- [x] **Task 1: Desenvolver o script de orquestração e aplicação no banco de dados** `scripts/apply-lucas-velpro-sgp-mcp.ts`
  - [x] 1.1 Criar snapshot de backup em `autopilot_config_versions` para o agente Lucas (`7d7259ab-a6c3-4057-a9ca-28ddbb15db95`).
  - [x] 1.2 Puxar e enriquecer as 9 ferramentas do ACS MCP via `listMcpServerTools` com transporte `direct_http`.
  - [x] 1.3 Atualizar `workspace_integrations` para o provedor `mcp` com `direct_http`, URL `http://192.145.213.2:8090/mcp`, `healthStatus = healthy`, `lastError = null` e catálogo completo de tools.
  - [x] 1.4 Compilar os manuais oficiais de `/como-usar` do ACS e adicioná-los a `knowledge_base_documents`.
  - [x] 1.5 Atualizar o `knowledge_base` do Lucas com o fluxo de atendimento N2: triagem de CPF/CNPJ, disambiguação obrigatória de contrato SGP, correlação de IP com ACS, regras de atenuação óptica (-8 a -27 dBm), diagnóstico Wi-Fi, configuração atômica, reinício auditado e escalonamento com nota.
  - [x] 1.6 Atualizar `enabled_tool_names` com a lista completa das 14 ferramentas necessárias.

- [x] **Task 2: Executar o script de aplicação e persistir as alterações**
  - [x] 2.1 Executar `scripts/apply-lucas-velpro-sgp-mcp.ts` em modo dry-run para inspecionar todas as mudanças.
  - [x] 2.2 Executar com flag `--apply` para aplicar atomicamente na transação do PostgreSQL.
  - [x] 2.3 Confirmar que o novo version_number foi registrado no histórico.

- [x] **Task 3: Desenvolver e executar o script de verificação e simulação** `scripts/verify-lucas-velpro.ts`
  - [x] 3.1 Verificar os campos atualizados de `autopilot_configs` e `workspace_integrations`.
  - [x] 3.2 Testar a conectividade ativa e listagem de ferramentas no endpoint do servidor MCP.
  - [x] 3.3 Validar a aderência das regras operacionais através de teste automatizado de prompts e schemas.

- [x] **Task 4: Documentar os resultados e apresentar o walkthrough ao usuário**
  - [x] 4.1 Elaborar o relatório completo no `walkthrough.md`.
  - [x] 4.2 Apresentar ao usuário as melhorias implementadas em português claro e objetivo.
