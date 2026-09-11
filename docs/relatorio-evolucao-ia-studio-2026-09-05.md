# Dialogy: evolução para uma IA generalista, assertiva e economicamente sustentável

Data: 05/09/2026. Natureza: diagnóstico e proposta de arquitetura/produto. Nenhuma alteração de runtime, banco, publicação ou interface foi realizada para este relatório.

## 1. Parecer executivo

**Eu mudaria o Studio, mas não o reconstruiria do zero e não venderia essas mudanças como “AGI”.** O resultado viável é um agente generalista de atendimento, configurável por empresa, que entende linguagem natural, conserva o contexto correto, executa ferramentas autorizadas e só afirma sucesso quando possui evidência.

O maior ganho não virá de um prompt gigante, de guardar todas as conversas ou de colocar vários agentes discutindo cada resposta. Virá de reduzir a distância entre o que o cliente quis, o que o sistema entendeu, o que executou e o que efetivamente aconteceu.

Minha prioridade seria:

1. Fechar a falha de acesso às tabelas identificada na auditoria anterior.
2. Eliminar processamento de memória sem consumidor e controlar contexto por tokens.
3. Consolidar um contrato de execução comum entre Studio, workflow e canais reais.
4. Melhorar a interpretação de cada turno sem perder as validações determinísticas.
5. Transformar o Studio em um lugar onde se configura, testa, explica e acompanha o agente.
6. Só então ampliar autonomia, comparar modelos e introduzir aprendizado supervisionado.

“Generalista” aqui significa transportar as mesmas capacidades entre nichos. Não significa inventar as regras, preços ou procedimentos de uma empresa desconhecida.

## 2. O que existe e o que ainda falta comprovar

Esta análise inspecionou o código local atual. Os resultados de testes citados abaixo vêm das execuções já realizadas nesta conversa; não foram repetidos para redigir o relatório. Não houve nova avaliação paga de modelos nem ensaio no WhatsApp nesta etapa.

| Área | Evidência existente | Limite ou lacuna |
|---|---|---|
| Estado da conversa | Sessão tipada, criptografada e validada por empresa, conversa, agente e contexto de execução | Testes de isolamento não equivalem a segurança de todas as tabelas e APIs |
| Interpretação | Resolução determinística de opções, interpretação semântica, normalização de valores e retomada de procedimentos | A lógica ainda gira em torno de campo/etapa pendente; ampliar flexibilidade exige testes de correções, interrupções e múltiplos dados |
| Studio | Configuração por etapas, procedimentos, fontes, versões, simulação, teste com ações reais e resultados | Falta uma comparação integrada de comportamento, evidência e custo entre versões e caminhos de execução |
| RAG | Busca vetorial e lexical, combinação de resultados, filtros de documentos e caminho de reranking | Ainda há risco de conteúdo reindexado substituir o snapshot publicado; qualidade não foi medida de ponta a ponta em produção |
| Casos anteriores | Reaproveitamento automático foi suspenso no código local, preservando os registros existentes | Geração de resumo e embedding continua conectada ao encerramento; isso não é um sistema de aprendizado seguro concluído |
| Avaliação | Registro anterior de 423 testes automatizados e 18 conectados; correção mais recente com 86 testes direcionados | O teste conectado usa modelo real com dados sintéticos e efeitos de negócio desativados. Não é uma taxa de resolução real |

Os conjuntos de testes se sobrepõem: **não se deve somar esses números como uma única cobertura**. O próprio registro da avaliação conectada documenta variação entre rodadas.

A auditoria anterior desta conversa também confirmou ausência de RLS e permissões amplas nas tabelas de documentos vetoriais e casos. Esse achado continua pendente; não consultei novamente o banco para este relatório. Corrigir o contexto da IA não fecha esse acesso direto.

## 3. O que eu mudaria no funcionamento da IA

### 3.1 Um contrato de turno comum, não três comportamentos parecidos

Já existe um runtime compartilhado. Eu o consolidaria em vez de criar outro motor paralelo.

Cada turno deveria carregar explicitamente: empresa, conversa, mensagem de origem, versão publicada, agente, estado atual, fatos autorizados e ferramentas disponíveis. Studio, workflow e canal real deveriam produzir esse mesmo contrato.

O teste de paridade precisa comparar entradas normalizadas, fatos aceitos, fontes selecionadas e ações propostas. Comparar apenas frases é insuficiente, porque o modelo pode variar a redação sem mudar o resultado.

