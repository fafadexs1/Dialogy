# AI Attendant Runbook

## Objetivo

Diagnosticar rapidamente se uma resposta ruim veio de intencao, RAG, workflow, tool planner, validator, LLM, ferramenta externa, envio ou configuracao do agente.

## Checks rapidos

1. Rode os evals offline:

```bash
npm run eval:autopilot
```

2. Veja os testes de regressao:

```bash
npm test -- tests/autopilot-evals.spec.ts
```

Antes de publicar mudancas no runtime, rode o gate deterministico completo:

```bash
npm run test:autopilot:quality
```

Esse gate exige qualidade perfeita nos cenarios declarados e cobre:

- MCP qualificado e selecao semantica por descricao/schema;
- consulta, status, agendamento, cancelamento e Wi-Fi;
- confirmacao persistida para efeitos colaterais;
- timeout sem retry autonomo;
- circuit breaker por servidor depois de falhas consecutivas de transporte;
- lease distribuido por chat contra workers concorrentes;
- deduplicacao persistida da mesma mensagem de origem;
- claim duravel por tool + payload contra replay depois de crash;
- entrega duravel da resposta por mensagem de origem, com retomada por bloco;
- dead-letter terminal que devolve o chat mais recente para a fila humana;
- stale guard central antes de qualquer tool call e envio visivel;
- retry explicito com uma unica tentativa por turno;
- nova confirmacao antes de repetir qualquer escrita;
- cadeia SGP -> MCP sem derivar para reboot;
- recuperacao de argumentos auditados sem pedir os mesmos campos novamente.
- fallback do Flowbuilder com branch, schema e confirmacao para capabilities MCP arbitrarias.

Se a task neural de arquitetura retornar JSON invalido, o Flowbuilder encerra as chamadas neurais restantes e compila imediatamente uma proposta deterministica completa. O erro tecnico fica somente no log; ele nao entra no manifesto operacional nem na resposta do agente.

3. Rode o canario E2E persistido:

```bash
npm run e2e:autopilot:canary
```

O canario cria e remove um workspace sintetico, usa um servidor MCP local real via stdio e executa oito mensagens sequenciais mais uma colisao concorrente. Ele exige:

- resposta persistida antes do proximo turno;
- nomes MCP qualificados corretos;
- schema dinamico coletado antes da tool;
- confirmacao vinculada aos argumentos;
- uma unica execucao da escrita confirmada;
- zero chamadas da tool destrutiva;
- cancelamento e confirmacao obsoleta sem replay;
- duas execucoes simultaneas da mesma mensagem produzindo uma resposta, uma auditoria e uma chamada MCP;
- nenhuma resposta com JSON cru.

Use `AUTOPILOT_CANARY_KEEP_DATA=true` somente para depuracao. O padrao sempre remove workspace, usuario, chat, mensagens, traces e log MCP sinteticos.

4. Para reproduzir um atendimento real sem enviar WhatsApp nem alterar sistemas externos, rode o replay read-only:

```bash
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj-opcional> <contrato-opcional> wifi_credentials
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj-opcional> <contrato-opcional> wifi_channel_diagnostics
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj-opcional> <contrato-opcional> wifi_branch_switch
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj> <contrato> reboot_confirmation
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj> <contrato> wifi_change_confirmation
npm run e2e:autopilot:readonly-replay -- <chat-id-de-origem> <cpf-cnpj> <contrato-inexistente> contract_mismatch
```

O replay usa o fluxo, SGP e servidor MCP reais em um chat e contato sinteticos com instancia local. O CPF informado e gravado somente no contato sintetico e a fixture e removida ao final. Ele:

- envia uma mensagem por vez e espera a resposta persistida;
- pula classificador LLM, RAG e gate de encerramento quando a intencao operacional e inequivoca;
- exige validacao SGP antes de `get_wifi_view`;
- correlaciona a memoria SGP por uma impressao HMAC-SHA-256 da operacao, mantendo o documento redigido nos logs;
- aceita detalhes do endpoint de suporte somente para contratos presentes na resposta URA validada pelo CPF;
- encerra divergencia CPF/contrato antes do procedure runtime e sem chamada MCP;
- exige uma unica tentativa da tool MCP qualificada por turno;
- nos cenarios de consulta/diagnostico, permite somente MCP classificada como `riskLevel=low` e `sideEffect=none`;
- nos cenarios de reboot/troca, valida contrato e apenas persiste a confirmacao da tool qualificada; a tool destrutiva nunca e executada pelo replay;
- nunca imprime CPF, IP, SSID ou senha;
- falha se houver reboot, troca de credencial ou alteracao de canal executados;
- na troca de senha, envia o pedido e o valor sintetico em mensagens separadas, reutiliza a validacao SGP e para antes do `confirmo`;
- no diagnostico, tenta um scan ao vivo uma vez e pode consultar `get_wifi_scan_cached` uma vez se o roteador estiver inacessivel;
- identifica claramente quando a analise veio de cache e nunca aplica a recomendacao de canal;
- encerra o turno com fallback seguro se uma tool obrigatoria falhar;
- remove contato, chat, mensagens, traces e agente sinteticos ao terminar.

