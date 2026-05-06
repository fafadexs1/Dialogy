# Plano de execucao: Atendente IA nivel Dify

## Objetivo

Transformar o Atendente Inteligente da Dialogy em uma camada profissional de atendimento com IA: confiavel, auditavel, testavel, extensivel por ferramentas, resistente a falhas do modelo e capaz de operar conversas reais sem parecer improvisado.

O alvo nao e apenas "o Gemini responder melhor". O alvo e um sistema de atendimento com IA orientado por workflow:

1. Entende a intencao do cliente.
2. Busca conhecimento de forma confiavel.
3. Decide se precisa perguntar algo, consultar ferramenta, responder ou transferir.
4. Executa ferramentas com validacao e rastreabilidade.
5. Gera resposta curta, correta e adequada ao canal.
6. Valida a resposta antes de enviar.
7. Aprende com avaliacoes, logs e casos encerrados.

## Diagnostico atual

O projeto ja possui bases importantes:

- `src/services/autopilot-service.ts`: fluxo principal do autoatendimento.
- `src/ai/flows/auto-responder.ts`: prompt e chamada LLM principal.
- `src/services/rag/retrieval.ts`: recuperacao vetorial de documentos e memoria de casos.
- `src/services/rag/document-ingestion.ts`: ingestao de documentos na base vetorial.
- `src/services/agent-tools/runtime.ts`: runtime de ferramentas.
- `src/services/agent-tools/router.ts`: roteamento deterministico para equipes.
- `src/services/orchestrator/runtime.ts`: traces, eventos, budgets e timeouts.
- `src/services/autopilot-sgp-response.ts`: guardrails especificos atuais para SGP e MCP, que devem virar parte de um pack vertical e nao regra global do core.
- `tests/*autopilot*`, `tests/*rag*`, `tests/*agent-tools*`: base inicial de testes.
- `docker-compose.yml`: worker dedicado de IA e variaveis de budget.

Os principais problemas provaveis:

- O fluxo ainda parece "prompt-first": muita decisao fica concentrada em uma chamada LLM.
- Falha de RAG pode virar fallback silencioso.
- Timeout de RAG em `3000ms` e arriscado quando ha cold start de embedding local.
- Gemini nao tem wrapper central com retry, fallback entre modelos/chaves e erro tipado.
- A base de conhecimento ainda nao e tratada como produto versionado, avaliado e rastreavel.
- Nao existe um laboratorio forte de avaliacao de respostas antes de publicar mudancas.
- O prompt principal esta grande, mistura persona, regras, exemplos, tools e politicas no mesmo bloco.
- A resposta final ainda precisa de uma etapa formal de validacao antes do envio.

## Principios de projeto

- Nunca deixar o cliente no vazio.
- Nunca inventar consulta operacional.
- Nunca afirmar que uma ferramenta foi executada antes de sucesso real.
- Nunca expor erro tecnico bruto para o cliente.
- Sempre preferir workflow deterministico quando a intencao for clara.
- Usar LLM para linguagem, interpretacao e casos ambiguos, nao para substituir regras criticas.
- Base de conhecimento precisa ter fonte, categoria, prioridade, validade e criterio de uso.
- Toda execucao precisa gerar rastro: entrada, contexto recuperado, decisao, ferramentas, resposta, erro e tempo.
- Toda mudanca em prompt, RAG, modelo ou ferramenta precisa passar por avaliacao.
- Atendimento bom e produto, nao configuracao solta.

## Arquitetura alvo

### Regra central: core multi-nicho

A Dialogy nao deve ter um cerebro fixo para telecom. Telecom/ISP deve ser apenas um pacote vertical, do mesmo jeito que podem existir pacotes para clinicas, delivery, e-commerce, educacao, imobiliarias, servicos locais, SaaS, advocacia, estetica, oficinas, academias, turismo e qualquer outro nicho.

Separacao obrigatoria:

- Core universal: intencao, RAG, workflow, tools, validacao, fallback, observabilidade e avaliacao.
- Pack vertical: vocabulario do nicho, categorias especificas, slots especificos, ferramentas especificas, politicas e exemplos.
- Configuracao do workspace: quais packs estao ativos, qual taxonomia usa, quais tools existem e quais documentos sao oficiais.

Exemplo:

- Core entende `purchase_inquiry`.
- Pack ISP mapeia para "planos de internet".
- Pack clinica mapeia para "consulta/procedimento".
- Pack e-commerce mapeia para "produto/preco/frete".
- Pack imobiliaria mapeia para "imovel/visita/financiamento".

### Pipeline principal

Evento de mensagem recebida:

1. `Inbound Normalizer`
   - Normaliza texto, midia, audio transcrito e metadados.
   - Resolve chat canonico e contato.
   - Garante idempotencia por `sourceMessageId`.

2. `Conversation State Builder`
   - Carrega ultimas mensagens.
   - Carrega perfil do contato.
   - Carrega estado do atendimento.
   - Carrega ultimas ferramentas executadas.
   - Carrega politicas do agente.

3. `Intent Router`
   - Classifica intencao de forma universal: descoberta/compra, duvida, suporte, cobranca/pagamento, agendamento, status, troca/devolucao/cancelamento, humano, saudacao, agradecimento, follow-up, reclamacao, documento, dados pessoais, desconhecido.
   - Usa regras deterministicas primeiro.
   - Usa LLM pequeno apenas quando houver ambiguidade.
   - Produz `intent`, `confidence`, `requiredSlots`, `workflowId`.

