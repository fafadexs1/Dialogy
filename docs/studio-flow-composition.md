# Composição de IA do Studio no Flowbuilder

O Studio continua responsável por identidade, regras, procedimentos, integrações e publicação. O Flowbuilder conecta essas versões a dados, especialistas e recursos, e decide como o fluxo continua. O compositor de geração de fluxos da Nexus AI permanece desabilitado.

## Preparação no Studio

Na aba **Flowbuilder**, habilite **Disponibilizar para composição**, escolha os modos permitidos e defina entradas e saídas públicas com nome, tipo, obrigatoriedade e sensibilidade. Exporte os procedimentos reutilizáveis, autorize extensões e estabeleça limites. Salve e publique uma nova versão. A edição de um rascunho não altera contratos já publicados.

O catálogo **IA Studio** oferece as versões ativas e acessíveis do workspace. A escolha grava `agentId` e `releaseId`; uma publicação nova não atualiza os fluxos existentes automaticamente. Versões revogadas e agentes pausados são recusados em execução. Publicação e exclusão de agentes preservam as verificações de dependências, inclusive para as quatro novas operações.

## Blocos

| Operação | Comportamento |
| --- | --- |
| `ai.studio_agent` | Usa uma versão do Studio para conversar ou executar uma tarefa e devolve o controle ao grafo. |
| `integration.studio_procedure` | Executa um procedimento exportado usando o executor de procedimentos existente. |
| `tool.studio_agent` | Oferece um agente como especialista a outro agente, com argumentos e resultado internos. |
| `tool.studio_procedure` | Oferece um procedimento exportado como ferramenta. |
| `tool.subflow` | Executa um fluxo publicado, síncrono e iniciado por gatilho manual como ferramenta. |

`ai.published_agent` conserva seu comportamento anterior de transferência terminal. Importações antigas não são convertidas.

**Conversar e devolver o controle** requer atendimento real em produção. `needs_input` envia a pergunta e suspende a mesma etapa; a próxima mensagem retoma a invocação, com sua versão e seu orçamento acumulado. Uma habilidade pendente mantém a identidade da operação durante a retomada. Entregas confirmadas não são reenviadas por replay.

**Executar tarefa e devolver dados** funciona com gatilhos sem conversa. Entradas obrigatórias ausentes retornam pela porta **Dados ausentes**, sem uma chamada de modelo. Resultados concluídos são projetados no contrato publicado e gravados em `outputKey`, disponível para as próximas etapas. Especialistas e tarefas não enviam mensagens diretamente ao cliente.

As portas de continuação são `completed`, `needs_input`, `handoff`, `close_requested`, `limit_reached` e, quando configurada, `error`. Encaminhamento e encerramento são solicitações: conecte os blocos explícitos correspondentes e suas validações. Uma decisão do modelo não transfere nem encerra o atendimento por si só.

## Recursos e dados

Conecte modelo, ferramentas HTTP/MCP/banco/subfluxo, conhecimento ou memória apenas quando a versão autorizar a extensão. Especialistas também podem receber recursos e outros especialistas. Ciclos são rejeitados e a delegação tem profundidade máxima de quatro invocações, compartilhando os limites do pai. Recursos do Studio continuam fixados na publicação.

O modelo disponível segue a política global de IA já existente na plataforma. A conexão de modelo não contorna essa política nem habilita provedores por conta própria. Memória e RAG usam os adaptadores e os escopos existentes. O conhecimento congelado da publicação usa contexto extrativo limitado, sem consultar versões novas das fontes.

Mapeamentos aceitam variável do fluxo, resultado anterior, entrada inicial e valor fixo. Valores vindos do fluxo precisam ter o tipo declarado; a conversão é explícita para valores fixos. Os caminhos públicos rejeitam sobreposição e chaves inseguras. O inspetor sugere resultados públicos das etapas anteriores. Dados não declarados não são exportados pelo agente ou pela habilidade. Marcas de sensibilidade são preservadas para sanitizar debugger e eventos sem substituir os valores usados pela execução.

No modo tarefa, a mensagem interna e as expressões de tarefa recebem somente os dados públicos mapeados. Os escopos `input`, `current` e `variables` dessas expressões representam esses dados públicos, sem acesso implícito aos demais valores do workflow. A mensagem do cliente é entrada implícita no modo conversa.

## Limites e recuperação