Também testaria o caminho externo ao modelo: mensagens duplicadas, chegada fora de ordem, mensagens fragmentadas, retomada após reinício do worker, falha de entrega e resultado incerto de ferramenta. São hipóteses de falha a cobrir, não causas novas já comprovadas no atendimento relatado.

### 3.2 Interpretar o turno inteiro, sem deixar o modelo executar livremente

Eu evoluiria gradualmente a interpretação para produzir uma decisão estruturada: intenção, dados candidatos, correções, dúvida, próximo passo permitido e referências às evidências utilizadas.

Exemplo independente de nicho: “Quero a opção básica, para amanhã, mas antes me explica a diferença”. O sistema precisa preservar os dados oferecidos, responder à dúvida e esclarecer o que falta, sem executar a contratação por inferência.

Regras de funcionamento:

- Valor explícito, válido e inequívoco: aceitar sem repetir a mesma pergunta.
- Referência ambígua: fazer uma pergunta curta que resolva a ambiguidade.
- Correção: atualizar o fato e invalidar decisões/confirmacões dependentes daquele fato.
- Dúvida durante coleta: responder e manter a etapa pendente.
- Mudança de assunto: suspender ou encerrar o objetivo anterior de forma explícita.
- Ação com efeito externo: validar autorização, argumentos, pré-condições e confirmação aplicável no código.

Não usaria uma “confiança de 95%” declarada pelo modelo como autorização. Usaria critérios observáveis: opção única, valor válido, fonte aplicável e resultado confirmado.

