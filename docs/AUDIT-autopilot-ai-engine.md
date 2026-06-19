# Auditoria de Implementacao: Autopilot Switch + Decision Engine

Data: 2026-06-16 BRT / 2026-06-17 UTC

## Escopo

Esta auditoria cruza os requisitos de:

- `docs/PLAN-autopilot-switch-node.md`
- `docs/PLAN-agent-decision-engine.md`

O objetivo e verificar o estado real do motor de IA operacional: fluxo com Switch, decisao auditavel, ferramentas governadas por policy, Resource Mapper, outcomes e autoevolucao.

## Resultado Executivo

Status atual: **fechado tecnicamente para o escopo implementado, com E2E sintetico e QA autenticada aprovados**.

O motor base esta implementado, alinhado com o schema real do Supabase e validado por testes automatizados, E2E com banco real e QA visual autenticada. O que ainda depende de operacao real nao e codigo pendente, e sim coleta historica:

- Medir se o agente de hoje e melhor que o agente de 30 dias atras exige volume real de atendimentos e outcomes historicos.
- Rodar conversas reais anonimizadas adicionais continua recomendado como homologacao de negocio, mas o fluxo tecnico fim a fim ja foi comprovado com dados sinteticos descartaveis.

## Evidencia de Validacao

Ultima validacao executada nesta rodada:

- `npm.cmd test -- tests/tool-capability-registry.spec.ts tests/resource-mapping-profiles.spec.ts tests/resource-mapper.spec.ts tests/procedure-store.spec.ts tests/procedure-runtime.spec.ts tests/procedure-prompt-slim.spec.ts tests/procedure-flow-compiler.spec.ts tests/knowledge-tool-procedures.spec.ts tests/autopilot-workflow-engine.spec.ts tests/autopilot-turn-policy.spec.ts tests/autopilot-tool-prearm.spec.ts tests/autopilot-tool-planner.spec.ts tests/autopilot-tool-memory.spec.ts tests/autopilot-switch-route-outcomes.spec.ts tests/autopilot-slots.spec.ts tests/autopilot-sgp-response.spec.ts tests/autopilot-score-history.spec.ts tests/autopilot-response-validator.spec.ts tests/autopilot-repetition-guard.spec.ts tests/autopilot-procedure-outcomes.spec.ts tests/autopilot-playground-trace.spec.ts tests/autopilot-outcome-tracker.spec.ts tests/autopilot-learning-trend.spec.ts tests/autopilot-learning-scheduler.spec.ts tests/autopilot-learning-cycle.spec.ts tests/autopilot-intent.spec.ts tests/autopilot-flow-state.spec.ts tests/autopilot-flow-routing.spec.ts tests/autopilot-flow-builder-ai.spec.ts tests/autopilot-flow-audit.spec.ts tests/autopilot-evals.spec.ts tests/autopilot-ecosystem-patterns.spec.ts tests/autopilot-config-selection.spec.ts tests/autopilot-close-intent.spec.ts tests/autopilot-causal-patterns.spec.ts tests/autopilot-causal-pattern-review.spec.ts tests/autopilot-causal-pattern-impact.spec.ts tests/autopilot-causal-pattern-apply.spec.ts tests/agent-tools-runtime.spec.ts tests/agent-tools-router.spec.ts tests/agent-tool-policy.spec.ts tests/agent-hooks-list-route.spec.ts tests/agent-decision-ledger.spec.ts tests/agent-decision-engine.spec.ts`
  - 44 arquivos, 310 testes, passou.