Replays mantidos com `AUTOPILOT_READONLY_REPLAY_KEEP_DATA=true` sao apenas para depuracao. Antes de uma nova execucao, o harness remove replays sinteticos antigos do mesmo contato/configuracao para que a resolucao de identidade canonica nunca reutilize estado de teste obsoleto.

Para auditar e reconstruir o fluxo publicado do Lucas com branches Wi-Fi isolados, ferramentas MCP qualificadas, cobertura total e layout sem sobreposicao:

```bash
npm run repair:autopilot:lucas
npm run repair:autopilot:lucas:apply
```

O primeiro comando e somente dry-run. O segundo cria versoes de backup, aplica a proposta em transacao e rejeita a alteracao se houver ferramenta sem branch/confirmacao, MCP generica, aresta pendente ou bloco sobreposto.

Se o endpoint MCP estiver inacessivel, o erro deve informar transporte/endpoint e causa como `UND_ERR_CONNECT_TIMEOUT`. Confirme a origem autorizada no firewall e use **Integracoes > MCP > Testar conexao** a partir do mesmo ambiente onde o worker roda.

Para separar falha de rota TCP de falha no handshake MCP sem imprimir host, headers ou credenciais:

```bash
npm run diagnose:mcp -- <chat-id-ou-workspace-id>
```

Cada chamada real tambem persiste `healthStatus`, `healthCheckedAt`, `healthLatencyMs` e `lastError` no servidor correspondente. Um erro de tool retornado pelo proprio MCP ainda conta como servidor acessivel; somente falha de transporte marca `unreachable`.

O runtime abre o circuito do servidor por 60 segundos depois de duas falhas de transporte consecutivas. Durante essa janela, novas chamadas falham rapidamente; ao expirar, somente uma chamada de sonda testa a recuperacao. Ajustes:

- `MCP_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `MCP_CIRCUIT_BREAKER_OPEN_MS`
- `MCP_CIRCUIT_BREAKER_FAILURE_WINDOW_MS`

O runtime tambem serializa o processamento por chat no PostgreSQL. Uma mensagem antiga que aguarda o lease e recebe uma mensagem nova e descartada como superseded. Uma duplicata da mesma mensagem e descartada depois que encontra `responseSent=true`. Ajustes:

- `AUTOPILOT_CHAT_LEASE_MS` (padrao 600000)
- `AUTOPILOT_CHAT_LEASE_WAIT_MS` (padrao 90000)
- `AUTOPILOT_CHAT_LEASE_POLL_MS` (padrao 250)

Se a espera expirar, o runtime lanca `AUTOPILOT_CHAT_LEASE_TIMEOUT` para a fila tentar novamente; ele nao marca silenciosamente a mensagem como processada.

Cada tool iniciada por um `orchestrator_run` tambem recebe uma claim persistida por `source_message_id + operation_fingerprint`. O fingerprint inclui tipo, nome qualificado e payload, mas ignora a redacao do motivo. Leituras/idempotentes podem assumir uma claim expirada; escritas nao idempotentes ficam `uncertain` e nunca sao repetidas automaticamente. Ajuste:

- `AUTOPILOT_TOOL_CLAIM_STALE_MS` (padrao 600000)
- `SGP_CONTACT_PANEL_TOOL_TIMEOUT_MS` (padrao 30000; uma unica tentativa)

Cada resposta visivel e preparada em `autopilot_response_deliveries` antes do primeiro envio. Em retry, o runtime reutiliza os blocos originais, detecta os blocos ja persistidos e continua do primeiro bloco faltante. Isso evita resposta regenerada divergente e duplicacao depois de crash entre o envio e a conclusao do run.

O worker de IA tenta `ai_autopilot_process` tres vezes. Se a ultima tentativa do turno mais recente falhar sem resposta concluida, ele desativa o autopilot, remove a atribuicao do agente de IA, devolve o chat para `gerais` e grava uma nota interna `event=autopilot_dead_letter`. Mensagens antigas, ja respondidas ou substituidas por uma entrada mais recente nunca acionam esse escalonamento.

Antes de cada lote de tools e de cada envio visivel, o runtime confirma que `sourceMessageId` continua sendo a entrada mais recente do cliente. Se uma nova mensagem chegou durante o processamento, o run antigo termina como `skipped` com `staleSourceMessage=true`, sem tool, fallback ou resposta antiga.

As migrations `20260627170000_autopilot_chat_leases`, `20260627183000_autopilot_tool_execution_claims` e `20260627200000_autopilot_response_deliveries` sao obrigatorias antes de subir os novos workers.

5. Inspecione traces recentes no banco:

```sql
SELECT
  id,
  status,
  intent,
  confidence_score,
  metadata->>'workflowId' AS workflow_id,
  metadata->>'ragStrategy' AS rag_strategy,
  metadata->>'knowledgeCoverage' AS knowledge_coverage,
  metadata->'toolPlanner' AS tool_planner,
  metadata->'responseValidator' AS response_validator,
  metadata->>'fallbackReason' AS fallback_reason,
  timings,
  completed_at