Saídas estruturadas ajudam a restringir a passagem de dados entre etapas, mas não garantem que os dados estejam factualmente corretos nem eliminam todos os riscos de conteúdo malicioso. [Referência técnica](https://developers.openai.com/api/docs/guides/agent-builder-safety).

### 3.3 Planejamento limitado por objetivo

Manteria procedimentos para operações que exigem ordem, validação e rastreabilidade. Aumentaria a liberdade na conversa, não a liberdade de executar qualquer ferramenta.

O agente poderia escolher entre capacidades autorizadas — consultar, esclarecer, coletar, corrigir, executar, verificar e transferir — com orçamento de chamadas, condição de parada e recuperação definida.

Uma resposta de sucesso deve se apoiar no retorno válido da integração ou em uma leitura de confirmação. Timeout não significa sucesso nem fracasso confirmado; nesses casos, preservar o estado incerto e evitar repetir operações não idempotentes.

## 4. Sim, eu mudaria o Studio

Preservaria “Entender → Resolver → Concluir” como fluxo simples para o usuário. Acrescentaria capacidade de diagnóstico e controles progressivos, sem exigir que o usuário escreva JSON para operar o básico.

| Área do Studio | Mudança proposta | Benefício esperado |
|---|---|---|
| Objetivo e regras | Campos claros para objetivo, critério de conclusão, assuntos atendidos e quando transferir; exemplos de bom e mau atendimento | Menos regras contraditórias e comportamento mais previsível |
| Capacidades | Exibir o que a IA pode consultar, alterar e confirmar; validações e efeitos de cada ação | Autonomia compreensível, sem esconder permissões em prompts |
| Conhecimento | Mostrar versão, origem, validade, indexação e conflitos; prévia do trecho realmente recuperado | Saber por que uma resposta usou uma determinada informação |
| Memória | Separar “desta conversa”, “dados autorizados do cliente” e “conhecimento publicado”; permitir inspecionar/corrigir fatos com controle de acesso | Evitar mistura de contexto e permitir diagnóstico direto |
| Testes | Manter simulação e ações reais; acrescentar reprodução somente leitura de incidentes e suíte salva por agente | Transformar um erro real em teste de regressão |
| Publicação e resultados | Comparar versão candidata com a atual, resultados dos testes, custo, latência e falhas; liberar gradualmente com reversão | Publicar com evidência, não só porque uma conversa de teste pareceu boa |

O painel “Por que respondeu assim?” mostraria fatos observáveis: intenção selecionada, campo pendente, trecho da fonte, regra aplicada, ferramenta chamada e resultado. **Não exibiria raciocínio interno oculto do modelo.**

Os testes com ações reais já existem no código. Eu os ampliaria; não apresentaria sua criação como novidade. A reprodução somente leitura não deve executar ferramentas de escrita nem reenviar mensagens a clientes.

As regras de negócio continuam configuráveis pelo usuário. O produto deve garantir isolamento, autorização, integridade e limites técnicos; não inserir no núcleo regras arbitrárias específicas de um nicho.

## 5. Memória e RAG que eu adotaria

### Memória em três escopos explícitos

1. **Conversa:** fatos, pendências e ações daquela sessão. Manter origem, atualização, sensibilidade e correções. Contexto de execução nunca é compartilhado com outro cliente.
2. **Cliente:** apenas dados duráveis autorizados, recuperados após identificação e checagem de acesso. Não buscar outra conversa só porque o texto é semanticamente parecido.
3. **Empresa:** conhecimento revisado e publicado. É o único espaço destinado a reaproveitamento generalizado.

Um resumo automático de atendimento não deve saltar do primeiro nível para o terceiro. O caminho futuro seria: detectar aprendizado candidato, remover dados privados, revisar, aprovar, versionar e testar antes de publicar. Não habilitaria novamente a busca livre de casos como atalho para “aprender”.

### RAG: recuperar evidência aplicável

Eu priorizaria filtros por empresa, agente, coleção e versão antes do ranking. A identificação do documento deveria incluir sua revisão/hash, não somente um ID estável. Assim, uma reindexação não muda silenciosamente a fonte de uma publicação antiga.

Para conteúdo empresarial, definiria precedência explícita: resultado atual do sistema autorizado, documento publicado vigente e demais fontes permitidas. Havendo conflito, sinalizar a divergência em vez de juntar respostas incompatíveis.

O modelo receberia os trechos relevantes com identificadores e validade. Ausência de evidência exige nova busca justificada ou esclarecimento; não autoriza inventar uma política comercial.

O laboratório RAG inspecionado possui vários cenários de telecomunicações. Eles são úteis como um conjunto especializado, mas não bastam para afirmar funcionamento geral. Acrescentaria capacidades transversais e conjuntos de outros setores, sem trocar um viés por outro.

## 6. Custo: como melhorar sem “queimar tokens”

**A primeira economia é desligar a geração automática de resumos/embeddings de casos enquanto o produto não os utiliza.** Essa mudança ainda não foi feita. Antes de desativar, inventariar consumidores administrativos para preservar algum uso legítimo separado do atendimento.

Hoje o contexto conversacional local usa orçamento em caracteres, variando até 32 mil, e o caminho de resposta com fontes também possui corte em caracteres. As 120 mensagens pertencem ao resumo de caso encerrado. Esses limites não são equivalentes a um orçamento final de tokens, porque instruções, fontes, histórico e resposta se somam.

Eu introduziria um orçamento único por chamada, com reserva para saída e ferramentas, calculado conforme o modelo ativo e a complexidade. O conteúdo prioritário seria:

- Regras aplicáveis e objetivo atual.
- Fatos confirmados e correções da sessão.
- Trocas recentes necessárias para entender a referência do cliente.
- Evidências recuperadas para a pergunta atual.

O histórico bruto continuaria persistido conforme a retenção definida, mas não seria reenviado integralmente. Compactação só quando necessária, preservando origem dos fatos e sem transformar suposições em verdade.

Usaria processamento proporcional:

- Entrada inequívoca e validável: código, sem chamada adicional de classificação.
- Pedido comum: modelo principal configurado e somente o contexto necessário.
- Ambiguidade ou tarefa complexa: mais contexto/raciocínio ou modelo alternativo autorizado, se o ganho for demonstrado.
- Resultado incerto de ação: verificação operacional, não várias chamadas tentando adivinhar.

Não escolheria automaticamente o modelo mais caro nem substituiria os modelos cadastrados na empresa. Compararia os disponíveis com o mesmo conjunto de tarefas, medindo qualidade, latência e custo.

Reduzir chamadas sequenciais redundantes e evitar usar LLM para tarefas determinísticas são estratégias documentadas de otimização. A aplicação deve ser medida no fluxo real. [Referência técnica](https://developers.openai.com/api/docs/guides/latency-optimization).

Sem volume de atendimento e tarifas verificadas dos provedores ativos, não há estimativa monetária honesta. Eu mediria custo por atendimento efetivamente resolvido, incluindo retries e tarefas de fundo, não apenas custo por resposta.

## 7. Como provar que melhorou

Criaria uma suíte versionada a partir de incidentes reproduzidos, exemplos sintéticos e casos revisados por pessoas. Separaria o conjunto usado para ajustes do conjunto final de avaliação, com repetições para capturar variabilidade.

Cobertura mínima: escolhas curtas, atributos de opções, múltiplos dados, correções, interrupções, negação, fontes contraditórias, ausência de informação, tentativas de acessar outro cliente, notas privadas, reinício de sessão, ferramentas lentas e mensagens duplicadas.

Cada caso deve verificar comportamento, não uma frase exata:

- O dado correto foi aceito sem pergunta redundante?
- A fonte era autorizada e da versão certa?
- O efeito externo ocorreu uma única vez e foi confirmado?
- Houve transferência com contexto quando necessário?
- Houve acesso indevido ou afirmação sem suporte?
- Quantas chamadas, tokens e tempo foram necessários?

Uma versão só avança se não apresentar regressão nas proteções críticas e demonstrar ganho no conjunto independente. Depois, teste controlado no canal e liberação gradual. Zero vazamentos observados no teste é um critério de aprovação, não uma garantia matemática de ausência de falhas.

Em produção, distinguir “procedimento concluído”, “ticket encerrado”, “resolução confirmada” e “reabertura”. O Studio já faz parte dessa distinção; deve preservá-la para não produzir uma taxa de sucesso artificial.

Avaliações específicas da tarefa, alimentadas por casos reais e calibradas com revisão humana, são mais úteis do que julgar que o agente “parece inteligente”. A decisão de adicionar múltiplos agentes também deveria partir dessas avaliações. [Referência técnica](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## 8. Ordem de execução recomendada

As etapas abaixo são prioridades, não promessa de prazo ou autorização para execução.

| Etapa | Trabalho | Condição para avançar |
|---|---|---|
| P0 — proteção e desperdício | Corrigir acesso ao banco; revisar geração de casos sem consumidor; registrar orçamento/uso por chamada | Testes de acesso permitido/negado e confirmação de que o processamento dispensável deixou de ocorrer |
| P1 — paridade e observabilidade | Contrato comum de turno, rastreamento por mensagem/versão e reprodução segura de incidentes | Mesmo caso produz fatos e ações equivalentes nos caminhos suportados |
| P2 — conversação e conhecimento | Interpretação mais completa do turno, correções com invalidação de dependências e RAG com revisão imutável | Ganho em casos independentes, sem regressão de isolamento e execução |
| P3 — Studio orientado à qualidade | Painéis propostos, suíte por agente, comparação e publicação gradual | Usuário consegue localizar a causa de um erro e validar uma melhoria sem investigar SQL |
| P4 — evolução supervisionada | Aprendizados candidatos revisados, comparação de modelos e autonomia progressiva | Ganho de resolução confirmado com custo e risco aceitáveis |

Eu não começaria por fine-tuning, enxame de agentes, memória global, aumento indiscriminado de contexto ou reescrita completa. Nada disso corrige sozinho um contrato de execução inconsistente, uma fonte errada ou uma operação sem confirmação.

## Conclusão

**A Dialogy precisa de um agente que se adapte na conversa e seja rigoroso na execução.** O Studio deve facilitar definir o resultado esperado, testar cenários reais e enxergar a evidência do atendimento. Minha escolha é evoluir essa base, com medidas observáveis de qualidade, em vez de perseguir o rótulo “AGI”.

### Evidências locais principais

- [Sessão e isolamento](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/session-store.ts:12>).
- [Contrato e contexto do runtime](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/runtime.ts:19>).
- [Orçamento atual de contexto](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/conversation-context.ts>).
- [Interpretação de coleta](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/agent-studio/collection-interpreter.ts>).
- [Modos de teste existentes](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/components/autopilot/studio-conversation-preview.tsx:17>).
- [Resultados existentes no Studio](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/components/autopilot/studio-results.tsx>).
- [Bloqueio local de casos entre conversas](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/rag/retrieval.ts:206>).
- [Geração de casos ainda conectada ao encerramento](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/actions/chats.ts:988>).
- [Precedência atual do conteúdo vetorial sobre o snapshot](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/rag/hybrid-retrieval.ts:272>).
- [Cenários atuais do laboratório RAG](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/src/services/rag/evaluation.ts>).
- [Registro e limites da avaliação conectada](</C:/Users/fabri/Desktop/Dialogy-apps/Conexão/Dialogy/docs/agent-studio-validation-2026-09-05.md>).

As referências oficiais foram usadas para orientar avaliação, controle do fluxo de dados e custo. Não implicam recomendação de migrar a Dialogy para um provedor específico nem de adotar um produto hospedado de construção de agentes.