4. `Knowledge Retrieval`
   - Busca hibrida: vetor + keyword + documentos fixos por workflow.
   - Re-ranqueamento por relevancia, prioridade, recencia e categoria.
   - Retorna trechos com fonte, score, motivo e tipo.
   - Se nao houver contexto suficiente, sinaliza `knowledgeCoverage=low`.

5. `Tool Planner`
   - Decide se precisa de ferramenta.
   - Valida slots obrigatorios.
   - Planeja no maximo as proximas acoes seguras.
   - Ferramentas com efeito colateral exigem politicas mais rigidas.

6. `Tool Executor`
   - Executa com timeout, auditoria e status.
   - Normaliza saidas.
   - Remove dados sensiveis desnecessarios.
   - Gera resumo operacional para resposta.

7. `Response Composer`
   - Gera resposta ao cliente com base em fatos, contexto e resultado real.
   - Usa formato WhatsApp.
   - Evita repeticao de saudacao, nome e informacoes ja ditas.

8. `Response Validator`
   - Verifica se a resposta viola guardrails.
   - Verifica se prometeu acao sem ferramenta.
   - Verifica se respondeu sem base quando a politica exige base.
   - Verifica tamanho, tom, dados sensiveis e formato.
   - Pode aprovar, corrigir, substituir por fallback ou transferir.

9. `Delivery`
   - Confere se a mensagem ainda e atual.
   - Envia bloco unico ou multiplos blocos.
   - Registra status e telemetria.

10. `Learning Loop`
   - Registra run.
   - Atualiza dataset de avaliacao quando houver erro, fallback ou humano corrigindo.
   - Atualiza memoria de caso quando o atendimento encerra.

## Modelo de maturidade

### Nivel 0: Prompt solto

- Uma chamada LLM decide quase tudo.
- Falha vira silencio ou resposta generica.
- Pouca rastreabilidade.

### Nivel 1: Confiabilidade basica

- Retry, fallback e timeout corretos.
- Resposta de contingencia sempre enviada em modo auto.
- Traces por etapa.
- Guardrail contra prometer consulta sem tool.

### Nivel 2: RAG confiavel

- Busca hibrida.
- Fonte e score por trecho.
- Documentos por categoria e prioridade.
- Testes de recuperacao por intencao.

### Nivel 3: Workflow agentico

- Intencao vira workflow.
- Ferramentas sao planejadas fora do prompt principal.
- Slots obrigatorios impedem acao incompleta.
- Resposta final usa resultado real.

### Nivel 4: Avaliacao continua

- Dataset de conversas.
- Testes automaticos de qualidade.
- Comparacao entre versoes de prompt/modelo/base.
- Gate de deploy por score.

### Nivel 5: Plataforma tipo Dify

- UI para criar, versionar, testar e publicar agentes.
- Playground com traces.
- No-code/low-code para workflows e tools.
- Analytics por intencao, erro, custo e resolucao.

## Ondas de execucao

## Onda 1: Confiabilidade imediata

Objetivo: parar a sensacao de "quebrado".

### 1.1 Criar wrapper unico de chamadas LLM

Criar `src/services/ai/model-client.ts`.

Responsabilidades:

- Receber `model`, `prompt`, `schema`, `apiKeyCandidates`, `timeoutMs`.
- Aplicar retry com backoff para erro temporario.
- Fallback entre chaves: agente, workspace, ambiente.
- Fallback entre modelos permitidos quando o erro for temporario.
- Tipar erros:
  - `auth_error`
  - `rate_limit`
  - `timeout`
  - `model_unavailable`
  - `safety_block`
  - `schema_error`
  - `empty_response`
  - `unknown`
- Registrar tentativa, duracao, modelo, origem da chave e erro sanitizado.

Arquivos afetados:

- `src/ai/flows/auto-responder.ts`
- `src/ai/flows/tool-intent-gate.ts`
- `src/ai/flows/analyze-media.ts`
- `src/ai/flows/transcribe-audio.ts`
- `src/ai/flows/smart-replies.ts`
- `src/ai/flows/chat-summarization.ts`
- `src/ai/flows/case-memory-summarization.ts`

Aceite:

- Nenhuma flow chama Gemini com logica propria de fallback.
- Todo erro de modelo tem categoria.
- Teste cobre timeout, chave invalida, rate limit e resposta vazia.

### 1.2 Fallback obrigatorio para atendimento automatico

Em `src/services/autopilot-service.ts`:

- Se `currentCopilotMode === 'auto'`, toda falha deve terminar em uma destas saidas:
  - resposta util;
  - pedido de dado faltante;
  - transferencia humana;
  - mensagem de contingencia.
- Se `currentCopilotMode === 'suggest'`, falha gera sugestao interna ou evento de erro para o painel.

Aceite:

- Nao existe caminho de erro que deixe o cliente sem resposta quando autopilot auto esta ativo, exceto se envio do canal falhar.
- Traces marcam `fallbackReason`.

### 1.3 Ajustar budgets de RAG e LLM

Problema atual: `AI_ORCHESTRATOR_RAG_TIMEOUT_MS=3000` e agressivo para cold start de embedding.

Mudancas:

