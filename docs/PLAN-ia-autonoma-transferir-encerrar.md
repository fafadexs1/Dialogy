# Plano: IA autônoma que transfere e encerra com precisão medida

Data: 2026-11-05. Escopo: IA Studio (núcleo `reasoning-v2` e runtime legado), decisões de **transferir** e **encerrar**, e a autonomia que depende delas.

## 0. Premissa honesta

"100% autônoma" e "precisão absurda" precisam virar números, senão ninguém sabe quando chegamos lá. Nenhum sistema com LLM acerta 100% das vezes, então a meta não é "nunca errar". A meta é:

1. **Nenhuma conversa fica sem dono.** Todo atendimento termina em: resolvido e encerrado, ou transferido com alguém (ou uma fila com prazo) assumindo.
2. **Decisões raras de errar, medidas com intervalo de confiança**, e não impressões.
3. **Erro barato e reversível.** Encerramento errado reabre sozinho; transferência errada não perde o contexto.
4. **Humano entra só por escolha do cliente ou por política**, e não porque a IA travou.

Os limiares da seção 2 são pontos de partida propostos. Devem ser recalibrados com o baseline da Fase 0 e com a tolerância de negócio.

## 1. Diagnóstico (o que verifiquei no código e nas auditorias)

| # | Achado | Evidência |
|---|--------|-----------|
| 1 | O núcleo novo **não tem ação explícita de encerrar** (`respond, tool, knowledge, recall, recall_history, consult, handoff, branch`). O encerramento é **implícito**: quando a resposta deixa todos os pedidos `resolved`/`cancelled`, a sessão vira `resolved` e o `process-chat` encerra o chat. *(Correção de 05/11: a primeira versão deste plano dizia que o v2 nunca encerrava; isso estava errado.)* | `reasoning-contract.ts:22`, `reasoning-engine.ts:468-470`, `process-chat.ts` (bloco do Estúdio, `UPDATE chats SET status='encerrados'`) |
| 2 | Esse fechamento implícito não exige confirmação do cliente nem checa "pergunta em aberto", então o risco é **encerrar cedo demais** (modelo marca o pedido resolvido na mesma resposta). O inverso também existe: a coleta de 12/09 registrou a IA dizendo que encerraria e a sessão ficando `waiting_input` (modelo não marcou os pedidos). O encerramento do Estúdio é um `UPDATE` direto, fora de `closeChatAction` e do `closeAuthorization`; **a verificar** se pula eventos, auditoria, broadcast ou pesquisa de satisfação. | `process-chat.ts`, `agent-tools/runtime.ts`, `docs/auditoria-dialogy-2026-09-12-coleta.md` |
| 3 | A detecção de "cliente quer encerrar" por regra exige a **mensagem inteira** igual a uma lista ("obrigado", "pode encerrar", "tchau"...). "valeu, pode fechar aí" ou "ok, era isso, obrigado!" passam batido. | `conversation-governor.ts:27-31` |
| 4 | A transferência no núcleo novo permite **uma tentativa por sessão** e, se o resultado for incerto, o modelo é instruído a não repetir e a "explicar o impedimento". O cliente pode ficar sem dono. | `reasoning-engine.ts:604-630` |
| 5 | Transferência falha quando não há agente online (`HANDOFF_FAILED`, `retryable: false`). Em 12/09, 3 das 5 falhas de automação foram essa. O teste ao vivo já faz fila + mensagem quando a equipe está indisponível; **não confirmei que o caminho de produção faz o mesmo**. | `workflow-runtime/node-handlers.ts:1299`, `live-test.ts:33-42` |
| 6 | O motivo da transferência é texto livre. Não dá para medir "por que transferimos" nem calcular taxa de transferência evitável. | `reasoning-engine.ts:619` |
| 7 | O `agent_decision_ledger` tinha **0 registros** na coleta de 12/09. Não existe taxa de resolução, de transferência correta ou de encerramento correto. | `docs/auditoria-dialogy-2026-09-12-coleta.md` |
| 8 | A resposta pode **prometer** algo que não aconteceu (encerrar, pré-reservar, alcance do Wi-Fi). Não há validador que compare o que a IA disse com o que foi executado. | Mesma coleta, ocorrências A e B |
| 9 | Já existe um pipeline útil para reaproveitar: `verify-autopilot-readonly-replay.ts`, `eval-autopilot.ts --offline` (22 casos), `autopilot-close-intent.spec.ts`, idempotência por `operationId`, estado `outcomeUnknown`. | `scripts/`, `tests/` |

