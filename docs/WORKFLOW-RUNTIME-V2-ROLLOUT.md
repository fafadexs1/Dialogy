# Runtime V2: rollout operacional

O rollout é direcionado por workspace e nunca habilita outro tenant por acidente. O comando
`promote` é dry-run por padrão; somente `--apply` persiste a mudança.

```powershell
npm run workflow:v2:rollout -- list
npm run workflow:v2:rollout -- status --workspace <uuid>
npm run workflow:v2:rollout -- shadow-compile --workspace <uuid>
npm run workflow:v2:rollout -- promote --workspace <uuid> --stage shadow_compile --apply
npm run workflow:v2:rollout -- promote --workspace <uuid> --stage shadow_execution --apply
npm run workflow:v2:rollout -- shadow-execute --workspace <uuid>
npm run workflow:v2:rollout -- promote --workspace <uuid> --stage canary --apply
npm run workflow:v2:rollout -- promote --workspace <uuid> --stage beta --apply
npm run workflow:v2:rollout -- rollback-check --workspace <uuid>
npm run workflow:v2:rollout -- promote --workspace <uuid> --stage primary --apply
```

`shadow-compile` é somente leitura. `shadow-execute` usa modelo determinístico, registro de
ferramentas vazio, sender simulado e handoff simulado; o relatório deve sempre indicar
`externalSideEffects: 0`. O canary e o beta usam allowlist de workspace. `primary` é a única
etapa que torna a configuração independente da feature flag.

O `rollback-check` abre uma transação, desliga o runtime, confirma que os ponteiros para as
definições imutáveis continuam iguais e executa `ROLLBACK`; portanto o próprio teste não altera
o ambiente. Para realizar rollback, promova para `off --apply`. Rascunhos e versões publicadas
são preservados.

## Gates antes de cada promoção

- `shadow-compile`: todas as definições válidas.
- `shadow-execution`: zero efeito externo e execução explicável no debugger.
- `canary`: nenhuma resposta, handoff ou ferramenta duplicada nas conversas controladas.
- `beta`: isolamento de workspace e sanitização de eventos aprovados.
- `primary`: rollback-check, typecheck, build e suítes de workflow/Autopilot aprovados.

## Retirada do legado

O contrato final é `native_v2`. A remoção segura segue esta ordem: impedir novas automações
`legacy`, migrar e publicar as existentes, confirmar que não há linhas com
`workflow_builder_mode = 'legacy'`, retirar o seletor/rota do editor antigo e, por último,
remover o fallback do runtime. `flow_graph` deve permanecer somente leitura durante a janela
de rollback e só pode ser removido em uma migration posterior de retenção de dados.
