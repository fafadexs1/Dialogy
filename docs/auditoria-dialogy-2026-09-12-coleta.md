# Coleta operacional — 12/09/2026, 08h

Janela: 11/09 08:00:55.099 até 12/09 08:00:55.099, America/Sao_Paulo; intervalo fechado no início e aberto no fim. Primeira leitura consistente em 12/09 08:02:34.689. Complemento de mensagens e sessões às 08:02:59; aviso no suporte às 08:04:18.571. Preparação para o consolidado das 10h, sem alerta crítico imediato identificado neste recorte.

## Fontes e limites

PostgreSQL conectado do projeto, transações REPEATABLE READ READ ONLY com timeout de 8s: support_tickets, support_messages, messages, agent_studio_sessions, agent_studio_live_tests, workflow_executions, workflow_node_runs, workflow_events, evolution_webhook_events, agent_decision_ledger e autopilot_config_versions. users consultada apenas para revalidar autoria de suporte/superadmin. MCP Supabase não exposto entre as ferramentas; conexão direta existente funcionou.

Não verificados: logs/imagem/commit dos workers implantados, fila independente evolution_webhook_process, transcrição de áudio, fontes comerciais efetivamente recuperadas em cada resposta, entregas de notificações externas do suporte. Banco prova tráfego operacional, não descarta testes manuais do proprietário no WhatsApp. Sem teste sintético, chamada manual de transferência ou alteração de atendimento nesta coleta.

Skills Supabase/Postgres orientaram consultas delimitadas e verificação de autoria; Data/KPI reporting orientou denominadores e separação entre entrega, estado operacional e resolução. Formato textual/silencioso mantido conforme instrução específica desta automação; não foi criado dashboard nem publicação externa.

Consulta reproduzível: `node scripts/audit-dialogy-window-readonly.cjs 2026-09-12T11:00:55.099Z`; complemento com `--detail`. Não publicar saída bruta: mensagens podem conter dados pessoais. Snapshot de recuperação cifrado excluído da projeção de sessões.

## Indicadores

| Medida | Coleta | Ressalva |
| --- | --- | --- |
| Respostas Autopilot rastreáveis | 32 em 3 chats | metadata.autopilotSourceMessageId + from_me, dentro da janela |
| Entrega | 32/32 READ | Não mede resolução nem exatidão |
| Entrada correlacionada | 32 webhooks processed correspondentes às mensagens de origem | Correlação de ID do provedor e workspace |
| Exclusão de testes Studio | 0/3 chats registrados em live_tests; 0 testes atualizados na janela | Testes manuais no canal real não excluídos |
| Latência até persistência da primeira resposta | 32 pares; média 12,71s; p95 23,25s | Mesmo chat/workspace; não é tempo até leitura |
| Sessões atualizadas | 3: 2 waiting_input, 1 transferred | Nenhuma resolved; isso não prova 0 resoluções humanas |
| Workflows iniciados | 327: 228 completed, 5 failed, 68 cancelled, 26 waiting/time | Inclui automação não-IA; cancelamento não equivale a abandono |
| Webhooks totais | 13.415/13.415 processed | Não são atendimentos únicos |
| Ledger | 0 registros | Não implica ausência de decisões; eventos Studio presentes |
| Suporte ativo | 2 tickets | 1 open, 1 in_progress |

Não há base para taxa de abandono ou de resolução ponta a ponta: há encerramentos humanos e sessões waiting_input persistidas. Esperas por tempo não classificadas como travadas sem prazo/worker. Sem comparação causal com 07/09: janela, composição e publicação diferentes; consolidado pode apresentar valores históricos apenas com essas ressalvas.

## Ocorrências técnicas anonimizadas

### A — Coleta legada ainda repete informação e falha com data por extenso

Chat técnico 9fce047c-6d7c-48f8-86f0-32fedde52bb8; sessão 24dd11f6-dccc-4ab3-9f2f-b3f93be48c36. Publicação v24 criada em 11/09 11:48:41.573, release 2e6fc8ab-a2ad-434f-ac15-249c3dc260f5, modelo deepseek/deepseek-flash.

- Às 11:56:12, cliente escolhe 600 MEGA e pergunta pelos canais. Às 11:57:24, após aceitar continuar, recebe novamente a pergunta de plano; repete 600 às 11:57:36. Evento conversation_fact_recovered só aparece depois disso, às 11:57:41.
- Às 11:58:00 e 11:58:22, desconhecimento de CEP/endereço é respeitado: field_unavailable e avanço para próximo campo, sem obrigar resposta. Evidência positiva no canal real.
- Às 11:58:41, data de nascimento válida expressa por extenso é seguida por collection_plan_unavailable; às 11:59:18, a IA pergunta a data novamente. Conteúdo pessoal omitido deste registro.
- Três respostas anteriores repetem o fallback “Seu pedido foi mantido” após perguntas sobre detalhes do pedido; eventos unclear/turn_paused correlacionados.

Comportamento inadequado confirmado pelas mensagens/eventos, mas causa interna específica não fechada: faltam saída do modelo, erro do validador e build implantado. Não atribuir esses eventos ao núcleo reasoning-v2, pois esta sessão usa eventos legados.

### B — Núcleo novo está em tráfego conectado, mas mantém insistência comercial

Sessões 23a14c55-3765-461a-b69e-5e978ea0307a e 08024a2c-380a-4640-9532-3891b71493f1: publicação v28 criada em 11/09 12:33:38.513, release 6b6e1bc1-2ca6-446b-a5ae-63be7d3ac2ae, modelo deepseek/deepseek-flash. Eventos reasoning_waiting_input provam execução do caminho novo, não identidade completa do código implantado.