### 1.1 Resultado parcial da Fase 0 (baseline de 05/11/2026)

Medido com `node scripts/baseline-ia-decisions.cjs --days=30`, somente leitura, só agregados, no banco configurado em `.env`. São proxies, não prova de acerto.

| Achado | Dado |
|--------|------|
| **Quase não há tráfego de IA real para medir.** O Estúdio tem 48 sessões no total, todas de 02 a 20/09; zero desde então. Mensagens enviadas pelo Autopilot: 107 e 119 nas semanas de 07 e 14/09, depois 2 a 48 por semana (14 conversas na semana de 26/10). | A taxa de acerto da IA em produção **não é mensurável com este volume**. O baseline de decisão precisa vir de reprodução (replay) sobre conversas históricas. |
| **O ~3 mil encerramentos/mês "por agente de sistema" são bots/fluxos, não o LLM.** Com `tool=close_chat` (Autopilot): 14, 10 e 27 por mês de maio a julho, 4 em setembro, 1 em outubro. | O encerramento por IA praticamente não está em uso. |
| **`HANDOFF_FAILED`: 146 falhas em 30 dias (49% das 300 falhas de workflow).** Motivos: equipe Suporte no limite de atendimentos (47), Financeiro sem ninguém online (36), Comercial sem ninguém online (32), Suporte sem ninguém online (31). Semana de 02/11: 49 só em 3 dias. | Confirma o item 5 do diagnóstico: transferência sem fila deixa o cliente sem dono. É o problema mais frequente e o mais barato de corrigir. |
| **`chats.closed_by_system_agent_id` não existe neste banco**, mas o `UPDATE` que encerra o chat quando a sessão do Estúdio fica `resolved` usa essa coluna (`process-chat.ts`, também no `HEAD`). O erro é capturado e só vai para o log. Nas 48 sessões, 1 ficou `resolved` e o chat dela está encerrado (não sei por qual caminho). | O encerramento implícito do Estúdio **não funciona neste banco**. Não habilitei nada: consertar sem a confirmação do cliente faria a IA passar a encerrar cedo. Entra na Fase 1 junto com o `close` explícito. |
| 9 execuções falharam com `relation "chat_transfer_operations" does not exist` (código 42P01). | **Resolvido, sem ação.** Foram todas em 28/10 entre 15:23 e 16:04 UTC; a migration `20261028141517_protected_opportunity_distribution` só foi aplicada às 16:08. O código subiu antes da migration. Lição de deploy: aplicar a migration antes do app, como o runbook de distribuição já diz. |
| **Universo para o dataset ouro: 9.728 conversas encerradas nos últimos 30 dias** (com ≥ 4 mensagens): 4.507 transferidas, 2.816 encerradas em menos de 60 s depois da última mensagem do cliente, 2.404 outras, 1 encerrada por agente de sistema. | Dá para montar o dataset ouro com conversas **humanas**. As 2.816 de encerramento rápido são candidatas a rotular (parte pode ser despedida legítima). |

**Consequência para o plano:** como não há tráfego de IA suficiente, a Fase 2 (modo sombra) e a Fase 3 (canário) só terão volume depois de alguém colocar a IA no atendimento real. Até lá, a precisão se mede por replay no dataset ouro.

