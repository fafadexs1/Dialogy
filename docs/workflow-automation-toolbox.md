# Ferramentas de automação do Nexus — implementação

As ferramentas estendem o Flowbuilder nativo e combinam o IA Studio publicado com dados, arquivos, APIs e ações existentes. Os contratos de workflow e portas permanecem compatíveis. O compositor “Peça à Nexus AI” continua desabilitado. Deploy, migrações no banco da aplicação e publicação de workflows em uso não foram realizados.

## Capacidades implementadas

| Área | Comportamento |
| --- | --- |
| Dados | Explorar entradas, variáveis e resultados sanitizados; mapear campos e índices; fixar exemplos somente na sessão de testes. Formulários para seleção, divisão de texto, regex isolada, conversão, formatação, validação, filtro, ordenação, deduplicação, agrupamento, agregação e junção por chave. JSONata e JavaScript existentes continuam disponíveis. |
| HTTP | JSON, texto, arquivo e detecção automática; multipart real, corpo binário e paginação por página/cursor com limites. Credenciais OAuth2 com renovação serializada, tokens cifrados e origem autorizada fixa. |
| Arquivos | Referência opaca com nome, MIME e tamanho; conteúdo privado no S3. Conferência de workspace, metadados canônicos e expiração. URLs assinadas são resolvidas no envio e removidas dos resultados persistidos. |
| Continuidade | Subfluxos publicados por item ou lote, uma chamada durável ou até 20 ramos isolados. Resultados ordenados, erros por item, modo interromper ou coletar. Reserva atômica de orçamento e concorrência configurável. |
| Esperas e aprovações | Jobs persistidos, retomada após reinício, evento antecipado correlacionado à execução e ao token da espera. Aprovação vinculada à versão, configuração e argumentos; recusa e expiração têm saídas próprias. |
| Studio e mídia | Composição dos agentes/procedimentos já publicados; conector como etapa ou ferramenta do agente. Transcrição existente, leitura de PDF/CSV/XLSX/JSON/texto, geração de arquivos, interpretação multimodal com capacidade declarada e voz ElevenLabs como arquivo de áudio. |
| Biblioteca | Conectores privados com versões imutáveis, contratos de entrada/saída, credencial, política de aprovação e revogação. cURL é interpretado como configuração, sem shell; OpenAPI 3 em JSON aceita referências locais e gera formulários revisáveis. |
| Webhooks | Captura temporária de exemplo separada da produção, assinatura HMAC sobre os bytes originais, fila durável, deduplicação, resposta configurável, prazo síncrono limitado e consulta autenticada de resultado. |
| Operação | Painéis de aprovações e tarefas filhas, debugger existente e reconciliação de resultado externo confirmado antes de continuar. Testes usam fixtures explicitamente simuladas. |

Os modelos editáveis “Vendas com IA, voz e CRM” e sua variante por webhook são rascunhos com pré-requisitos explícitos. Não inventam endpoint de catálogo, credencial, voz, release do Studio, mapeamento comercial ou equipe. A propriedade `homologatedWithRealProviders` permanece falsa.

## Persistência e compatibilidade

A migração `20261024120000_nexus_automation_toolbox` cria tabelas para arquivos, políticas, jobs, aprovações, efeitos, conectores, capturas de webhook e eventos. Ela acrescenta o tipo de credencial OAuth2, habilita RLS e revoga acesso direto de `anon`/`authenticated`. As ações do servidor verificam `automations:manage` e workspace; o runtime usa o acesso de serviço existente. Nenhum segredo é enviado ao navegador pela biblioteca.

Novas operações persistem apenas configurações nos nodes existentes. Listas continuam sendo valores; não há conversão do modelo Dialogy para o formato do n8n. Versões de workflows filhos e conectores são fixadas na execução. Releases do Studio mantêm sua validação e política de revogação. Workflows existentes sem as opções novas conservam sua semântica HTTP e de espera.