FROM orchestrator_runs
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

## Eventos por conversa

```sql
SELECT
  kind,
  status,
  duration_ms,
  payload,
  created_at
FROM orchestrator_events
WHERE run_id = $1
ORDER BY created_at ASC;
```

Leitura:

- `intent_resolution`: intencao, confianca, workflow escolhido e slots extraidos.
- `rag_selection`: documentos selecionados, estrategia e cobertura.
- `rag_fallback_static_documents`: vetor falhou ou nao trouxe contexto util e caiu para base estatica.
- `workflow_plan`: se o workflow respondeu direto, pediu slot ou planejou tools antes da resposta.
- `tool_planner`: tools aceitas/rejeitadas e promessas de consulta reparadas.
- `response_validator`: resposta final aprovada, reparada, convertida em fallback ou handoff.

## Sinais de alerta

- `fallbackRate` subindo: veja `fallback_reason`, `responseValidator.reasons` e erros de tool.
- `knowledgeCoverage = none/low`: base fraca, documento fora de categoria ou pergunta sem material.
- `tool_planner.rejectedActions`: tool fora da intencao, sem slot, desabilitada ou exigindo aprovacao.
- `responseValidator.decision != approve`: resposta vazia, vazamento tecnico, promessa sem tool ou sucesso sem consulta real.
- `tool_execution` com erro/timeout: problema externo, credencial, SGP/MCP ou budget curto.
- `tool_idempotency:in_progress`: outra execucao ainda detem a claim da mesma operacao.
- `tool_idempotency:uncertain`: uma escrita iniciou antes de um crash; reconciliar no sistema externo e nao repetir automaticamente.
- `AUTOPILOT_CHAT_LEASE_TIMEOUT`: o chat ficou ocupado alem do limite; a fila deve tentar novamente.
- `autopilot_response_deliveries.status = error`: o envio falhou e sera retomado usando os mesmos blocos.
- nota interna `event = autopilot_dead_letter`: as tentativas do turno atual se esgotaram e o chat foi devolvido para humanos.

## Concorrencia e claims

```sql
SELECT chat_id, source_message_id, acquired_at, heartbeat_at, expires_at
FROM autopilot_chat_leases
ORDER BY acquired_at DESC;

SELECT
  chat_id,
  source_message_id,
  tool_name,
  idempotent,
  status,
  started_at,
  completed_at,
  updated_at
FROM autopilot_tool_execution_claims
WHERE workspace_id = $1
ORDER BY updated_at DESC
LIMIT 100;

SELECT
  chat_id,
  source_message_id,
  delivery_key,
  status,
  next_block_index,
  jsonb_array_length(blocks) AS block_count,
  last_error,
  updated_at
FROM autopilot_response_deliveries
WHERE workspace_id = $1
ORDER BY updated_at DESC
LIMIT 100;
```

Uma claim `uncertain` exige verificacao no sistema externo. Nao altere seu status manualmente para forcar replay; envie uma nova solicitacao somente depois de confirmar o resultado real e obter nova confirmacao do cliente quando houver efeito colateral.

## Taxas uteis

```sql
SELECT
  count(*) AS total,
  avg((status = 'fallback')::int) AS fallback_rate,
  avg((metadata->>'responseSent' = 'true')::int) AS response_sent_rate,
  intent,
  metadata->>'ragStrategy' AS rag_strategy,
  metadata->>'knowledgeCoverage' AS knowledge_coverage,
  metadata->'responseValidator'->>'decision' AS validator_action
FROM orchestrator_runs
WHERE workspace_id = $1
  AND created_at >= now() - interval '24 hours'
GROUP BY intent, rag_strategy, knowledge_coverage, validator_action
ORDER BY total DESC;
```

## Quando uma conversa real falhar

1. Abra `orchestrator_events` do `run_id`.
2. Identifique a primeira etapa com `fallback` ou `error`.
3. Se o humano corrigiu a resposta, transforme a conversa em novo caso offline em `src/services/autopilot/eval-cases.ts`.
4. Rode `npm run eval:autopilot`.
5. Corrija o componente que falhou antes de mexer no prompt.