**O que a Fase 0 já entregou no código:**
- `src/services/agent-studio/decision-record.ts` e o ponto de gravação em `process-chat.ts`: cada turno do Estúdio grava uma decisão no `agent_decision_ledger` (tipo, base, modo sugestão, `chatClosed` real, contadores; sem texto do cliente).
- `decision-ledger.ts` deixou de engolir erros de constraint (só silencia "tabela não existe"). Antes, uma violação de chave estrangeira com o nome da tabela na mensagem sumia sem log.
- `scripts/baseline-ia-decisions.cjs`: baseline somente leitura, reexecutável.
- `scripts/export-gold-candidates.ts` + `src/lib/privacy/mask-conversation-pii.ts`: amostra estratificada com mascaramento de dados pessoais. O modo padrão só conta; exportar exige `--export --confirm-sensitive`, grava em `.gold-dataset/` (ignorado pelo git).
- Testes: `studio-decision-record.spec.ts`, `mask-conversation-pii.spec.ts`.

### 1.2 Correção da transferência sem dono (05/11/2026, antecipada da Fase 1)

**Causa.** O nó `Transferir atendimento` dos fluxos (Nexus) chamava `transferChatAction` e, se a equipe estava sem ninguém online, cheia ou pausada, devolvia `HANDOFF_FAILED` com `retryable:false`. Quando a saída de erro do nó não estava ligada a nada, o executor encerrava a execução como `failed` (`executor.ts`, ramo `targets.length === 0`) e o cliente ficava onde estava, sem dono e sem mensagem. Foram as 146 falhas do baseline: todas terminaram `failed`. O caminho do Autopilot (`agent-tools/runtime.ts`, `runTransferChatTool`) já tinha fila; o dos fluxos não.

**O que mudou.**
- `queue-unavailable-team.ts`: move o chat para a fila da equipe (`status='gerais'`, sem agente, IA desligada) e grava a mensagem de sistema `transfer_queued` na mesma instrução SQL, de forma atômica. Idempotente por `operationId` (repetição não avisa o cliente duas vezes). Não toca em chat encerrado nem em equipe de outro workspace. Avisa o cliente com o mesmo texto do caminho do Autopilot (inclui o horário quando é fora do expediente).
- `queueable-reasons.ts`: motivos que entram na fila: `all_offline`, `not_accepting`, `portfolio_full`, `load_protected`, `outside_business_hours`. `no_members` **não** entra (equipe mal configurada, ninguém vai atender a fila).
- `node-handlers.ts` (`output.handoff`): ao falhar por um desses motivos, enfileira e sai pela saída `completed`, com `handoffQueued: true`, `queuedReason` e `queued` no resultado do nó para os blocos seguintes usarem.
- `chat-adapters.ts` / `nexus/services/runtime.ts`: dependência `queueHandoff` ligada.
- A falha continua `HANDOFF_FAILED`, agora com `details.reasonCode` e `details.teamId`, quando não dá para enfileirar (equipe sem membros, chat encerrado, resultado incerto, erro no próprio banco).

**Regra de convivência com os fluxos existentes.** Cada nó de transferência exige uma saída de erro no editor, e quem a ligou escolheu um fallback. Por isso o padrão é conservador:

| `onUnavailable` no nó | Comportamento |
|---|---|
| `auto` (padrão) | Enfileira **só quando a saída de erro não está ligada**, ou seja, onde hoje a execução morre. Se há rota de erro, ela continua mandando. |
| `queue` | Sempre enfileira, mesmo com rota de erro. |
| `error` | Nunca enfileira (comportamento antigo). |

`queueNotice: false` no nó enfileira sem avisar o cliente, para fluxos que já mandam a própria mensagem. Essas duas opções existem na configuração do nó, mas **ainda não têm campo no inspetor visual**.

**Fica de fora, de propósito.**
- Aviso de SLA e escalonamento para outra equipe quando a fila não é atendida (parte da seção 3.2). O baseline passa a medir `handoff_queued_events` e `handoff_queue_wait_for_first_human` (quantos nunca receberam resposta humana) para dimensionar isso com dado.
- Nenhum chat que já falhou foi tocado: as 146 execuções passadas continuam `failed`.
- O caminho do Estúdio/Autopilot não mudou: já enfileira pelo `runTransferChatTool`.

**Como verificar depois do deploy:** `node scripts/baseline-ia-decisions.cjs --days=7`: `handoff_failed_reasons` deve cair (restam só equipe sem membros e rotas com `onUnavailable: 'error'`) e `handoff_queued_events` deve aparecer.

## 2. Metas (SLOs de decisão), a calibrar na Fase 0

