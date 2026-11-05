# Auditoria operacional Dialogy — 06/09/2026

Consolidado das 10h, iniciado às 10h12 (America/Sao_Paulo). Janela fixa: 05/09/2026 10:12:57 a 06/09/2026 10:12:57. Consultas realizadas após o fechamento da janela; status refletem o momento da leitura, não um snapshot histórico exato. Não havia uma coleta separada das 08h disponível neste contexto para consolidar; foi feita uma nova coleta de 24 horas.

## Resultado

Entregabilidade não equivale a resolução: 10/10 mensagens rastreáveis do Autopilot tiveram READ/DELIVERED, mas as duas conversas examinadas terminaram com pendência. Um defeito de renderização após resposta desconhecida foi reproduzido e corrigido somente no código local. Uma resposta foi publicada no suporte; nenhum ticket foi encerrado.

## Fontes e limitações

Consultas PostgreSQL em transações somente leitura, com timeout, usando a conexão existente do projeto. Fontes: support_tickets, support_messages, users (apenas verificação de autoria/autorização), chats, messages, agent_studio_sessions, autopilot_config_versions, agent_studio_live_tests, agent_decision_ledger, workflow_executions, workflow_node_runs, workflow_events e evolution_webhook_events.

O MCP Supabase não está exposto entre as ferramentas desta sessão; a conexão direta ao banco funcionou. Não foram consultados logs dos workers de produção nem identificado o commit/imagem efetivamente implantado. A versão publicada do Studio foi correlacionada com cada sessão, mas não prova deploy do código. Não foi verificada uma fonte independente evolution_webhook_process. Uma consulta ampla de correlação foi interrompida pelo timeout e substituída por consultas menores; não foi aumentada a carga para contornar o limite.

As duas conversas têm entrada Evolution conectada e mensagens entregues persistidas; não são apenas preview. Nenhuma aparece em agent_studio_live_tests, e essa tabela tem zero registros atualizados na janela. Isso não exclui testes manuais feitos pelo proprietário no canal real. Resultados de mocks e testes locais estão separados abaixo. Não se infere ausência de falhas em outros canais/modelos a partir deste recorte.

## Indicadores

| Medida | Resultado | Definição / ressalva |
| --- | --- | --- |
| Respostas rastreáveis da IA | 10 mensagens / 2 chats | metadata.autopilotSourceMessageId, from_me; exclui notas internas |
| Entrega dessas respostas | 10/10 READ ou DELIVERED; 0/10 FAILED | Persistência do provedor; não mede correção da resposta |
| Sessões Studio | 2 | Uma transferred e uma waiting_input |
| Procedimentos concluídos | 1/2 selecionados | Catálogo concluído; não significa contratação nem resolução de todo atendimento |
| Latência até persistência da primeira resposta | 9 pares; média 7,80 s; p95 10,06 s | Source message e primeiro bloco, mesmo workspace/chat; não é latência de leitura pelo cliente |
| Workflows iniciados na janela | 343 | 251 completed, 15 failed, 56 cancelled, 21 waiting; inclui automação determinística, não só IA |
| Webhooks Evolution | 16.885/16.885 processed | Não equivale a 16.885 atendimentos |
| Ledger | 25 decisões | 3 answer, 9 ask_slot, 10 call_tool, 3 continue_llm; zero latency_ms preenchido, sem inferir cobertura total |
| Tickets | 7 no total; 2 ativos | Um open, um in_progress; 5 já fechados, sem reabertura nesta execução |

Os 21 workflows em espera têm waiting_reason=time. Isso sozinho não confirma travamento; prazo esperado e agenda dos workers continuam por validar. Eventos de conclusão na janela somam 252, enquanto a coorte de execuções iniciadas nela tem 251 concluídas: são denominadores distintos. Cancelamento também não foi tratado como abandono do cliente. Não há base homogênea para tendência diária: a leitura de 05/09 usou outra janela e seleção por atualização.

## Ocorrências correlacionadas

### A — Campo desconhecido quebra o resumo (bug reproduzido)

Sessão técnica 57067197-4a94-4ce3-a36b-2ec32fd43778, release de suporte v2 publicada em 05/09 às 12:03:43 locais. Às 15:31:56 o evento field_unavailable registra que o cliente não sabe quando começou. Às 15:31:57 a consulta de conhecimento conclui, mas o passo de resposta falha. O passo publicado referencia quatro campos coletados em messageDataKeys; o renderizador rejeitava qualquer valor ausente, inclusive um campo explicitamente declarado desconhecido. O motivo persistido da ferramenta foi “Falta um resultado necessário para responder.” Um teste local reproduziu essa falha antes da correção.

A sessão ficou transferred, porém o resultado efetivo da ferramenta diz transferred=false, outside_business_hours, fallbackExecuted=true e notificationDelivered=true. Não contabilizar isso como transferência humana concluída. Esse desacordo entre resumo de sessão e resultado operacional permanece como pendência independente; não foi alterado nesta rodada. Mensagens posteriores também reiniciam a apresentação do fluxo, o que merece correlação adicional do roteamento antes de atribuir causa.

Correção mínima em src/services/agent-studio/engine.ts: a mensagem pode apresentar “Nome do campo: não informado” apenas para campos do procedimento atual ou coleta inicial com registro correspondente em unavailableFields. O marcador não é gravado como valor, não é enviado ao CRM e não libera integrações sem entradas necessárias. Resultados de ferramenta ausentes continuam bloqueados.

### B — Intenção com dado desconhecido fica sem interpretação (causa interna pendente)

