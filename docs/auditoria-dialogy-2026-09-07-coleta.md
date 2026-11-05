# Coleta operacional de 07/09/2026

Varredura das 08h executada pelo disparo recebido às 09h34min52s (America/Sao_Paulo). Janela fixa: 06/09 09h34min52s a 07/09 09h34min52s. Leituras entre 09h35 e 09h37. Esta é a coleta preparatória, não o consolidado das 10h.

## Evidências

Conexão PostgreSQL existente, transações READ ONLY, timeout de oito segundos por consulta e rollback; consultas reproduzíveis em `scripts/audit-dialogy-20260907-readonly.cjs`. Skills Supabase e Supabase Postgres Best Practices aplicadas ao escopo e à leitura. Não houve chamadas de modelo, testes sintéticos, alterações comerciais ou deploy nesta execução.

Fontes: messages, support_tickets, support_messages, agent_studio_sessions, agent_studio_live_tests, autopilot_config_versions, evolution_webhook_events, workflow_executions, workflow_node_runs, workflow_events e agent_decision_ledger. MCP Supabase não exposto nas ferramentas desta execução; banco direto acessível. Logs dos workers, imagem/commit implantado, fila evolution_webhook_process independente e confirmação de notificações de suporte não verificados.

## Indicadores

- 19 respostas com metadata.autopilotSourceMessageId, em dois chats; 19/19 READ. Entrega não equivale a resolução.
- 19 pares origem/resposta no mesmo chat/workspace: média 8,65 s e p95 11,54 s até persistência da primeira resposta. Não mede tempo até leitura.
- Três sessões Studio atualizadas: uma resolved e duas waiting_input; ambas as conversas têm efeitos conectados. Não chamar as esperas de abandono.
- 21 webhooks processed correlacionados por workspace e ID externo às entradas dos dois chats. Zero correspondências desses chats em agent_studio_live_tests; não exclui teste manual do proprietário pelo WhatsApp real.
- 139 workflows iniciados: 114 completed, nove failed, 11 cancelled, cinco waiting/time. Não são 139 atendimentos de IA. Espera por tempo não comprova travamento.
- Nove falhas correlacionadas com nove node.failed e nove execution.failed: oito output.handoff com HANDOFF_FAILED (quatro Financeiro, quatro Suporte, equipe sem agente online); uma dialogy.sgp_second_copy com SGP_ACTION_FAILED (cliente não encontrado). Ausência de cliente não comprova bug.
- 5.962/5.962 webhooks da janela processed. Zero decisões no ledger nessa janela; não significa ausência de decisões, pois há eventos Studio persistidos.

O relatório anterior tinha 10 respostas em dois chats e média 7,80 s, mas sua janela encerrava às 10h12 e esta às 09h34. Não calcular tendência/acurácia a partir de amostras tão pequenas e janelas diferentes.

## Ocorrências para revisão às 10h

Sessão técnica 519b7c1e-1eef-4c6d-8a35-be11f34dd439, release 056a4d09-bbed-4615-85e2-754c7e27d6e4, Raquel v21 (publicada em 05/09 às 09h51min53s locais, DeepSeek v4 Flash). Eventos e mensagens em 06/09, horários locais:

1. 22h54min56s: cliente pergunta se um plano inclui somente internet. O turno é classificado como answer, o procedimento de catálogo é selecionado pela segunda vez e o antirrepetição responde às 22h55min03s que vai parar de repetir. O usuário precisa reafirmar a dúvida às 23h02min36s; só então recebe resposta. Cadeia observada: classificação/roteamento inadequados → repetição de catálogo → bloqueio antirrepetição. Não é falha de entrega.
2. 23h40min50s: após uma comparação, cliente aceita uma opção; inicia-se recomendação de plano, seguida de collection_plan_unavailable. Às 23h41min23s o cliente explicita que quer assinar, mas permanece na qualificação da recomendação. Preferência exata inicialmente ambígua; a permanência após intenção explícita merece reprodução com publicação e logs.
3. 23h42min01s: à pergunta de interesse em TV, cliente responde “não”. Às 23h42min05s o evento registra field_unavailable, em vez de uma preferência negativa. Às 23h42min15s responde “quero” à pergunta seguinte sobre Wi-Fi 6; às 23h42min20s ocorre outro collection_plan_unavailable, com pedido genérico de esclarecimento entregue às 23h42min22s. Há defeito de semântica observado; saída bruta do modelo/causa exata da rejeição não está disponível. Não corrigir apenas por hipótese com sinônimos ou concluir que o cliente não soube responder.

Eventos adaptive_answered e collection_planned confirmam que algum runtime adaptativo já executou no ambiente conectado durante esta janela. Isso atualiza a observação anterior de trabalho apenas local, mas NÃO identifica qual commit/build foi implantado nem comprova publicação de todas as correções. Não alegar que o deploy foi feito por esta auditoria.

Prioridades para revisão: (P1) reproduzir respostas negativas e afirmativas curtas em campos booleanos com a release exata e saída validada do modelo; (P1) testar pergunta sobre opção seguida de contratação explícita, sem reiniciar recomendação; (P1) verificar fila/fallback de handoff sem agentes online, com resultado, status e mensagem concordantes; (P2) recuperar observabilidade do ledger sem confundir zero registros com zero atividade. Esforço/risco: médios, exigem correlação do deploy antes de qualquer patch.

## Tickets

- 60e6df5c-af2d-4a14-8781-c9f8aa1f78a3, aberto: sem resposta nova após a solicitação de contexto enviada em 06/09 às 10h14min56s locais. Aproximadamente 23h20 de silêncio no fechamento da janela; abaixo de 48h. Mantido como melhoria e possível bug funcional aguardando reprodução. Não repetir a pergunta agora. Sob política padrão, aviso não antes de 08/09 10h14min56s; encerramento não antes de 09/09 10h14min56s, condicionado à entrega do aviso, ausência de resposta e nenhuma pendência interna.
- 39b4739f-e941-4e48-81a9-ce85bdaaf901, em andamento: última resposta em 04/09 12h07min03s diz que a correção aguarda publicação e verificação. A equipe ainda deve ação; NÃO usar inatividade do usuário, mesmo próximo de 72h. Não há prova pós-deploy específica para encerramento.

Sem tickets novos/reabertos encontrados no recorte. Zero respostas novas, zero mudanças de status, zero encerramentos e zero avisos. Não foi localizada política específica verificável de inatividade de suporte nas buscas do código; os prazos padrão acima são condicionais. Não foi confirmado mecanismo de entrega de aviso, portanto nenhum fechamento fica autorizado só pelo relógio.

## Ações e limites

Criados apenas script de leitura e esta coleta local. Nenhum patch funcional, teste/build, mudança de banco, replay, transferência manual ou mensagem fora de ticket. Nenhum ticket estava elegível para nova resposta útil ou encerramento nesta rodada. Os novos problemas foram registrados para o consolidado; não foi identificado incidente crítico de disponibilidade, perda de dados ou efeito destrutivo que exija interromper o silêncio da coleta das 08h.