Nas automações novas gerenciadas, uma publicação posterior não cancela a versão que aguarda resposta. O dispatcher distingue mensagem do cliente, evento externo identificado, passagem de tempo, aprovação e subfluxos. Mensagens não liberam aprovações, eventos ou processamento em lote; perguntas e seleção SGP continuam interativas. O bloco Aguardar oferece `mode: 'message'` explicitamente, com expiração opcional; o modelo de vendas usa essa opção para o retorno em quatro horas. O nome do evento continua editável quando sua expiração está ligada.

Efeitos externos gerenciados registram intenção antes da chamada. Se o worker perder o resultado, a intenção impede repetição automática. A recuperação exige evidência e saída confirmada, mantém os passos concluídos e os contadores e enfileira a continuação sem chamar novamente a operação. Ela cobre nodes externos/arquivos com checkpoint recuperável; não injeta resultados em agentes do Studio, controles ou execuções filhas de lote.

## Limites iniciais

- Listas: 1.000 itens; dados/resultado de transformação: 1 MB. Regex isolada em VM, com prazo e tamanhos limitados.
- Arquivos: 10 MB, retenção de 30 dias e limpeza periódica pelo worker; requisição HTTP: 5 MB; resposta acumulada: 10 MB. A interface e o transporte podem impor limites menores.
- CSV/XLSX: 1.000 linhas; XLSX de até 2 MB e arquivo descompactado limitado a 20 MB. O leitor XLSX usa a primeira planilha e até 100 colunas.
- Paginação: até 100 páginas, 10.000 itens e 120 segundos; sem redirecionamento ou próxima URL em outra origem.
- Subfluxos: até quatro níveis, concorrência padrão 1 e teto 5, respeitando o limite menor do workspace. Orçamento reservado antes do despacho; falhas com resultado incerto consomem a reserva conservadoramente.
- Webhook: corpo de até 1 MB; captura de teste válida por dez minutos e um exemplo; resposta síncrona de até 20 segundos, com alternativa 202 e consulta autenticada.
- OAuth2: `client_credentials` ou `refresh_token` fornecido pelo administrador. Autorização interativa no navegador não está incluída.
- PDF multimodal: disponível no adaptador Google configurado; imagens exigem capacidade declarada do modelo principal. Não há troca silenciosa de provedor.

## Ativação por workspace

1. Revisar/aplicar a migração pelo processo normal de migrations em homologação isolada, com as migrações anteriores de Nexus/runtime/Studio presentes. O script antigo `db:nexus:migrations` contém uma lista fixa e não aplica esta migração nova.
2. Configurar armazenamento privado e chave de cifragem já usados pela aplicação. Conferir retenção, credenciais e acesso aos provedores.
3. Iniciar o worker Nexus atualizado; seu poller recupera jobs persistidos. A fila BullMQ existente pode despachar os mesmos jobs com claims protegidos. Não iniciar workers ligados a produção durante testes locais.
4. Definir `NEXUS_AUTOMATION_WORKSPACES` com UUIDs separados por vírgula. Vazio desabilita as ferramentas novas em produção; desenvolvimento é habilitado por padrão. `all` existe para ambientes controlados. O inspetor mostra o motivo quando a atualização, ativação ou capacidade multimodal está ausente.
5. Criar novos rascunhos, configurar modelos, releases, credenciais e contratos; executar os cenários de homologação antes de disponibilizar as operações ao workspace.

## Validação