- `npm.cmd test -- tests/autopilot-flow-state.spec.ts tests/agent-tool-policy.spec.ts tests/autopilot-sgp-response.spec.ts tests/autopilot-switch-route-outcomes.spec.ts tests/autopilot-procedure-outcomes.spec.ts tests/autopilot-learning-trend.spec.ts tests/autopilot-score-history.spec.ts tests/autopilot-ecosystem-patterns.spec.ts tests/autopilot-learning-cycle.spec.ts tests/autopilot-learning-scheduler.spec.ts tests/autopilot-causal-pattern-impact.spec.ts tests/autopilot-causal-pattern-apply.spec.ts tests/autopilot-causal-pattern-review.spec.ts tests/autopilot-causal-patterns.spec.ts tests/autopilot-outcome-tracker.spec.ts tests/agent-decision-engine.spec.ts tests/agent-decision-ledger.spec.ts tests/autopilot-flow-audit.spec.ts tests/autopilot-flow-routing.spec.ts tests/autopilot-flow-builder-ai.spec.ts tests/tool-capability-registry.spec.ts tests/autopilot-tool-planner.spec.ts tests/resource-mapper.spec.ts tests/resource-mapping-profiles.spec.ts tests/procedure-runtime.spec.ts tests/procedure-store.spec.ts tests/procedure-flow-compiler.spec.ts`
  - 27 arquivos, 191 testes, passou.
- `npm.cmd test -- tests/autopilot-flow-state.spec.ts tests/agent-tool-policy.spec.ts tests/autopilot-sgp-response.spec.ts`
  - 3 arquivos, 47 testes, passou.
- `npm.cmd test -- tests/autopilot-learning-scheduler.spec.ts tests/autopilot-learning-cycle.spec.ts`
  - 2 arquivos, 6 testes, passou.
- `npm.cmd test -- tests/procedure-store.spec.ts tests/procedure-runtime.spec.ts tests/agent-decision-ledger.spec.ts tests/resource-mapper.spec.ts tests/resource-mapping-profiles.spec.ts`
  - 5 arquivos, 31 testes, passou.
- `npm.cmd test -- tests/procedure-flow-compiler.spec.ts tests/procedure-runtime.spec.ts tests/procedure-store.spec.ts tests/autopilot-flow-routing.spec.ts tests/autopilot-sgp-response.spec.ts`
  - 5 arquivos, 63 testes, passou.
- `npm.cmd run typecheck`
  - passou.
- `npm.cmd run eval:autopilot`
  - 22/22 casos, score 1.0.
- `git diff --check`
  - sem erro real; apenas avisos LF/CRLF do Windows.
- `node_modules\.bin\tsx.cmd scripts\verify-autopilot-e2e-sandbox.ts`
  - passou contra o Supabase real com workspace/chat/agente sinteticos descartaveis;
  - validou mensagem outbound persistida, `orchestrator_runs`, `agent_decision_ledger`, evento `switch_resolution`, rota `lentidao_wifi`, ledger com rota Switch e resposta de diagnostico;
  - limpeza confirmada: `leftover_workspaces = 0`.
- `node_modules\.bin\tsx.cmd scripts\verify-authenticated-ui-qa.ts`
  - passou em navegador autenticado real contra `http://localhost:9002`;
  - validou login, `/api/user`, `/settings/workspace`, painel de aliases do Resource Mapper, `/autopilot/{configId}` e Switch node visivel;
  - screenshots gerados em `tmp/qa-auth-workspace.png` e `tmp/qa-auth-autopilot.png`;
  - limpeza confirmada: `leftover_workspaces = 0`, `leftover_users = 0`.
- Dev server local
  - o Next dev server falhou dentro da sandbox em `.next` com `EPERM`; foi destravado com `NEXT_DIST_DIR=.next-codex-dev` e `experimental.lockDistDir=false`.
  - `next.config.js` agora aceita `NEXT_DIST_DIR` opcional para QA/local sem alterar o default de build.

## Validacao Supabase Real

Validacao executada contra o projeto Supabase conectado:

- Schema real de `agent_decision_ledger` revisado e codigo ajustado para usar `orchestrator_run_id`, `procedure_session_id`, `missing_slots_json`, `resource_mappings_json`, `response_instruction` e `metadata`.
- Schema real de `resource_mapping_ledger` revisado e codigo ajustado para usar `orchestrator_run_id`, `procedure_session_id` e `metadata`.
- Migration `agent_procedure_sessions_compat` aplicada com sucesso no Supabase real.
- Tabelas `agent_procedure_definitions` e `agent_procedure_sessions` confirmadas no Supabase real.
- Migration `autopilot_fk_indexes` aplicada com sucesso no Supabase real.
- Os 8 indices FK do Autopilot foram confirmados em `pg_indexes`:
  - `idx_agent_decision_ledger_message_id_fk`
  - `idx_agent_decision_ledger_system_agent_id_fk`
  - `idx_agent_decision_ledger_autopilot_config_id_fk`
  - `idx_resource_mapping_ledger_message_id_fk`
  - `idx_agent_procedure_sessions_agent_id_fk`
  - `idx_agent_causal_patterns_agent_id_fk`
  - `idx_agent_score_history_agent_id_fk`
  - `idx_agent_score_history_evidence_pattern_id_fk`
- Supabase Security Advisor retornou sem alertas.
- Migration `agent_score_history_compat` aplicada com sucesso no Supabase real.
- Migration `agent_ecosystem_patterns` aplicada com sucesso no Supabase real.
- Coluna `workspaces.vertical` confirmada como `text` no Supabase real.
- Performance Advisor ainda pode conter avisos antigos do projeto fora deste escopo; os avisos relevantes das tabelas novas do Autopilot foram tratados pelos indices acima.

## Switch Node

| Requisito | Status | Evidencia |
| --- | --- | --- |
| `switch` em `AutopilotFlowNodeKind` | Completo | `src/lib/types.ts` |
| `AutopilotFlowSwitchRoute` | Completo | `src/lib/types.ts` |
| Config: instructions, mode, threshold, fallback, routes | Completo | `src/lib/types.ts`, `src/components/autopilot/autopilot-flow-builder.tsx` |
| Card visual e bloco na sidebar | Completo e validado em QA autenticada | `src/components/autopilot/autopilot-flow-builder.tsx`, `scripts/verify-authenticated-ui-qa.ts` |
| Rotas editaveis no inspector | Completo e validado por carregamento autenticado do builder | `src/components/autopilot/autopilot-flow-builder.tsx`, `scripts/verify-authenticated-ui-qa.ts` |
| Edges podem representar rotas | Completo | `routeId` em `AutopilotFlowEdge`; testes em `tests/autopilot-flow-routing.spec.ts` |
| IA Builder gera Switch | Completo | `src/ai/flows/autopilot-flow-builder.ts`, `tests/autopilot-flow-builder-ai.spec.ts` |
| Sanitizacao de rotas | Completo | `src/ai/flows/autopilot-flow-builder.ts`, testes de builder |
| Roteamento offline deterministico | Completo | `src/services/autopilot/flow-routing.ts` |
| Rota escolhida, target, confianca e evidencia | Completo | `FlowSwitchResolution`, `tests/autopilot-flow-routing.spec.ts` |
| Rotas candidatas/rejeitadas auditaveis | Completo | `candidateRoutes`, `rejectedRoutes` em `src/services/autopilot/flow-routing.ts`; `tests/agent-decision-engine.spec.ts` |
| Runtime atualiza active node pelo Switch | Completo | `src/services/autopilot/runtime/process-chat.ts` |
| Evento `switch_resolution` no orchestrator | Completo | `src/services/autopilot/runtime/process-chat.ts` |
| Auditoria antes de publicar | Completo | `src/services/autopilot/flow-audit.ts`, chamada em `publishAutopilotDraft` |
| Simulacoes por rota/fallback | Completo | `simulateAutopilotFlowBeforePublish`, `tests/autopilot-flow-audit.spec.ts` |
| Outcomes por rota | Completo | `src/services/autopilot/switch-route-outcomes.ts`, painel em `autopilot-decision-insights.tsx` |
| Autoevolucao com sugestoes de rota | Completo como sugestao/aplicacao de patch | `src/services/autopilot/causal-patterns.ts`, `causal-pattern-apply.ts` |