No chat 01b0b546-da43-4146-ab08-98589030d96a, cliente explica restrição de orçamento reiteradamente. IA repete preço/benefícios e convite para cadastro em sucessivas respostas, mesmo após objeção explícita. Há alegações de alcance Wi-Fi, regras de compartilhamento e pré-reserva sem resultado de ferramenta comprovado nesta coleta. Classificação: problemas de condução e alegações a validar contra regras/fontes publicadas, não prova automática de informação falsa.

Às 16:08:05, IA informa não ter recebido conteúdo do áudio e solicita texto. Falha da transcrição não confirmada sem pipeline de mídia. Às 16:33:07, responde que encerrará após pedido explícito, mas a sessão permanece waiting_input. Não concluir fechamento operacional a partir da mensagem.

Telemetria das duas sessões inteiras, ambas iniciadas dentro da janela: 182.574 tokens em 12 turnos e 81.271 em 7, respectivamente (263.845 tokens / 19 turnos registrados). Não dividir pelos 32 blocos enviados nem converter em custo monetário sem tabela/preenchimento de cobrança. Uma das sessões tem 12 turnos e 11 respostas rastreáveis; há mensagens consecutivas do cliente. Necessita conciliar agrupamento e consumo por turno antes de tirar conclusão sobre desperdício.

### C — Transferência automática com evidência persistida

Chat ed2fc81c-d6ef-441a-ad17-8378fcb46c60: pedido humano às 15:53:30; ferramenta Transferir atendimento registrada às 15:53:37.354; nota de reassunção Comercial às 15:53:37.434; sucesso da ferramenta às 15:53:37.508 e evento transferred às 15:53:37.530. Resposta ao cliente READ às 15:53:39.253. Mensagem humana às 15:57:32 e encerramento humano às 16:12:10. Evidência de um encaminhamento automático seguido de participação humana, sem intervenção desta auditoria. Não equivale a contratação resolvida.

### D — Falhas de automação

5/327 execuções falharam: três HANDOFF_FAILED por ausência de agente online (Comercial 1, Financeiro 2), uma SGP_ACTION_FAILED por cliente não encontrado e uma SGP_CONTRACT_NOT_FOUND. Cinco node.failed e cinco execution.failed corroboram as falhas. Ausência cadastral ou de atendente não classificada automaticamente como bug. Disponibilidade da equipe no instante de cada consulta/transferência e alternativas publicadas ainda precisam ser comparadas.

## Triagem e ação no suporte

1. **60e6df5c-af2d-4a14-8781-c9f8aa1f78a3 — possível bug aguardando evidência + melhoria.** Última solicitação de contexto em 06/09 10:14:56.511; nenhuma resposta ou aviso anterior encontrado no histórico completo revalidado antes da escrita. Emitido um único aviso cordial por inatividade em **12/09 08:04:18.571**, mensagem **e10640d4-bd51-479e-8ee1-9274b6920c1f**, usando a autoria de assistência anterior e revalidando is_superadmin. Inserção + atualização do ticket atômicas, com verificação posterior da mensagem persistida e status open. Não encerrado: aviso atrasado não elimina prazo anunciado de 24h. Próxima elegibilidade de revisão não antes de **13/09 08:04:18.571**, condicionada a nova leitura, ausência de resposta, ausência de pendência interna e comprovação de disponibilização do aviso. Publicação no ticket verificada; email/push/leitura pelo destinatário não verificados.
2. **39b4739f-e941-4e48-81a9-ce85bdaaf901 — bug previamente confirmado, aguardando equipe/publicação/verificação.** Última resposta da equipe em 04/09 12:07:03.487 informa correção local. Não comprovado deploy/E2E nesta coleta; permanece in_progress. Não elegível a inatividade, mesmo com idade superior a 72h.

Não há duplicidade comprovada entre ambos: um descreve mudança da aba do operador e outro ausência de encaminhamento da conversa. Não encontrados tickets novos/atualizados na janela antes do aviso. Regra específica de SLA de suporte não localizada na busca do código; usado padrão da automação. **Ações: 1 resposta/aviso, 0 mudanças de status, 0 encerramentos (0 por inatividade).**

## Alterações e próximos passos para 10h

Criados somente scripts operacionais da coleta/aviso e este registro. Script de aviso recusa execução se histórico/status/autoria mudarem e não pode ser repetido após inserção. Sem correção funcional de produto, deploy, migração, publicação de agente, CRM ou mensagens fora de ticket. Consultas reais e leitura pós-escrita verificaram as ações; não executados testes/build de aplicação por não haver patch funcional.

Prioridades para revisão:

1. **Continuidade e fatos com origem (impacto alto; esforço médio; risco médio):** reproduzir escolha junto de dúvida e data por extenso com a publicação exata; comprovar que coleta não repete plano/data e grava fatos corretos. Comparar núcleo antigo/novo separadamente. Não aplicar correção por hipótese.
2. **Afirmações comerciais e encerramento (impacto alto; esforço médio; risco alto se liberar operações):** confrontar respostas com capacidades/fontes publicadas; teste que não promete pré-reserva sem resultado e que pedido de encerrar chega ao estado operacional correspondente.
3. **Custo/concisão (impacto alto; esforço médio; risco médio):** medir tokens, decisões, latência e resolução por pedido na mesma bateria de casos, não só reduzir prompt arbitrariamente. Validar objeções sem repetir oferta em loop.
4. **Transferências indisponíveis (impacto médio; esforço baixo/médio; risco médio):** correlacionar consulta de disponibilidade e transferência no mesmo execution_id; testar alternativa quando equipe offline e posterior retomada sem duplicação.

Às 10h: atualizar novas mensagens/tickets e estados, manter aviso sem duplicação, não fechar ticket antes do prazo, incluir este recorte no consolidado. Falta de deploy/logs continua limitação explícita, não pedido de autorização implícito.