Chamadas de modelo, ferramentas, duração, turnos, escopo de workspace, versões e autorizações são verificados no servidor. Subfluxos recebem somente o orçamento restante; limites locais não alteram a definição publicada. O medidor de créditos existente continua responsável pela cobrança. A interface não inventa contagem de tokens ausente do adaptador de modelo.

Checkpoints de composição são criptografados em `studio_flow_invocations`, inclusive em tarefas sem chat. Revisões otimistas rejeitam checkpoints concorrentes ou posteriores ao cancelamento. Reservas de operações e de entrega são gravadas antes dos efeitos. Uma operação sem confirmação bloqueia repetição automática no mesmo bloco/execução; confira o sistema de destino antes de iniciar uma nova execução. Estados concluídos são preservados no cancelamento. A tabela possui RLS e não é acessível aos papéis de navegador.

Procedimentos reutilizam coleta, validação, decisões, confirmação e integração HTTP/MCP do Studio. Ações nativas disponíveis nesta versão: etiquetas, atualização de CRM e consultas SGP de contratos/painel. Ações de controle do atendimento precisam dos blocos Nexus explícitos. Outros tipos de ação nativa retornam erro claro; envio de imagens e demais ações especializadas não devem ser exportados como habilidades de composição nesta versão. Subfluxos síncronos não aceitam perguntas ou espera por eventos.

## Instalação e validação

Aplique `prisma/migrations/20261023180000_studio_flow_invocations/migration.sql` pelo processo habitual de migrações **antes de ativar esta funcionalidade no ambiente**. Esta alteração prepara a migração; não faz deploy, não aplica alterações ao banco da aplicação e não publica workflows.

Os testes de autoria usam `sandbox: true`: operações externas exigem fixtures explícitas por ID da etapa publicada ou nome da ferramenta. Não executam HTTP/MCP/ações Dialogy reais. O fixture tem o formato `{ "identificador": { "output": { "campo": "valor" } } }`. A retomada preserva as fixtures no contexto da execução. Testes sem fixture retornam erro em vez de produzir efeitos reais.

O painel de testes oferece **Dados simulados de ferramentas e habilidades**, com os identificadores e um modelo JSON editável. Essas simulações são repassadas ao executor e ficam fixadas durante a retomada do teste.

Suítes principais: `tests/studio-flow-contract.spec.ts`, `tests/studio-flow-execution.spec.ts`, `tests/studio-flow-runtime.spec.ts`, `tests/studio-flow-runtime-limits.spec.ts` e `tests/agent-studio-database.spec.ts`. O teste `tests/studio-flow-store-database.spec.ts` exige PostgreSQL descartável em loopback, com banco `studio_flow_fixture` e URL em `STUDIO_FLOW_TEST_DATABASE_URL`; a suíte recusa outros destinos.

A prévia `scripts/preview-workflow-editor.mjs` usa apenas dados sintéticos, sem adaptadores de publicação ou efeitos externos. O exemplo **IA Studio** mostra agente, especialista, modelo e conhecimento; **Configurar Studio** permite revisar o contrato visualmente.

### Evidências de 23/10/2026

- 1.046 testes passaram, sem falhas ou skips, nas suítes de workflows, Nexus, composição e IA Studio. Incluem os seis testes de checkpoint em PostgreSQL descartável e os testes de publicação em PGlite.
- TypeScript e build de produção passaram. O build final usou o banco descartável em loopback. Lint de `src` terminou sem erros; o repositório registra 545 avisos.
- Verificação visual com cobertura dos dois temas e das resoluções 1280×720, 1440×900 e 1920×1080. Na versão compilada: busca de habilidade, inserção pelo teclado, conexão de recurso e undo; seis cards e cinco conexões no exemplo, sem overflow horizontal.
- Amostra de navegação em produção local: 300 operações, viewport 1440×900, quatro segundos, 564 frames totais e 19 ativos; p95 geral 7,1 ms e ativo 13,9 ms. Seis nodes estavam visíveis por virtualização. É uma checagem curta de pan/zoom, não um benchmark exaustivo de arraste ou de todos os tipos de grafo. O exemplo de 500 operações também abriu sem erros no console.
- Não houve chamadas reais de modelo, publicação de workflows em uso ou aplicação da nova migração ao banco da aplicação. Os testes de adapters utilizaram resultados simulados; qualidade das respostas de modelos reais depende de uma validação posterior no ambiente de homologação.