## Agent Decision Engine

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Decision Ledger | Completo | `src/services/autopilot/decision-ledger.ts`, migration `20260615143000_agent_decision_ledger` |
| Goal/intent no ledger | Completo | `decideAgentNextAction`, `tests/agent-decision-engine.spec.ts` |
| Procedimento/etapa no ledger | Completo | `procedure` metadata e colunas `procedure_id`, `step_id` |
| Slots presentes/faltantes/invalidos | Completo | `slotSummary` sem valores brutos em `agent-decision-engine.ts` |
| Ferramentas selecionadas/bloqueadas | Completo | `selected_tools_json`, `blocked_tools_json` |
| Ferramentas candidatas e score | Completo | `toolPlanner.metadata.capabilityDecisions`, painel de insights |
| Bloqueio por score abaixo de 0.75 | Completo | `score_below_threshold` em `tool-capability-registry.ts`, testes |
| Confirmacao sensivel como `wait_confirmation` | Completo | `agent-decision-engine.ts`, `tests/agent-decision-engine.spec.ts` |
| Confirmacao curta com pending MCP | Completo | `flow-state-store.ts`, `tests/autopilot-flow-state.spec.ts` |
| Policy gate central | Completo | `src/services/autopilot/tool-capability-registry.ts`, `src/services/agent-tools/policy.ts` |
| Anti-alucinacao de tool desconhecida/desabilitada | Completo | `tool-capability-registry.ts`, `tool-planner.ts`, testes |
| Anti-alucinacao de payload invalido | Completo | `validatePayload` em `tool-planner.ts` |
| Resposta nao pode prometer consulta sem ferramenta | Completo | `hasExternalLookupPromise`, `planAutopilotTools`, eval |
| Response Validator | Ja existia e integrado | `src/services/autopilot/response-validator.ts`, eval |

## Resource Mapper

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Resource contract / field contract | Completo para CRM custom fields | `src/services/resource-mapper/types.ts` |
| Mapper CRM autonomo | Completo | `src/services/resource-mapper/crm-contact-custom-fields.ts` |
| Score de match campo/slot | Completo | `scoreAliasToField`, `matchSlotToField` |
| Normalizadores por tipo | Completo para tipos usados | `normalizeSlotValueForField` |
| Payload hash | Completo | `payloadHash`, testes em `tests/resource-mapper.spec.ts` |
| Ledger de mapeamento | Completo | `src/services/resource-mapper/ledger.ts`, migration `resource_mapping_ledger` |
| Aliases por workspace | Completo | `src/services/resource-mapper/profiles.ts`, UI em settings |
| UI para editar aliases | Completo e validado em QA autenticada | `src/app/settings/workspace/page.tsx`, `scripts/verify-authenticated-ui-qa.ts` |
| Generico para todos os recursos futuros | Parcial | arquitetura e tipos existem; implementacao completa hoje cobre `crm.contact.custom_fields` |

## Procedure Runtime

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Procedure/Step executavel | Completo | `src/services/autopilot/procedure-types.ts` |
| Estado persistente por chat | Completo | `procedure_executions`, `agent_procedure_sessions`, `src/services/autopilot/procedure-store.ts` |
| Execucao step-by-step | Completo | `src/services/autopilot/procedure-executor.ts` |
| Branching por decisao | Completo | `decide` step, `tests/procedure-runtime.spec.ts` |
| Validacao de tool result antes de responder | Completo | procedure runtime tests |
| Mapping visual-node -> procedure-step | Completo | `src/services/autopilot/procedure-flow-compiler.ts`, integrado em `runtime/process-chat.ts` e API de teste; `tests/procedure-flow-compiler.spec.ts` |
| Tabelas `agent_procedure_definitions/sessions` do plano | Completo | migration `20260616143000_agent_procedure_sessions`, `procedure-store.ts`, `tests/procedure-store.spec.ts` |
| `procedure_session_id` em ledgers | Completo | `agent_decision_ledger`, `resource_mapping_ledger`, `tests/agent-decision-ledger.spec.ts`, `tests/resource-mapper.spec.ts` |

