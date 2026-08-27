# Universal Agent Runtime

Esta camada adiciona um contrato comum ao autopilot, aos workflows e aos procedimentos existentes. O runtime legado continua sendo o executor de cada turno; o estado universal registra o objetivo, o plano, a continuidade e as evidências necessárias para retomar a execução sem tornar o núcleo dependente de um setor.

## Neutralidade por arquitetura

`UNIVERSAL_AGENT_CORE` é o contrato operacional invariável. Sem um pacote publicado, a IA opera em modo neutro: não presume setor, produto, processo, política ou ferramenta. Exemplos e histórico podem orientar linguagem, mas nunca criam fatos do negócio.

`buildUniversalAgentRuntimeContext` monta o contexto efetivo de cada turno com apenas quatro fontes: pacote publicado, tarefa persistida, ferramentas autorizadas para o turno e identidade explícita do agente. Esse contexto chega ao auto-responder em todas as etapas, inclusive depois de uma ferramenta. O antigo `knowledgeBase` permanece como compatibilidade secundária e não é mais promovido automaticamente a identidade do negócio.

Regras determinísticas de roteamento também não usam mais nomes ou palavras-chave de telecom. Transferências por domínio dependem dos times, palavras-chave e políticas configurados no workspace.

## Fluxo de execução

1. `startOrchestratorRun` cria ou reutiliza uma `agent_task_executions` ativa por workspace/conversa.
2. O auto-responder pode produzir um `taskPlan` interno para objetivos de várias etapas, com etapa atual, próximas etapas, entradas ausentes, confirmação e critérios de conclusão.
3. O plano vira um checkpoint `agent_task_plan`; objetivo, próxima ação e último plano ficam persistidos na tarefa.
4. Eventos de intenção, procedimento, RAG e validação também viram checkpoints.
5. Cada resultado de ferramenta registrado pelo orchestrator vira um checkpoint `tool_execution` e atualiza o último resultado conhecido da ferramenta.
6. O modelo pode avançar trabalho seguro, pedir somente dados bloqueantes e retomar o plano em outro turno. Ele não pode declarar a tarefa concluída sozinho.
7. Estados terminais são controlados pelo motor determinístico e por evidência: transferência vira `handoff`, fechamento confirmado vira `completed` e erro do run vira `failed`.
8. Interrupções paralelas usam `pushAgentTaskInterruption`/`resolveAgentTaskInterruption`; a pilha fica separada do procedimento principal.

## Pacotes de domínio

`AgentDomainPack` é versionado por workspace, slug e versão. Um pacote publicado é imutável e há no máximo uma versão publicada por slug. O construtor existente pode ser compilado com `compileAutopilotConfigToDomainPack`; a action `compileAutopilotConfigDomainPackAction` cria um rascunho para revisão. A compilação separa identidade, objetivos, conhecimento, ferramentas, processos, políticas e estilo de resposta. Depois da publicação, associe-o ao autopilot com `linkAgentDomainPackToAutopilotAction`.

O runtime só aceita como pacote ativo uma versão publicada. A associação é feita em `autopilot_configs.agent_domain_pack_id`, portanto a troca de nicho acontece por configuração, não por ramificações no núcleo.

O editor de autopilot expõe esse fluxo na aba `Contexto da IA`. O cockpit prioriza linguagem humana e mostra:

- índice visual de clareza;
- identidade explícita do negócio;
- fontes de conhecimento, capacidades, processos e políticas;
- mapa de prontidão da versão;
- publicação e ativação em um único fluxo guiado;
- explicação da execução e retomada de tarefas complexas.

O JSON compilado continua disponível somente em `Ver detalhes técnicos`, para auditoria.

## Ferramentas

`authorizeAgentToolCapability` é o gateway determinístico. Ele valida catálogo, escopo habilitado, schema obrigatório, slots, intenção quando disponível, risco, confirmação e aprovação humana. O executor continua sendo `runAgentTools`; o modelo não chama ferramentas diretamente.

## Memória e conhecimento

As camadas de memória ficam em `agent_memory_entries`: contexto do turno, estado operacional, fatos do contato, conhecimento documental e memória episódica. `mergeAgentMemory` preserva conflitos explicitamente e não transforma memória episódica em autorização.

O RAG híbrido existente continua responsável por busca vetorial, textual, filtros de workspace/escopo, validade e reranking. Agora também retorna `provenance`, com referências estáveis dos documentos. Estoque, saldo, pedido, contrato, pagamento e outros fatos operacionais devem continuar vindo de ferramentas oficiais; `validateAgentAnswerGrounding` bloqueia uma alegação operacional sem resultado confirmado.

## Observabilidade e avaliação

Os eventos do orchestrator, planos, chamadas de ferramenta, ledger de decisões, checkpoints e referências do RAG compõem o trace. `summarizeAgentTrace` normaliza estágios, ferramentas, bloqueios, evidências, violações e latência. `REFERENCE_AGENT_EVALUATION_SCENARIOS` cobre e-commerce, telecom, financeiro, saúde, educação, hospitalidade e pedidos ambíguos sem domínio. Os cenários podem exigir profundidade mínima de plano e proibir suposições de outros setores; resultados podem ser persistidos em `agent_evaluation_runs`.

## Banco

Aplicar a migration `20260811140000_universal_agent_runtime` no ambiente alvo antes de ativar a associação de pacotes. A migration habilita RLS nas tabelas novas e mantém a autorização de workspace também na camada server-side.