- Produzir budget separado:
  - `AI_ORCHESTRATOR_RAG_TIMEOUT_MS=7000` em producao pequena.
  - `AI_ORCHESTRATOR_RAG_WARM_TIMEOUT_MS=3000` quando modelo ja esta aquecido.
  - `AI_EMBEDDING_PREWARM_REQUIRED=true` para worker-ai.
- Registrar evento quando RAG cair por timeout.
- Se RAG falhar, usar documentos estaticos do agente como fallback com status `rag_fallback_static_documents`.

Aceite:

- Cold start nao derruba recuperacao na primeira conversa.
- O log mostra se usou vetor, keyword, documentos estaticos ou nenhum contexto.

### 1.4 Remover modelos experimentais do caminho padrao

Revisar `src/lib/ai-models.ts`.

Mudancas:

- Separar modelos `stable`, `preview`, `deprecated`.
- Nao permitir preview em autopilot auto por padrao.
- Permitir preview apenas em playground/teste.
- Catalogo deve ter `runtimeSupported`, `recommendedUse`, `riskLevel`.

Aceite:

- Atendente em producao usa apenas modelo estavel.
- Modelo salvo invalido cai para modelo seguro e registra aviso.

### 1.5 Circuit breaker por provedor/modelo

Criar controle simples:

- Se modelo falhar N vezes em janela curta, abrir circuito por alguns minutos.
- Durante circuito aberto, usar fallback sem tentar o modelo quebrado.
- Registrar em `orchestrator_events`.

Aceite:

- Um pico de falha do Gemini nao trava todos os atendimentos.

## Onda 2: RAG v2

Objetivo: a IA encontrar a resposta certa com consistencia.

### 2.1 Estruturar documentos da base

Expandir `KnowledgeBaseDocument` para suportar:

- `id`
- `name`
- `content`
- `summary`
- `category`
- `tags`
- `priority`
- `status`
- `validFrom`
- `validUntil`
- `audience`
- `source`
- `owner`
- `updatedAt`
- `workflowHints`
- `requiredTools`
- `canonicalAnswer`

Taxonomia universal inicial:

- `persona`
- `brand_voice`
- `product_or_service_catalog`
- `pricing`
- `offers`
- `sales`
- `support`
- `billing`
- `scheduling`
- `order_or_request_status`
- `onboarding`
- `troubleshooting`
- `returns_or_cancellation`
- `policy`
- `legal`
- `faq`
- `tool_procedure`
- `escalation_policy`
- `handoff_policy`
- `compliance`
- `internal_only`
- `uncategorized`

Packs verticais opcionais podem adicionar categorias do nicho sem contaminar o core. Exemplos:

- ISP/telecom: `isp_plan_catalog`, `isp_outage`, `isp_router`, `isp_contract`, `isp_invoice`.
- Clinicas: `clinic_appointment`, `clinic_exam`, `clinic_insurance`, `clinic_preparation`, `clinic_results`.
- E-commerce: `ecommerce_product`, `ecommerce_shipping`, `ecommerce_return`, `ecommerce_exchange`, `ecommerce_warranty`.
- Delivery/restaurante: `menu`, `delivery_area`, `delivery_time`, `order_tracking`, `reservation`.
- Educacao: `course_catalog`, `enrollment`, `class_schedule`, `certificate`, `student_support`.
- Imobiliaria: `property_catalog`, `visit_scheduling`, `financing`, `lease`, `documents`.

Aceite:

- Documento sem categoria ainda funciona, mas recebe categoria `uncategorized`.
- Documentos de procedimento podem declarar tool obrigatoria.
- O core nao deve ter regra hardcoded que assume telecom, SGP, plano de internet ou contrato.
- Packs verticais sao habilitados por workspace/agente.

### 2.2 Busca hibrida

Criar `src/services/rag/hybrid-retrieval.ts`.

Fontes:

- Vector search em `embeddings_documents`.
- Keyword search em Postgres com `tsvector` ou fallback `ILIKE`.
- Documentos fixos por categoria/intencao.
- Memoria de casos resolvidos.

Ranqueamento:

- Score vetor.
- Score keyword.
- Prioridade do documento.
- Match de categoria com intencao.
- Penalizacao por documento expirado.
- Penalizacao por conteudo muito generico.
- Bonus para `canonicalAnswer`.

Aceite:

- Consulta de compra/catalogo sempre traz documento `product_or_service_catalog` ou categoria vertical equivalente se existir.
- Consulta de preco sempre traz `pricing` ou categoria vertical equivalente se existir.
- Consulta de suporte nao e dominada por documento comercial.
- Termos especificos do nicho sao resolvidos pelo pack vertical ativo, nao por regra global.

### 2.3 Re-ranker leve

Implementar re-ranker deterministico primeiro:

- Remove duplicatas por hash de conteudo.
- Agrupa chunks do mesmo documento.
- Limita contexto por categoria.
- Mantem pelo menos um documento oficial quando encontrado.

Opcional posterior:

- Re-ranker LLM pequeno com timeout curto.
- Cross-encoder local se viavel.

Aceite:

- Prompt recebe menos texto inutil.
- Traces mostram `retrieved`, `selected`, `discarded`.

### 2.4 Resposta oficial

Para documentos com `canonicalAnswer`:

- Se intencao bater com alta confianca, usar resposta oficial deterministica.
- LLM pode adaptar tom, mas nao alterar fatos.
- Para catalogos, precos, politicas, prazos, regras comerciais e informacoes reguladas, preferir resposta oficial sem passar pelo LLM.