## Flow Audit e Publicacao

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Validar conexoes | Completo | `flow-audit.ts` |
| Validar prompts/instrucoes | Completo | `flow-audit.ts` |
| Validar tool bindings | Completo | `flow-audit.ts` |
| Validar confirmacao sensivel | Completo | `flow-audit.ts`, `agent-tool-policy.spec.ts` |
| Validar fallback Switch | Completo | `flow-audit.ts` |
| Simular cliente direto/parcial/sim/mudanca/humano/falhas/RAG | Completo | `simulateAutopilotFlowBeforePublish` |
| Bloquear publicacao com problemas criticos | Completo | `publishAutopilotDraft` |

## Autoevolucao

| Requisito | Status | Evidencia |
| --- | --- | --- |
| Outcome tracking | Completo | `src/services/autopilot/outcome-tracker.ts` |
| Outcomes por procedimento | Completo | `procedure-outcomes.ts` |
| Outcomes por rota Switch | Completo | `switch-route-outcomes.ts` |
| Pattern detection | Completo | `causal-patterns.ts` |
| Revisao/aprovacao de patterns | Completo | `causal-pattern-review.ts`, painel |
| Aplicar/reverter sugestoes | Completo | `causal-pattern-apply.ts` |
| Score history | Completo | `score-history.ts`, migration |
| Cross-workspace ecosystem patterns | Completo como mecanismo | `ecosystem-patterns.ts`, migration |
| Scheduler operacional noturno | Completo | `src/services/autopilot/learning-cycle-scheduler.ts`, `src/worker-ai.ts`, `docker-compose.yml`, `tests/autopilot-learning-scheduler.spec.ts` |
| Soberania workspace | Completo no desenho de importacao/sugestao | `importEcosystemPatternForWorkspace`, UI de importar sugestao |

## Criterios de Sucesso

### Switch

O sistema consegue provar:

- rota escolhida: sim, `switchResolution.routeId`;
- por que foi escolhida: sim, `evidence`;
- rota rejeitada: sim, `rejectedRoutes`;
- confianca: sim, `confidence`;
- node que recebeu controle: sim, `targetNodeId`;
- resolveu ou precisou humano: sim, via `switchRouteOutcomes`.

### Motor Auditavel

O sistema consegue responder:

1. objetivo detectado: sim;
2. procedimento escolhido: sim quando ha procedimento ativo/match;
3. etapa ativa: sim;
4. dados presentes: sim, redigidos sem valor bruto;
5. dados faltantes: sim;
6. ferramentas candidatas: sim;
7. ferramenta permitida: sim, score e policy;
8. ferramentas bloqueadas: sim;
9. confirmacao exigida: sim, inclusive `wait_confirmation`;
10. recursos mapeados: sim;
11. campos preenchidos e motivo: sim;
12. payload validado antes da ferramenta: sim, com hash;
13. resposta enviada avancou atendimento: sim em eval, validator, outcomes e E2E sintetico; recomendado homologar com amostra real anonimizada.

### Motor Autoevolutivo

O sistema consegue responder:

14. resultado concreto da decisao: sim;
15. padroes de falha: sim;
16. correcoes sugeridas/aplicadas: sim;
17. indicadores ao longo do tempo: sim, learning trend/score history;
18. aprendizados cross-workspace: sim como mecanismo;
19. agente melhor que ha 30 dias: mecanismo pronto; depende de dados historicos reais suficientes.

## Pendencias Para Fechar 100%

1. Rodar uma amostra de conversas reais anonimizadas para homologacao de negocio, nao por lacuna tecnica atual.
2. Aguardar volume historico suficiente para comprovar ganho longitudinal de autoevolucao em 30 dias.