**Transferência**
- Recall de pedido explícito de humano: ≥ 99,5% (PT, EN, ES; texto e áudio transcrito).
- Transferências desnecessárias (humano julgou que a IA resolveria): ≤ 5% das transferências por motivo "incerteza", medido na amostra auditada.
- Entrega garantida: 100% das transferências terminam em atendente assumindo **ou** fila registrada com prazo e mensagem ao cliente. Zero conversa órfã.
- Tempo da decisão de transferir até a ação confirmada: p95 ≤ 5 s quando o cliente pede humano.
- Briefing entregue ao humano em 100% das transferências.

**Encerramento**
- Precisão: ≥ 99% dos encerramentos sem pendência real (pedido aberto, operação em voo, pergunta sem resposta).
- Reabertura em até 24 h por o cliente voltar com o mesmo assunto: ≤ 2%.
- Conversas zumbis (`waiting_input` além do prazo sem follow-up ou encerramento): 0.
- Zero encerramento por inatividade abaixo da janela mínima configurada. Os docs da Velpro mostram 178 encerramentos em ~6 s em agosto: esse erro não pode ser reproduzido pela IA.

**Autonomia**
- Taxa de resolução sem humano, por intenção, em escopo declarado. Meta inicial é só medir; a meta numérica sai do baseline.
- Zero afirmação comercial sem fonte ou resultado de ferramenta na amostra auditada.

## 3. Arquitetura: o modelo propõe, uma porta determinística decide

Princípio: o LLM entende a conversa e **propõe** `close` ou `handoff`. Um **Decision Gate** em código (sem LLM) confere pré-condições, executa e registra. Assim a precisão não depende só do prompt.

### 3.1 Ação `close` de primeira classe no núcleo v2
- Hoje o encerramento é consequência implícita de "todos os pedidos resolvidos". Torná-lo uma **decisão explícita**: adicionar `close` ao enum de ações e ao `reasoning-engine.ts`, com o mesmo padrão de operação idempotente do `handoff`, e passar a execução por `closeAuthorization`/`closeChatAction` em vez do `UPDATE` direto.
- **Pré-condições (Decision Gate):**
  - nenhuma operação `in_flight` ou `unknown`;
  - nenhum pedido ativo sem resultado;
  - nenhuma pergunta do agente aguardando resposta, salvo despedida confirmada;
  - base do encerramento registrada: `cliente_confirmou`, `resolucao_comprovada` (resultado de ferramenta) ou `inatividade_pos_followup`.
- Se alguma falhar, o gate recusa e devolve o motivo ao modelo como observação (padrão que o motor já usa).
- Execução via `closeChatAction`, com mensagem de despedida e nota interna com a base. Reabertura automática se o cliente voltar (o caminho `reopenClosedWhatsappChat` já existe em `actions/messages.ts`; confirmar o comportamento dentro da janela).

### 3.2 Transferência estruturada e garantida
- **Motivo em taxonomia fechada**, não texto livre: `cliente_pediu`, `fora_de_escopo`, `risco_sensivel`, `falha_de_ferramenta`, `incerteza_alta`, `limite_de_turnos`, `operacao_incerta`, `reclamacao_grave`. O texto livre vira complemento.
- **Briefing automático** como nota interna: pedido, dados coletados, o que a IA já tentou, o que falta, tom do cliente. O humano não pergunta de novo.
- **Garantia de dono:**
  - equipe online → transfere;
  - equipe offline ou fora do horário → fila com mensagem honesta de expectativa e timer de SLA;
  - sem retorno no SLA → escala para outra equipe ou gestor.
- Substituir `HANDOFF_FAILED retryable:false` por esta cadeia. Permitir nova tentativa segura quando o resultado for incerto, usando o `operationId` já idempotente, mas só depois de verificar o estado real do chat (dono e equipe atuais).
- Confirmar que o caminho de produção (`runtime.ts:401` e `runNative`) reproduz a fila do teste ao vivo.

