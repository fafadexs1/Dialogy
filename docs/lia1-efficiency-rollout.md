# LIA-1: recuperação e eficiência

O runtime mantém o modelo global atual. O painel **Resultados do Estúdio** mostra quando ele difere do modelo salvo na publicação; a seleção por agente não muda nesta entrega. `consult` não é anunciado enquanto repetiria o mesmo modelo.

## Ativação

`LIA1_COMPACT_AGENT_IDS` é uma lista de IDs de agentes separada por vírgulas. Sem a variável, o contexto legado continua em uso. Configure o mesmo valor no aplicativo e no worker de IA para manter teste e atendimento equivalentes. Inclua inicialmente um agente, compare os resultados e amplie; `*` ativa todos. Retirar o ID reverte a compactação sem migração ou alteração da publicação.

A classificação de falhas, a resposta contextual no limite, o vínculo do consumo ao chat e a eliminação da leitura duplicada de memória não dependem dessa chave. Leituras com resultado desconhecido podem ser repetidas com segurança; alterações de resultado desconhecido continuam bloqueadas até comprovação ou revisão humana.

## Validação

- `npm run eval:lia1:context` lê estados históricos e publicações, substitui o texto das mensagens por texto neutro e executa duas decisões controladas em memória. Não chama provedor, ferramenta comercial, transferência ou escrita no banco. Imprime apenas contagens agregadas e tamanho dos contextos; caracteres são uma aproximação, não tokens faturados.
- Compare casos anonimizados com o modelo real e ferramentas externas controladas antes de ativar o primeiro agente. Verifique pedidos paralelos, correções, falha de leitura, resposta de negócio negativa, operação incerta e pedido explícito de pessoa. Não use o benchmark de contexto como prova de resolução.
- No canário, filtre `autopilot_usage_logs` por `flow_name='studioReasoningV2'`, `chat_id IS NOT NULL` e `metadata.sessionId`. Compare `metadata.contextMode` (`legacy`/`compact`) e a soma de `input_tokens` por sessão, vinculando `metadata.sessionId` a `agent_studio_sessions.id`. Use `summary.lastTurnMetrics.resolvedRequests` como denominador agregado, e acompanhe transferências, operações incertas e duração do último turno. Exclua sessões sem resolução da métrica de custo por pedido resolvido, mas conte-as no indicador de resolução.

Meta do canário: pelo menos 30% menos tokens de entrada por pedido resolvido, sem regressão de resolução, segurança ou latência p95. Se falhar, retire o agente da variável e investigue os turnos correlacionados antes de ampliar.

## Evidência local de 23/09/2026

O replay controlado de seis estados históricos reduziu o tamanho somado dos contextos completos de 373.764 para 234.830 caracteres (37,17%). Treze outros estados foram excluídos por publicação indisponível ou estado não reproduzível. Essa medida não inclui o prompt de sistema, a transcrição do provedor nem tokens faturados.

Nos testes com o modelo real e conversas sintéticas, os cenários de pedidos mistos e elegibilidade comercial passaram sem executar operações externas. O cenário misto variou: 24.691 tokens de entrada em cinco decisões no perfil anterior; 20.822 em cinco decisões e 25.809 em seis decisões em duas execuções do perfil compacto. Essa variação mostra que o ganho em produção e a meta de 30% ainda precisam da comparação pareada ampliada e do canário. Os arquivos de evidência estão em `artifacts/lia1-eval/2026-09-23/` e contêm apenas cenários sintéticos.