Aceite:

- Produtos, servicos, planos, precos, prazos e condicoes nao sofrem alucinacao.
- Ofertas expiradas nao sao sugeridas.

### 2.5 Testes de recuperacao

Criar `tests/rag-retrieval-quality.spec.ts`.

Casos minimos universais:

- pedido de catalogo/produtos/servicos;
- pedido de preco/condicao/prazo;
- cobranca/pagamento;
- agendamento;
- suporte/problema operacional;
- status de pedido/solicitacao;
- troca/devolucao/cancelamento;
- pedido de humano;
- cliente pergunta algo fora da base;
- pergunta ambigua;
- documento expirado;
- documento com tool obrigatoria.

Casos verticais entram em fixtures separadas, por exemplo:

- ISP: planos de internet, segunda via, promessa de pagamento, sem conexao, reboot.
- Clinica: marcar consulta, preparo de exame, convenio, resultado.
- E-commerce: frete, rastreio, troca, garantia, disponibilidade.
- Delivery: cardapio, area de entrega, tempo estimado, pedido atrasado.

Aceite:

- Cada caso espera documento/categoria especifica no top 3.

## Onda 3: Intent Router e workflows

Objetivo: sair do modelo "prompt decide tudo".

### 3.1 Criar contrato de intencao

Arquivo: `src/services/autopilot/intent-types.ts`.

Campos:

- `intent`
- `subIntent`
- `confidence`
- `reason`
- `requiredSlots`
- `extractedSlots`
- `workflowId`
- `shouldUseLlm`
- `shouldRetrieveKnowledge`
- `shouldUseTool`
- `shouldTransfer`

Intencoes universais iniciais:

- `greeting`
- `human_handoff`
- `purchase_inquiry`
- `catalog_request`
- `pricing_request`
- `promotion_request`
- `availability_request`
- `billing_or_payment`
- `scheduling_request`
- `order_or_request_status`
- `support_request`
- `troubleshooting`
- `change_request`
- `return_or_refund`
- `cancellation_request`
- `document_request`
- `complaint`
- `thanks`
- `unknown`

Packs verticais podem criar sub-intencoes sem alterar o core:

- ISP: `isp_plan_catalog`, `isp_invoice_copy`, `isp_payment_promise`, `isp_no_connection`, `isp_router_reboot`.
- Clinica: `clinic_book_appointment`, `clinic_exam_preparation`, `clinic_insurance_question`.
- E-commerce: `ecommerce_shipping_quote`, `ecommerce_tracking`, `ecommerce_exchange_request`.
- Delivery: `delivery_menu_request`, `delivery_order_status`, `delivery_area_question`.

### 3.2 Roteador em camadas

Camadas:

1. Regras deterministicas fortes.
2. Regex/keywords por dominio.
3. Historico recente para follow-up.
4. LLM gate apenas para ambiguidade.

Aceite:

- Pedido explicito de humano nao depende de LLM.
- Pedido de catalogo/preco nao depende de LLM quando documento oficial existe.
- Pedido "sim" apos oferta entende follow-up dentro do nicho ativo.

### 3.3 Workflows declarativos

Criar `src/services/autopilot/workflows.ts`.

Cada workflow declara:

- `id`
- `intent`
- `requiredSlots`
- `knowledgeCategories`
- `allowedTools`
- `preconditions`
- `steps`
- `fallbackPolicy`
- `handoffPolicy`
- `responsePolicy`

Exemplo universal: `billing_or_payment`

1. Identificar qual cobranca/pagamento o cliente quer resolver.
2. Verificar se o workspace exige identificador do cliente.
3. Se faltar dado obrigatorio, pedir apenas o dado necessario.
4. Consultar a ferramenta financeira configurada para o workspace.
5. Se houver um item claro, responder com o caminho seguro de pagamento ou proxima acao permitida.
6. Se houver multiplos itens, perguntar qual.
7. Se a ferramenta falhar ou o caso for sensivel, transferir para a equipe configurada.

Exemplo vertical ISP: `isp_billing_pix`

1. Verificar CPF/CNPJ no CRM.
2. Se ausente, pedir CPF/CNPJ.
3. Salvar CPF/CNPJ se informado.
4. Consultar SGP.
5. Se uma fatura clara, gerar PIX.
6. Se varias faturas, perguntar qual.
7. Se erro, transferir financeiro.

Aceite:

- Workflow de pagamento nao inventa cobranca, fatura, pedido, assinatura ou item financeiro.
- Workflow operacional nao afirma execucao de acao sem sucesso real da ferramenta.

### 3.4 Slot filling

Criar extratores:

- nome.
- CPF/CNPJ ou documento equivalente quando o pais/nicho exigir.
- data.
- horario.
- telefone.
- email.
- endereco.
- identificador de pedido/solicitacao.
- identificador de cobranca/fatura.
- identificador de produto/servico.
- preferencia de produto/servico.
- quantidade.
- localidade.

Slots verticais podem ser adicionados por pack:

- ISP: contrato, invoiceId, contractId, login, roteador, endereco de instalacao.
- Clinica: especialidade, medico, convenio, exame, unidade.
- E-commerce: SKU, tamanho, cor, codigo de rastreio.
- Delivery: item do cardapio, mesa, bairro, forma de pagamento.

Implementar em `src/services/autopilot/slots.ts`.