Sessão ae5f24ca-0c93-471c-b781-fdac4af36e59, Raquel v21 publicada em 05/09 às 09:51:53 locais. O catálogo foi apresentado e seu procedimento concluído às 17:05:46. Depois de uma dúvida sobre um plano, o cliente aceitou verificar disponibilidade e explicou que não sabia o CEP. Às 17:06:28 foi persistido turn_unavailable; às 17:06:30 a resposta pediu que tentasse novamente. Não houve nova mensagem do cliente no histórico consultado após isso.

É uma falha de continuidade observada, não prova de abandono nem de defeito específico do provedor. Sem logs do interpretador não é possível distinguir timeout, saída inválida, erro de modelo ou outra causa. Não foram adicionados sinônimos nem modificado o fluxo por suposição.

### C — Falhas de automação conectada

15/343 execuções iniciadas falharam, todas vinculadas a chats do mesmo workspace: 10 HANDOFF_FAILED por equipe sem agente online (8 Comercial, 2 Suporte); 3 SGP_ACTION_FAILED por cliente não encontrado; 1 SGP_CONTRACT_NOT_FOUND; 1 SGP_INVOICE_NOT_FOUND. Ausência de cliente/contrato/fatura pode ser resultado operacional esperado, não bug confirmado. As 10 falhas de encaminhamento exigem validar o comportamento de fila/fallback e a disponibilidade configurada. Não foi feita transferência manual nem replay.

## Tickets e ações

- 60e6df5c-af2d-4a14-8781-c9f8aa1f78a3 — “Classificação dos clientes”: melhoria de fluxo de trabalho; possível problema funcional de navegação ainda sem reprodução. Não é duplicado do ticket abaixo: aqui o cliente chega à fila e a reclamação é a aba do operador acompanhá-lo. Resposta identificada como assistência automatizada publicada via mecanismo de banco já autorizado em 06/09/2026 10:14:56.511 locais (13:14:56.511Z), sob a conta de suporte existente com is_superadmin verificado. ID da resposta f6da3206-a37a-4dee-83ff-378740f38493. Perguntados dispositivo, classificação, aba de destino e horário aproximado, sem dados pessoais. Releitura confirmou persistência; não há confirmação de leitura/notificação externa. Ticket permanece open, aguardando contexto para reprodução. Sugestão de classificação em menos cliques registrada na própria resposta, sem alteração visual.
- 39b4739f-e941-4e48-81a9-ce85bdaaf901 — regressão de encaminhamento por classificação: permanece in_progress. A última resposta em 04/09/2026 12:07:03.487 locais informa correção preparada aguardando publicação e validação. Não houve prova atual de deploy/E2E; não foi publicada resposta repetitiva nem encerrado o ticket. Aguarda ação interna, não retorno do usuário.

Total: 1 ticket respondido, timestamp atualizado; 0 mudanças de status, 0 encerramentos, 0 avisos de inatividade. Nenhum elegível para inatividade. No ticket novo o prazo só começou agora; no antigo a equipe ainda deve publicação/validação, portanto o relógio de encerramento por silêncio do usuário não se aplica. Não foi comprovada política específica de SLA de suporte; antes de qualquer encerramento futuro devem valer a política verificável ou o padrão 48h de aviso/72h, além da entrega do aviso e de não haver pendência interna.

## Validação local e pendências

- Reprodução antes do patch: 1 falha / 26 testes no arquivo adaptativo; reproduziu encaminhamento indevido em lugar do resumo com campo desconhecido.
- Após patch: 127/127 testes em agent-studio-adaptive-turn, agent-studio-engine, agent-studio-runtime e agent-studio-workflow.
- npx tsc --noEmit --incremental false: aprovado. git diff --check nos arquivos relacionados: aprovado, com aviso de normalização CRLF.
- npm run worker:ai:build: não validado; esbuild falhou com Acesso negado ao ler diretório ancestral no ambiente restrito. Não se atribui esse erro ao código nem se contorna a restrição.
- Testes usam dependências injetadas; não são homologação com modelo/provedor real. Não houve deploy, publicação, migração, mudança de configuração, edição de CRM, envio fora do ticket ou alteração visual. A única escrita operacional foi a resposta autorizada no ticket e seu updated_at.
- A correção local precisa de build no ambiente autorizado e E2E pós-deploy: responder que não sabe um campo, concluir os seguintes, conferir resumo, eventos persistidos e mensagem recebida sem encaminhamento por ausência daquele campo. Também testar resultado de ferramenta ausente, que deve continuar bloqueado.

## Prioridades

1. Campo desconhecido no resumo: alto impacto, baixo esforço, risco controlado. Patch local pronto; validar build e teste real acima antes de considerar resolvido.
2. Handoff e fallback fora do expediente: alto impacto, esforço/risco médios. Exigir teste real em que status da sessão, fila persistida, resultado transferred e mensagem ao cliente concordem; não prometer encaminhamento concluído se só houve fallback.
3. Falha do interpretador em mensagem com intenção + dado desconhecido: alto impacto, esforço médio. Correlacionar logs com turn_unavailable e versão/modelo efetivos; testar combinações de confirmação, dúvida e informação ausente em nichos distintos, sem cancelar objetivo nem obrigar repetição.
4. Classificação em lote: aguardar resposta e reprodução funcional. Esforço/risco a estimar; testar interação de classificação, mudança persistida de fila e permanência da aba antes de propor alteração de interface.

O critério de correção vem de registros e reprodução, conforme as skills Supabase/Postgres; presença de código, aparência e testes isolados não foram tratados como prova de resolução em produção.