### 3.3 Detecção de intenção de controle (pedir humano, encerrar, cancelar)
- Manter as regras atuais como **rede de segurança de baixa latência**, mas ampliar para frases parciais ("valeu, pode fechar").
- Adicionar um classificador leve com modelo pequeno, em paralelo, que devolve rótulo + confiança. Quando regra e classificador divergem, vale o mais conservador: pedido de humano → transfere; encerrar com dúvida → pergunta uma vez "posso encerrar?".
- Sem loop: após 1 esclarecimento, decide ou transfere com briefing.

### 3.4 Validador de promessas (afirmação × ação)
- Antes de enviar, comparar a resposta com o que foi executado no turno. Regras duras:
  - dizer "vou encerrar" ou "encaminhei" só sai se a ação correspondente foi confirmada;
  - afirmação comercial (preço, prazo, cobertura, pré-reserva, regra) só sai com fonte ou resultado de ferramenta no turno;
  - caso contrário, reescrever ou trocar por esclarecimento/transferência.
- Reaproveitar `assistant-validator.ts` e o `response-validator.ts` do Autopilot.

### 3.5 Vigilantes (watchdogs) para zumbis
- Job periódico para sessões `waiting_input` além de um prazo: 1 follow-up gentil → nova espera → encerramento por inatividade com mensagem, com base `inatividade_pos_followup`.
- Janela mínima configurável por workspace e **piso técnico** (nunca abaixo do mínimo). Reaproveitar `services/chat/auto-close.ts` e `marketing-auto-close.ts`.
- Alerta para transferência sem dono além do SLA e para `outcomeUnknown` sem revisão em 15 min (já descrito no runbook do rollout).

### 3.6 Confiança e abstenção
- O modelo devolve `confianca` e `evidencias` para `close` e `handoff`. Abaixo do limiar: 1 pergunta de esclarecimento e depois decisão. Nunca insistir em loop de oferta (problema visto em 12/09).

## 4. Medição: como saber que a precisão é real

Esta é a parte central. Hoje não temos esse dado.

1. **Ledger obrigatório.** Toda decisão `close`/`handoff`/`continue` grava: decisão, motivo, confiança, pré-condições avaliadas, ação executada, latência. Sem conteúdo pessoal. Corrigir o ledger vazio como primeira tarefa.
2. **Dataset ouro.** Rotular 500 a 1.000 conversas reais anonimizadas, turno a turno: continuar / transferir (motivo) / encerrar. Fonte inicial: as 1.135 conversas comerciais da Velpro de agosto e o suporte técnico. Dupla rotulagem com medida de concordância (kappa); divergências resolvidas por um terceiro.
3. **Replay offline.** Rodar o núcleo sobre o dataset com `verify-autopilot-readonly-replay`, sem efeitos externos. Sair com matriz de confusão por decisão e intervalo de confiança de 95%. Repetir a cada mudança de prompt, modelo ou regra (portão de CI).
4. **Casos adversariais** (suíte própria):
   - "obrigado, mas só mais uma dúvida";
   - "pode fechar" com pedido pendente;
   - cliente irritado/sarcástico;
   - vários pedidos na mesma mensagem;
   - áudio sem transcrição;
   - duas mensagens seguidas;
   - pedido de humano dentro de uma frase longa;
   - ironia ("claro, pode encerrar, né" = insatisfação).
5. **Modo sombra.** A IA decide e registra, mas quem age é o humano. Comparar com o que o humano fez por 1 a 2 semanas de tráfego real.
6. **Auditoria humana contínua.** Amostra de 5% das decisões da IA por semana + botão "decisão errada" para operadores, alimentando o dataset.
7. **Painel de decisões.** Precisão e recall por tipo, motivo das transferências, taxa de reabertura, zumbis, latência, custo por conversa resolvida.

## 5. Fases e critérios de saída (gates)

**Fase 0: Baseline (1 a 2 semanas).** Ligar o ledger, montar o dataset ouro, medir o núcleo atual e as taxas reais (transferência, encerramento, zumbis, reabertura).
*Saída:* baseline publicado; SLOs da seção 2 recalibrados.

**Fase 1: Fundação (2 a 3 semanas).** Ação `close` + Decision Gate; transferência estruturada com fila e briefing; validador de promessas; vigilantes; classificador de controle.
*Saída:* testes de contrato verdes; replay do dataset sem regressão frente ao baseline; adversariais passando.