Aceite:

- Dado identificador informado pelo cliente e salvo antes da consulta quando a politica permitir.
- Datas e horarios sao validados em formato real.
- Identificador citado pelo cliente guia a resposta correta da ferramenta.

## Onda 4: Tools profissionais

Objetivo: ferramentas seguras, previsiveis e auditaveis.

### 4.1 Catalogo de ferramentas com contrato forte

Expandir `src/services/agent-tools/catalog.ts`.

Campos:

- `name`
- `version`
- `description`
- `inputSchema`
- `outputSchema`
- `riskLevel`
- `sideEffect`
- `requiresApproval`
- `idempotent`
- `timeoutMs`
- `maxAttempts`
- `customerVisible`
- `allowedIntents`
- `requiredSlots`
- `fallbackAction`

Aceite:

- Tool nao roda fora de intencao permitida.
- Tool nao roda sem slots obrigatorios.

### 4.2 Planner de ferramentas fora do prompt

Criar `src/services/autopilot/tool-planner.ts`.

O LLM pode sugerir, mas o planner decide:

- Se a tool e permitida.
- Se faltam dados.
- Se precisa executar pre-tool.
- Se deve transferir em vez de executar.

Aceite:

- `auto-responder.ts` nao e mais a fonte primaria de decisao de tools criticas.

### 4.3 Normalizacao de saida de ferramentas

Cada tool deve retornar:

- `status`
- `facts`
- `customerSafeSummary`
- `internalSummary`
- `raw`
- `sensitiveFieldsRemoved`
- `nextPossibleActions`

Aceite:

- Resposta ao cliente nunca usa JSON bruto.
- Erro de ferramenta interna, MCP, ERP, CRM, gateway, SGP ou API vertical nunca aparece literalmente.

### 4.4 Politicas de side effect

Classificar:

- Read only: consultar dados, status, cadastro, cobranca ou disponibilidade.
- Low side effect: nota interna, atualizar campo simples do CRM.
- Medium side effect: criar compromisso, gerar link, reservar horario ou iniciar solicitacao.
- High side effect: cancelar, alterar assinatura/contrato/plano, acionar dispositivo, abrir ordem operacional, cobrar, estornar ou mudar status externo.

Exemplos verticais entram como especializacoes da mesma escala:

- ISP: reboot de roteador ou abertura de OS.
- Clinica: marcar/desmarcar consulta.
- E-commerce: gerar troca, estorno ou cancelamento.
- SaaS: alterar plano, convidar usuario, desativar conta.

Politica:

- High side effect exige confirmacao explicita ou humano, salvo regra configurada.
- Ferramentas bloqueadas continuam bloqueadas para IA.

Aceite:

- O sistema nao executa acao irreversivel por interpretacao fraca.

## Onda 5: Prompt v2 e resposta validada

Objetivo: prompt menor, mais controlado e respostas mais corretas.

### 5.1 Dividir prompt monolitico

Separar em blocos:

- `personaPrompt`
- `channelStylePrompt`
- `knowledgeUsePrompt`
- `toolPolicyPrompt`
- `responseFormatPrompt`
- `safetyPrompt`

Arquivos:

- `src/ai/prompts/autopilot/persona.ts`
- `src/ai/prompts/autopilot/response.ts`
- `src/ai/prompts/autopilot/tools.ts`
- `src/ai/prompts/autopilot/safety.ts`

Aceite:

- Prompt principal fica montado por partes.
- Testes podem validar trechos do prompt.

### 5.2 Response Composer

Criar `src/services/autopilot/response-composer.ts`.

Entrada:

- intent;
- knowledge selected;
- tool results;
- contact;
- chat history;
- style;
- fallback policy.

Saida:

- `response`
- `messageBlocks`
- `confidence`
- `usedSources`
- `claims`
- `handoffRecommended`

Aceite:

- Resposta possui claims rastreaveis quando usar fatos de base/ferramenta.

### 5.3 Response Validator

Criar `src/services/autopilot/response-validator.ts`.

Validacoes:

- Resposta vazia.
- Promessa de tool sem tool.
- Afirma "verifiquei" sem resultado real.
- Cita preco, plano, produto, servico, prazo, regra ou condicao sem fonte oficial.
- Excede tamanho maximo.
- Repete saudacao/nome.
- Explica sistema interno.
- Expoe JSON bruto, stack trace, token, id tecnico sensivel.
- Usa tom inadequado para cliente irritado.
- Falta pergunta de slot obrigatorio.

Acoes:

- `approve`
- `repair`
- `replace_with_fallback`
- `handoff`
- `block`

Aceite:

- Teste cobre cada violacao.
- Todo bloqueio gera evento no orquestrador.

### 5.4 Mensagens WhatsApp

Politica:

- Resposta simples: 1 bloco.
- Catalogo: blocos com linhas curtas.
- Procedimento: explicar proximo passo.
- Falha: mensagem curta + encaminhamento quando necessario.
- Nunca mandar textao sem pedido explicito.

Aceite:

- `splitIntoMessageBlocks` e usado como fallback, nao como correcao de resposta mal planejada.

## Onda 6: Laboratorio de avaliacao

Objetivo: parar de ajustar no escuro.

### 6.1 Dataset de conversas

Criar estrutura:

- `tests/fixtures/autopilot-evals/*.json`

Cada caso:

- `id`
- `title`
- `workspaceConfig`
- `agentConfig`
- `chatHistory`
- `customerMessage`
- `expectedIntent`
- `expectedTools`
- `forbiddenPhrases`
- `requiredFacts`
- `expectedHandoff`
- `expectedKnowledgeCategories`
- `qualityRubric`

### 6.2 Runner de avaliacao

Criar script:

- `scripts/eval-autopilot.ts`

Modos:

- `--offline`: testa intent router, RAG fake e validator sem chamar LLM.
- `--live`: chama modelo real com budget e salva resultados.
- `--compare`: compara duas versoes.

Metricas:

- intent accuracy;
- tool precision;
- tool recall;
- response correctness;
- forbidden claim rate;
- fallback rate;
- avg latency;
- avg cost;
- handoff correctness.

Aceite:

- CI roda offline sempre.
- Live eval roda manualmente antes de release.

### 6.3 Golden conversations

Criar pelo menos 100 casos:

- 15 compra/catalogo/preco.
- 15 cobranca/pagamento.
- 15 suporte/problema operacional.
- 10 agendamento/status.
- 10 troca/devolucao/cancelamento.
- 10 reclamacao/cliente irritado.
- 10 pedido humano.
- 10 base incompleta.
- 10 falha de ferramenta.
- 5 casos especificos do pack vertical ativo.

Aceite:

- Release so passa se score geral >= limite definido.

### 6.4 Human review loop

No painel:

- Operador marca resposta como boa, ruim ou perigosa.
- Operador escreve resposta correta.
- Sistema transforma em caso de avaliacao sugerido.

Aceite:

- Erros reais viram regressao automatica.

## Onda 7: Admin tipo Dify

Objetivo: dar controle operacional para configurar e testar agentes.

### 7.1 Playground do agente

Tela:

- Selecionar agente.
- Simular mensagem.
- Ver resposta.
- Ver intent.
- Ver documentos recuperados.
- Ver tools planejadas/executadas.
- Ver prompt final.
- Ver validator.
- Ver trace e tempos.

Arquivos provaveis:

- `src/app/autopilot/[id]/page.tsx`
- `src/components/autopilot/*`
- `src/app/api/autopilot/test/route.ts`

Aceite:

- Usuario entende por que a IA respondeu aquilo.

### 7.2 Versionamento

Criar versoes para:

- prompt;
- base;
- workflow;
- tool policy;
- modelo;
- fallback.

Estados:

- `draft`
- `testing`
- `published`
- `archived`

Aceite:

- Mudanca nao vai direto para producao.
- E possivel rollback.

### 7.3 Publicacao com gate

Antes de publicar:

- Rodar eval.
- Mostrar score.
- Mostrar regressions.
- Exigir confirmacao se score caiu.

Aceite:

- Ninguem publica prompt/base quebrada sem enxergar impacto.

### 7.4 Templates de agente

Templates universais:

- Vendas/qualificacao.
- Suporte/SAC.
- Financeiro/cobranca.
- Agendamento.
- Status de pedido/solicitacao.
- Ouvidoria/reclamacao.

Templates verticais opcionais:

- ISP/telecom.
- Clinicas e saude.
- E-commerce.
- Delivery/restaurantes.
- Educacao/cursos.
- Imobiliarias.
- Servicos locais.
- SaaS/B2B.

Aceite:

- Novo workspace nao comeca de base vazia.
- Template vertical adiciona vocabulario e exemplos, mas nao muda o core do agente.

## Onda 8: Observabilidade operacional

Objetivo: saber exatamente onde quebra.

### 8.1 Enriquecer `orchestrator_runs`

Adicionar campos ou metadata:

- `intent`
- `workflow_id`
- `model`
- `model_attempts`
- `rag_strategy`
- `knowledge_coverage`
- `tool_plan`
- `validator_action`
- `fallback_reason`
- `customer_sentiment`
- `handoff_reason`

### 8.2 Dashboard de qualidade

Metricas:

- taxa de resposta enviada;
- taxa de fallback;
- taxa de transferencia;
- taxa de ferramenta com sucesso;
- taxa de ferramenta com erro;
- latencia por etapa;
- intencoes mais frequentes;
- documentos mais usados;
- documentos sem uso;
- perguntas sem resposta;
- custo por atendimento;
- resolucao sem humano;
- override humano.

### 8.3 Alertas

Alertar quando:

- fallback rate > X%;
- LLM timeout > X%;
- RAG sem resultado > X%;
- ferramenta externa/ERP/CRM/gateway/vertical falhando > X%;
- fila de IA atrasada;
- worker-ai reiniciando;
- modelo em circuit breaker;
- envio do canal falhando.

Aceite:

- Time sabe se o problema e modelo, RAG, ferramenta externa, fila, canal, prompt ou configuracao do agente.

### 8.4 Runbook

Criar `docs/ai-attendant-runbook.md`.

Incluir:

- Como diagnosticar conversa ruim.
- SQL para runs recentes.
- Como verificar fila.
- Como testar Gemini.
- Como reprocessar documento.
- Como desativar agente.
- Como forcar transferencia humana.

## Onda 9: Seguranca, privacidade e governanca

Objetivo: evitar dano operacional, LGPD e vazamento.

### 9.1 Politica de dados sensiveis

Regras:

- Nao expor CPF completo salvo necessidade clara.
- Nao expor tokens, ids internos, stack trace.
- Redigir logs quando necessario.
- Separar `internalSummary` de `customerSafeSummary`.