- Regressão de catálogo, contratos, validação, executor, Studio, layout, anexos, portabilidade, assinaturas e editor: **504 testes passaram**. Inclui preservação da versão nas retomadas gerenciadas, bloqueio de mensagens durante aprovação/lotes/eventos e expiração de espera por mensagem após reinício.
- PostgreSQL 16 descartável, exclusivamente em loopback: **24 testes passaram**, cobrindo migração/RLS, isolamento, renovação OAuth, intenção de efeito, orçamento concorrente, checkpoints, espera/eventos, cancelamento, reconciliação, ingresso duplicado de webhook e resposta binária.
- Testes adicionais de credenciais de IA, configuração da plataforma, mídia e continuidade: **53 testes passaram** (incluem suítes presentes na regressão principal; não somar contagens).
- A cadeia API → filtro → download binário → multipart foi executada com persistência real isolada e transporte/S3 simulados. Os testes de mídia verificam o áudio como bytes, sem conversão UTF-8.
- Relatórios locais: `automation-toolbox-tests.json`, `automation-toolbox-postgres-tests.json` e `automation-toolbox-lint.json` na pasta de evidências da tarefa. A prévia de produção usa somente fixtures sintéticas e remove sua rota temporária ao encerrar.
- Build de produção da aplicação e build do worker Nexus concluídos. ESLint de `src`: zero erros e 545 avisos; a revisão final dos três arquivos alterados por último teve zero erros e dois avisos de variáveis não utilizadas já presentes no painel de teste.
- Interface verificada nos temas claro/escuro em 1280×720, 1440×900 e 1920×1080, sem overflow horizontal. Verificados retorno de teste no explorador, expressão `{{input.leads.0.name}}`, fixar/desafixar, preservação de JSON inválido e bloqueio de salvar/publicar, inserção por Enter e drag-and-drop no modo Simples e undo/redo integral (5 → 6 → 5 nodes).
- Desempenho em build de produção, fixtures lineares, viewport 1440×900: uma amostra de quatro segundos por cenário. Pan/zoom em 300 nodes: p95 ativo **7,1 ms**, máximo 14,17 ms; em 500: p95 ativo **7 ms**, máximo 13,9 ms. Arraste em 300: p95 ativo **7 ms**, máximo isolado **69,5 ms**. Respectivamente 35, 35 e 26 frames com mudança de viewport/posição. A medição local atende a meta p95 de 32 ms nestas amostras; não estabelece desempenho de qualquer topologia ou equipamento. Valores completos em `automation-toolbox-performance.json`.
- A prévia sintética usa datas determinísticas para não produzir divergência de hidratação entre servidor e navegador. Capturas em `automation-toolbox-final.png`, `automation-toolbox-{claro,escuro}-{1280,1440,1920}.png` e recibos em `automation-toolbox-ui.json`.
- Revisão final de 25/10/2026: build de produção e worker recompilados, teste de quatro horas nos dois temas e mapeamento por índice confirmados, sem erros/avisos no console do navegador. Evidências adicionais em `automation-toolbox-wait-{claro,escuro}.png` e `automation-toolbox-final-browser.json`. A validação de PostgreSQL isolado foi feita em 24/10/2026; o Docker local estava desligado na revisão final, e nenhum banco da aplicação recebeu a migração.
- Prévia encerrada e rota temporária removida. O typecheck final passou após regenerar os tipos de rotas de desenvolvimento e produção: um cache antigo em `.next/dev/types` ainda importava a rota temporária. Recibo consolidado em `automation-toolbox-verification.json`.

## Homologação real pendente

O usuário indicou o workspace **Dialogy** (`5c3a91e9-b243-4436-80ba-42434bc5ca97`). A inspeção somente de leitura encontrou as credenciais Nexus vazias e a migração nova ainda ausente. O fluxo publicado de triagem e os agentes existentes foram preservados. Não foram enviados áudios nem executadas ações comerciais reais.

Para homologar o robô de vendas ainda faltam: migração/ativação em ambiente autorizado, credenciais protegidas e voz ElevenLabs, API e contrato do catálogo, contato/número de teste autorizado, release do vendedor com mapeamentos e campos/equipe do CRM. Os testes simulados comprovam contratos separadamente; não comprovam homologação ponta a ponta com provedores reais.

Automação de navegador e voz telefônica em tempo real continuam fora do escopo.

## Referências verificadas

- [ElevenLabs: conversão de texto em áudio](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
- [n8n: HTTP](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest), [listas](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches) e [webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook), como referências de produto, preservando os contratos Dialogy.