**Fase 2: Sombra (2 semanas, em paralelo ao fim da 1).** Modo sombra no workspace piloto.
*Saída:* concordância IA × humano e precisão dentro de metas, com IC 95% estreito o bastante para decidir.

**Fase 3: Canário autônomo (2 a 4 semanas).** Uma equipe/agente do workspace piloto, com kill switch e circuit breaker (seção 6).
*Saída:* SLOs de encerramento e transferência atingidos por 2 semanas seguidas; zero conversa órfã; zero afirmação sem fonte na auditoria.

**Fase 4: Ampliação por intenção.** Liberar autonomia intenção por intenção, começando pelas de baixo risco e passando às que envolvem dinheiro e contrato. Cada intenção exige o próprio dataset e gate.

**Fase 5: Operação contínua.** Retreino/ajuste mensal com os erros auditados, relatório de precisão, revisão dos limiares.

## 6. Salvaguardas

- **Flag por agente e por workspace** (mesmo padrão de `LIA1_COMPACT_AGENT_IDS`), reversível sem migração.
- **Circuit breaker automático:** se reabertura, transferência anômala ou taxa de "decisão errada" passar do limite, o agente volta sozinho ao modo sugestão (copiloto) e alerta.
- **Reversibilidade:** encerramento reabre quando o cliente volta; transferência preserva todo o contexto.
- **Dados:** logs e ledger sem valores coletados do cliente, como já exige o runbook.
- **Operação incerta nunca é repetida** sem verificar o estado real (regra existente, mantida).

## 7. Riscos e limites

- **Latência.** A média observada foi 12,7 s (p95 23 s). A detecção de pedido de humano e de despedida precisa de um caminho rápido (regras + classificador pequeno), sem passar pelo ciclo completo do modelo.
- **Custo.** ~14 mil tokens por turno nas sessões vistas. O classificador leve e o contexto compacto (LIA-1) entram para a conta fechar nos planos.
- **Modelo/provedor.** O núcleo v2 hoje não suporta Gemini nem LM Studio; avaliar dependência de um único provedor (DeepSeek nas publicações vistas).
- **Dataset enviesado.** Conversas da Velpro refletem um tipo de negócio. Cada novo vertical precisa do seu conjunto.
- **Rotulagem humana também erra.** Por isso a dupla rotulagem e a medida de concordância.
- O que **não** dá para prometer: ausência total de erro. Dá para prometer erro medido, raro, detectável e reversível.

## 8. Decisões que dependem de você

1. Qual custo é pior para o negócio: **encerrar cedo demais** ou **transferir sem necessidade**? Isso define o viés dos limiares.
2. Horário e SLA de atendimento humano por equipe (a fila só funciona com prazo real).
3. Workspace e agente piloto (sugestão: Velpro, por ter volume e histórico para o dataset).
4. Quem rotula o dataset ouro (equipe interna ou o cliente piloto).
5. Posso encerrar por inatividade? Qual janela mínima e qual mensagem de follow-up.

## 9. Backlog técnico inicial

1. Ligar o `agent_decision_ledger` para toda decisão de `close`/`handoff`/`continue`.
2. `reasoning-contract.ts`: adicionar `close`, taxonomia de motivos e campo `confianca`.
3. `reasoning-engine.ts`: ramo `close` com Decision Gate; permitir nova tentativa segura de `handoff` após checar o estado real.
4. `runtime.ts` / `runNative`: fila + mensagem + SLA quando a equipe está indisponível; briefing como nota interna.
5. `workflow-runtime/node-handlers.ts:1299`: trocar `HANDOFF_FAILED` terminal pela cadeia fila → escalonamento.
6. `conversation-governor.ts`: frases parciais de despedida; classificador leve em paralelo.
7. Validador de promessas (afirmação × ação) antes do envio.
8. Job de zumbis (follow-up e encerramento por inatividade, com piso de janela).
9. Dataset ouro + `replay` + suíte adversarial + portão no CI.
10. Painel de decisões e alertas.