### 9.2 Permissoes por agente

Cada agente:

- tools permitidas;
- equipes permitidas;
- documentos permitidos;
- canais permitidos;
- modo auto/sugestao;
- horarios de operacao;
- politica de fallback.

### 9.3 Auditoria de side effects

Toda ferramenta com efeito:

- quem pediu;
- qual agente;
- qual chat;
- input validado;
- output;
- status;
- motivo;
- idempotency key.

Aceite:

- E possivel auditar toda acao automatica.

## Onda 10: Otimizacao e escala

Objetivo: sustentar volume com custo previsivel.

### 10.1 Cache inteligente

Cachear:

- embedding de query normalizada por curto periodo;
- documentos recuperados para perguntas repetidas;
- catalogos oficiais;
- configuracao do agente;
- catalogo de tools;
- equipes do workspace.

### 10.2 Fila e concorrencia

Politicas:

- Priorizar mensagem recente.
- Cancelar job antigo se nova mensagem chegou.
- Limitar jobs por chat.
- Evitar duas respostas simultaneas.
- Backpressure por workspace.

### 10.3 Model routing por complexidade

Usar:

- Modelo rapido para intencao.
- Modelo rapido para resposta simples.
- Modelo melhor para casos complexos.
- Deterministico para catalogo, preco, politicas, prazos, regras e dados oficiais.

Aceite:

- Reduz custo sem perder qualidade.

## Primeiro pacote de PRs

### PR 1: Model Client e erro tipado

Entrega:

- `src/services/ai/model-client.ts`
- testes de retry/fallback/error typing.
- migrar `auto-responder` para wrapper.

Risco: medio.

### PR 2: Fallback obrigatorio e circuit breaker

Entrega:

- fallback consistente no `autopilot-service`.
- circuit breaker simples por modelo.
- logs melhores.

Risco: medio.

### PR 3: Budgets RAG e fallback estatico

Entrega:

- aumentar budget default.
- evento de cold start/timeout.
- usar documentos estaticos se vetor falhar.

Risco: baixo.

### PR 4: Intent types e roteador v2

Entrega:

- contrato de intencao.
- roteamento deterministico expandido.
- testes de intencao.

Risco: medio.

### PR 5: Hybrid retrieval

Entrega:

- busca vetor + keyword + categorias.
- re-ranker deterministico.
- testes de qualidade.

Risco: medio.

### PR 6: Workflow engine inicial

Entrega:

- workflows universais para catalogo/preco, humano, pagamento/cobranca, suporte/problema operacional e agendamento/status.
- primeiro pack vertical reaproveitando o que ja existe de ISP/SGP sem acoplar ao core.
- slot filling.

Risco: alto.

### PR 7: Tool planner

Entrega:

- decisao de tools fora do prompt.
- validacao por slots/intencao.
- normalizacao de outputs.

Risco: alto.

### PR 8: Response validator

Entrega:

- guardrails antes do envio.
- reparo/fallback/handoff.
- testes de violacao.

Risco: medio.

### PR 9: Eval runner

Entrega:

- fixtures JSON.
- runner offline/live.
- score por dimensao.

Risco: medio.

Status inicial implementado:

- `src/services/autopilot/eval-cases.ts` com suite offline multi-nicho.
- `src/services/autopilot/eval-runner.ts` com score por intent, RAG, workflow, tool planner, validator e resposta.
- `scripts/eval-autopilot.ts` e `npm run eval:autopilot` para regressao sem LLM.
- `tests/autopilot-evals.spec.ts` cobrindo casos reais simulados.

### PR 10: Playground com trace

Entrega:

- simulador de agente.
- exibicao de intent/RAG/tools/validator.
- comparar draft vs published.

Risco: alto.

Status inicial implementado:

- `src/components/autopilot/autopilot-playground.tsx` com teste lateral do agente.
- `src/components/autopilot/autopilot-readiness.tsx` com checklist de prontidao.
- `src/services/autopilot/playground-trace.ts` para montar trace de intent, RAG, workflow, tool planner e validator.
- `/api/autopilot/test` agora retorna `trace` junto da resposta do preview.
- `tests/autopilot-playground-trace.spec.ts` cobre o trace offline.

## Cronograma sugerido

### Semana 1

- PR 1.
- PR 2.
- PR 3.
- 20 casos de avaliacao iniciais.

Resultado esperado:

- IA para de falhar silenciosamente.
- Time consegue diagnosticar erro por etapa.

### Semana 2

- PR 4.
- Inicio PR 5.
- Mais 30 casos de avaliacao.

Resultado esperado:

- Pedidos comuns nao dependem tanto do modelo.
- RAG melhora para catalogo/preco, cobranca/pagamento, suporte e categorias verticais habilitadas.

### Semanas 3 e 4

- Final PR 5.
- PR 6.
- PR 7 parcial.

Resultado esperado:

- Fluxos de pagamento, suporte, agendamento/status e verticais com slots e tools mais seguros.

### Semanas 5 e 6

- PR 8.
- PR 9.
- 100 casos de avaliacao.

Resultado esperado:

- Deploy de IA passa a ter gate de qualidade.

### Semanas 7 e 8

- PR 10.
- Versionamento draft/published.
- Dashboard inicial de qualidade.

Resultado esperado:

- Experiencia operacional parecida com Dify, mas integrada ao produto Dialogy.

## Criterios de sucesso

### Confiabilidade

- 99% das mensagens em modo auto terminam com resposta, transferencia ou fallback enviado.
- LLM timeout nao causa silencio.
- RAG timeout nao elimina completamente contexto se houver documentos estaticos.

### Qualidade

- Intent accuracy >= 90% nos casos gold.
- Tool precision >= 95% para ferramentas com efeito.
- Forbidden claim rate < 1%.
- Catalogo, precos, prazos, politicas, regras e dados oficiais com 0 alucinacao nos casos testados.

### Operacao

- Toda conversa ruim possui trace suficiente para explicar a falha.
- Equipe consegue testar agente antes de publicar.
- Mudanca de prompt/base pode ser revertida.

### Performance

- P95 total em atendimento automatico simples <= 8s.
- P95 com ferramenta <= 15s.
- Fallback rapido em caso de provedor indisponivel.

## Antipadroes a evitar

- Aumentar prompt indefinidamente.
- Jogar documentos inteiros no contexto.
- Usar modelo preview em producao sem gate.
- Deixar LLM decidir side effect critico sozinho.
- Tratar fallback como derrota. Fallback bom e parte do produto.
- Medir apenas "respondeu", sem medir se respondeu certo.
- Criar regra escondida que ninguem consegue auditar.

## Decisoes tecnicas recomendadas

- Manter Genkit se ele continuar produtivo, mas esconder chamadas atras de `model-client`.
- Manter Gemini como provedor inicial, mas preparar contrato para multi-provider.
- Manter embeddings locais para custo, mas preaquecer e considerar alternativa externa se latencia/cold start incomodar.
- Preferir Postgres para primeira versao de hybrid retrieval.
- Criar workflows em TypeScript antes de criar editor no-code.
- Criar eval offline antes de eval live.

## Backlog detalhado

### Autopilot core

- Criar `src/services/autopilot/context-builder.ts`.
- Criar `src/services/autopilot/intent-router.ts`.
- Criar `src/services/autopilot/workflow-engine.ts`.
- Criar `src/services/autopilot/tool-planner.ts`.
- Criar `src/services/autopilot/response-composer.ts`.
- Criar `src/services/autopilot/response-validator.ts`.
- Reduzir responsabilidade de `src/services/autopilot-service.ts`.

### RAG

- Criar `src/services/rag/hybrid-retrieval.ts`.
- Criar `src/services/rag/reranker.ts`.
- Criar `src/services/rag/coverage.ts`.
- Adicionar metadata nos chunks.
- Adicionar hash de chunk.
- Adicionar categoria e prioridade.

### AI runtime

- Criar `src/services/ai/model-client.ts`.
- Criar `src/services/ai/model-errors.ts`.
- Criar `src/services/ai/circuit-breaker.ts`.
- Criar `src/services/ai/prompt-registry.ts`.
- Criar `src/services/ai/token-budget.ts`.

### Tools

- Expandir catalogo.
- Adicionar schemas de output.
- Adicionar idempotency key.
- Adicionar normalizadores por tool.
- Adicionar politicas por risco.

### Observabilidade

- Enriquecer eventos.
- Adicionar metricas por intent.
- Adicionar metricas por fallback.
- Adicionar query docs.
- Criar runbook.

Status inicial implementado:

- Eventos de `intent_resolution`, `workflow_plan`, `tool_planner` e `response_validator`.
- Dimensoes de metricas para intent, workflow, RAG, planner, validator e fallback.
- `src/services/autopilot/observability.ts` para sumarizar taxas operacionais.
- `docs/ai-attendant-runbook.md` com queries e fluxo de diagnostico.

### UI

- Playground.
- Trace viewer.
- Document quality panel.
- Eval results panel.
- Version publish panel.

Status inicial implementado:

- Playground acoplado ao trace operacional.
- Checklist de prontidao com modelo, credencial, base, fallback, humano, acoes, teste e publicado.
- Rascunho persistido por agente antes de afetar producao.
- Publicacao versionada com snapshot em `autopilot_config_versions`.
- Comparacao de trace lado a lado entre publicado e rascunho no playground.

## Definition of Done para cada feature de IA

Uma feature de IA so esta pronta quando:

- Tem teste unitario.
- Tem pelo menos um caso de avaliacao.
- Registra trace.
- Tem fallback.
- Tem comportamento em modo auto e suggest.
- Nao quebra stale guard.
- Nao envia dado sensivel indevido.
- Tem criterio claro de rollback.

## Plano de gatilho imediato

Se a meta e deixar no gatilho para executar agora, a ordem pratica e:

1. Congelar mudancas aleatorias em prompts.
2. Criar 20 conversas gold reais.
3. Implementar `model-client`.
4. Implementar fallback obrigatorio.
5. Ajustar RAG timeout e fallback estatico.
6. Remover preview do autopilot auto.
7. Criar intent router v2 universal para humano, catalogo/preco, pagamento/cobranca, suporte, agendamento/status e follow-up.
8. Criar validator para promessas sem tool.
9. Criar eval runner offline.
10. Criar o primeiro pack vertical a partir do nicho mais urgente do cliente, sem acoplar isso ao core.
11. So depois refatorar UI tipo Dify.

Esse caminho entrega ganho perceptivel cedo e cria base para evoluir sem quebrar atendimento real.
