# Plano completo — Estúdio de Agentes de IA

Data: 27/08/2026. Status: implementação autorizada e em andamento. A autorização não inclui publicação ou migração de produção. Evidências atuais e pendências estão em `STATUS-estudio-agentes-ia.md`.

## 1. Objetivo e limites

Criar uma experiência na qual uma pessoa consiga ensinar como sua empresa atende, configurar procedimentos, testar uma conversa e publicar um agente reutilizável sem montar um grafo técnico.

Decisões solicitadas pelo usuário:

1. O redesign é exclusivo do construtor de agentes de IA.
2. O agente terá uma jornada vertical, baseada na referência visual escolhida, com procedimentos abertos em página interna.
3. Não haverá modo canvas nem alternância de modo no construtor de agentes.
4. O fluxo normal preservará seu visual e sua forma de trabalho.
5. No fluxo normal, será possível selecionar um agente previamente configurado e publicado, usando o padrão visual do bloco existente.
6. Procedimentos precisam incluir explicitamente coleta de dados, chamada de API e ferramenta MCP.
7. A complexidade interna deve ficar no sistema; opções de negócio precisam ser compreensíveis.

Este documento define o resultado a construir. Não afirma que o código atual já o entrega. Exclusão de agentes, alteração de dados de produção, publicação de agentes e chamadas externas reais não estão autorizadas por este plano. A implementação deverá ser iniciada após solicitação explícita.

## 2. Dois construtores, duas formas de pensar

| Superfície | O que a pessoa planeja | O que fica visível |
| --- | --- | --- |
| Estúdio de Agentes | Como atender e resolver solicitações | Jornada, conhecimento, procedimentos, regras e conversa de teste |
| Fluxo normal | Uma automação com sequência e condições explícitas | O canvas, catálogo, blocos, conectores e inspetor atuais |

O Estúdio publica um agente. O fluxo normal chama esse agente por referência a uma versão publicada. Não copia seus procedimentos nem abre o Estúdio dentro do canvas.

Compartilhar autenticação, armazenamento de credenciais ou serviços de execução não implica compartilhar a interface. O motor do agente não dependerá de coordenadas, portas ou fios desenhados pelo usuário.

## 3. Experiência do início ao fim

1. A pessoa acessa Agentes de IA e escolhe Novo agente.
2. Informa nome, objetivo, idioma e área de atendimento. Pode começar vazio ou selecionar um modelo claramente identificado como exemplo.
3. Configura como o agente entende o cliente e quais dados iniciais são necessários.
4. Seleciona as fontes de conhecimento e cria os procedimentos que ele pode executar.
5. Define conclusão, transferência e limites.
6. Testa o rascunho em uma conversa isolada, com integrações simuladas por padrão.
7. Resolve as pendências indicadas pelo sistema e publica uma versão.
8. Usa o agente no canal disponível ou o seleciona no bloco de agente do fluxo normal.
9. Consulta resultados reais, identifica falhas, altera um novo rascunho e publica outra versão.

Um agente novo começa inativo e sem procedimentos publicados. Exemplos nunca aparecerão como processos reais de um agente existente.

## 4. Organização visual do Estúdio

A referência é a imagem escolhida com barra superior escura, biblioteca à esquerda, jornada clara no centro e prévia da conversa à direita.

- Navegação superior: Fluxo, Aparência, Regras e Resultados.
- Ações globais: status do salvamento, Testar, Publicar e histórico de versões.
- Biblioteca contextual: etapas disponíveis para o ponto que a pessoa está editando.
- Centro: jornada principal ou procedimento aberto, nunca os dois competindo pelo mesmo espaço.
- Direita: prévia visual ou teste, com indicação explícita de qual modo está ativo.

Não haverá minimapa, zoom de canvas, portas, conexões arrastáveis ou identificadores internos na experiência comum. Os controles de reordenação deverão funcionar com mouse e teclado; uma alça decorativa não basta.

Em telas menores, a conversa abre em painel ou aba própria. Não comprimir três colunas até tornar os campos ilegíveis. Nenhum botão será exibido como funcional se a ação correspondente ainda não estiver disponível.

## 5. Jornada principal: três etapas de negócio

### 5.1 Entender o cliente

Configura boas-vindas, identificação da necessidade, informações iniciais, uso permitido do contexto recebido e resposta fora do escopo.

A saudação ocorre no início da sessão, não a cada mensagem. Dados iniciais globais devem ser realmente necessários a todos os atendimentos; dados específicos ficam no respectivo procedimento.

O agente identifica informações já disponíveis, valida sua adequação e pergunta somente o que faltar. Quando houver ambiguidade, pede esclarecimento. Não escolhe silenciosamente um cadastro ou contrato entre vários.

### 5.2 Resolver com IA

Duas áreas distintas:

- Conhecimento: documentos, coleções e outras fontes autorizadas.
- Procedimentos: processos que o agente pode executar, apresentados por nomes de negócio.

O agente escolhe um procedimento compatível com a solicitação; a lista não significa executar todos em sequência. A seleção considera exemplos de uso, contexto, exclusões e prioridade. Se duas opções forem plausíveis, pergunta ao cliente.

Sem procedimento compatível, consulta conhecimento somente se permitido. Caso contrário, esclarece o pedido ou oferece transferência. Não inventa uma operação para atender uma intenção sem capacidade configurada.

### 5.3 Concluir o atendimento

Define confirmação da solução, mensagem final, continuidade da conversa e transferência. Concluir um procedimento não significa necessariamente fechar o atendimento.

Resultados internos distintos: resolvido, aguardando informação, transferido e falha. Esperar uma resposta mantém a sessão; não deve gerar encerramento ou transferência indevida.

A transferência usa uma equipe existente por identificador, leva resumo e dados permitidos, registra o motivo e encerra a atuação automática naquela sessão conforme a política do canal. Se a equipe estiver indisponível, aplica a política de fila ou fora do horário, sem prometer atendimento imediato.

## 6. Procedimentos: unidade principal de configuração

Ao selecionar um procedimento, abre-se uma página interna com breadcrumb Agente → Fluxo → Nome do procedimento, preservando o acesso ao teste.

Cabeçalho editável:

- Nome e descrição.
- Objetivo e resultado esperado.
- Quando usar: exemplos de solicitações e condições de elegibilidade.
- Quando não usar: exclusões e limites.
- Prioridade para conflitos entre procedimentos.
- Situação: incompleto, pronto para teste ou incluído em uma versão publicada.

O corpo é uma sequência vertical. A pessoa pode adicionar, editar, duplicar, excluir e reordenar etapas. Ao excluir uma etapa que fornece dados usados depois, o sistema mostra as dependências e pede remapeamento; não deixa referências silenciosamente quebradas.

| Etapa | Configuração visível | Responsabilidade do sistema |
| --- | --- | --- |
| Enviar mensagem | Texto e conteúdo suportado pelo canal | Entrega, formato e registro |
| Coletar dados | Campos, perguntas e validações | Extração, normalização, armazenamento e retomada |
| Consultar conhecimento | Fontes e objetivo da consulta | Busca restrita e rastreabilidade da resposta |
| Validar informação | Campo e regra de negócio | Avaliação determinística da regra |
| Chamar API | Conexão, operação, entradas e resultados | Autenticação, rede, limites e auditoria |
| Usar ferramenta MCP | Servidor, ferramenta e parâmetros | Contrato, permissões e execução controlada |
| Executar ação Dialogy | Ação existente e seus campos | Autorização e execução pela infraestrutura atual |
| Verificar condição | Campo, comparação e caminhos | Escolha de uma saída válida |
| Responder | Mensagem e dados que pode utilizar | Formatação e proteção contra resposta sem suporte |
| Transferir | Equipe, mensagem e contexto | Encaminhamento e suspensão da IA |
| Concluir procedimento | Resultado e próximo comportamento | Retorno ao agente ou ao fluxo chamador |

Somente capacidades efetivamente implementadas aparecem como disponíveis. O catálogo de ações nativas vem do backend, não de nomes exemplificativos sem executor.

## 7. Coleta de dados completa

Cada campo tem identificador estável interno, nome humano, tipo, pergunta, obrigatoriedade, origem permitida, regra de validação, mensagem de correção e limite de tentativas.

Tipos previstos: texto, número, moeda, data, horário, e-mail, telefone, CPF, CNPJ, CEP, URL, escolha única, múltipla escolha, sim/não e arquivo. Arquivos dependem do suporte do canal, limites de tamanho e validação de formato; não serão tratados como texto comum.

Comportamento:

1. Procurar o valor no contexto permitido e nos dados já coletados.
2. Distinguir informação informada pelo cliente de informação confirmada por uma consulta autenticada.
3. Validar e normalizar conforme o tipo, sem concluir que CPF válido prova identidade.
4. Perguntar somente se o dado estiver ausente, inválido ou precisar de confirmação.
5. Aceitar vários campos na mesma mensagem quando for possível identificá-los com segurança.
6. Permitir correção pelo cliente; invalidar resultados dependentes do valor alterado.
7. Depois do limite de tentativas, seguir a alternativa configurada.

Um dado coletado fica disponível em um seletor visual, por exemplo “CPF do cliente”. Renomear o rótulo não quebra referências. Campos sensíveis ficam mascarados em telas e logs; o prazo de retenção e o acesso são políticas do sistema, não uma promessa genérica de conformidade legal.

Regras simples usam controles guiados, como intervalo numérico e opções permitidas. Expressões regulares, se oferecidas a administradores, precisam de limites contra avaliações excessivamente caras.

## 8. Conexões e chamadas de API

### 8.1 Conexão segura

É cadastrada separadamente por alguém com permissão de administrar integrações: nome, endereço base, autenticação, ambiente e política de acesso. O usuário do procedimento seleciona a conexão sem ver seu segredo.

Suporte inicial planejado: sem autenticação, chave de API, bearer token e Basic sobre HTTPS. Cabeçalhos secretos usam armazenamento seguro, não texto salvo no procedimento. OAuth exige um ciclo completo de autorização, renovação e revogação; não será oferecido como uma opção aparentemente pronta sem esse ciclo implementado.

Credenciais ficam criptografadas no backend e limitadas ao workspace e à origem autorizada. Rotação de segredo não obriga reescrever todos os procedimentos. Alterar destino, permissões ou identidade da conexão exige revalidação dos consumidores.

### 8.2 Etapa Chamar API

Configuração guiada:

1. Nome de negócio, por exemplo “Consultar faturas”.
2. Conexão e operação: método e caminho do endpoint.
3. Dados enviados: nome do parâmetro, localização — caminho, consulta, cabeçalho não secreto ou corpo — e origem do valor.
4. Resultados aproveitados: selecionar campos da resposta e dar nomes compreensíveis.
5. Comportamento em sucesso, ausência de resultado e falha.

As origens podem ser dados coletados, propriedades autorizadas do contato, entrada do fluxo normal, saídas de etapas anteriores ou valor fixo. Objetos, números, listas e booleanos mantêm o tipo; não transformar tudo em string.

Após um teste ou exemplo de resposta, a pessoa escolhe visualmente os campos que quer usar: “Lista de faturas”, “Identificador da fatura”, “Link do documento”. JSON e caminhos técnicos ficam em configuração avançada para quem precisa definir uma integração nova.

### 8.3 Política de execução

- Não permitir que uma URL absoluta ou um caminho iniciado por `//` troque o destino de uma conexão e leve sua credencial para outro host.
- Restringir destinos, validar DNS e manter o endereço validado na conexão de rede; cobrir IPv4, IPv6 e redirecionamentos.
- Bloquear acesso indevido a redes internas e serviços de metadados.
- Limitar duração total, tamanho da resposta, paginação e número de chamadas.
- Validar entradas, cabeçalhos e formato da resposta no servidor.
- Diferenciar falha de autenticação, limite de uso, indisponibilidade e resultado vazio.
- Repetir automaticamente apenas quando seguro. Operações de escrita precisam de idempotência ou tratamento explícito de resultado desconhecido.
- Um timeout não prova que uma operação de escrita falhou; evitar executar novamente e duplicar o efeito.

O agente não escolhe livremente URLs a partir da conversa. Ele executa as operações autorizadas no procedimento publicado.

## 9. MCP como etapa de primeira classe

### 9.1 Conectar um servidor

O administrador configura nome amigável, transporte suportado, endpoint e autenticação. A interface valida a conexão, descobre as ferramentas e mostra disponibilidade e última sincronização.

Transportes de rede dependem do cliente MCP efetivamente suportado. Execução local via stdio não será disponibilizada ao usuário comum; depende de política administrativa explícita e ambiente apropriado. O navegador nunca recebe segredos ou comandos internos do servidor.

### 9.2 Selecionar a ferramenta

O usuário adiciona “Usar ferramenta MCP”, escolhe o servidor e uma ferramenta permitida. O nome técnico fica em detalhes; a interface privilegia nome e descrição compreensíveis.

Os campos são gerados a partir do contrato da ferramenta, incluindo obrigatoriedade, tipos, listas, objetos e opções. Para cada campo, escolhe-se um dado disponível ou valor fixo. O servidor valida novamente o payload antes da execução.

A saída gera dados reutilizáveis, assim como a API. Resultados textuais sem estrutura não serão convertidos em objetos arbitrários como se um contrato tivesse sido garantido; será necessário definir extração validada ou usar o texto conforme a capacidade real.

### 9.3 Controle e evolução

- Conectar um servidor não libera todas as ferramentas para todos os agentes.
- Autorizações são verificadas no servidor para workspace, agente, versão e ferramenta.
- Classificação de risco não pode ser reduzida por um campo enviado pelo navegador.
- Ações sensíveis apresentam resumo da operação e exigem confirmação conforme a política.
- Mudança de ferramenta ou argumentos invalida confirmação anterior.
- Descrições e respostas MCP são dados externos, não instruções capazes de alterar as permissões do agente.
- A publicação registra a identidade e o hash do contrato utilizado. Se houver mudança incompatível, a execução falha de forma explicável e solicita revisão; não adapta silenciosamente os argumentos.
- A versão publicada fixa a configuração local. Não congela o comportamento de um servidor externo: mudanças, indisponibilidade e respostas externas continuam possíveis e devem ser rastreadas.

## 10. Dados compartilhados, decisões e caminhos

Cada dado tem identidade, rótulo, tipo, origem, sensibilidade e validade. Um seletor mostra apenas os valores disponíveis naquele ponto do procedimento.

Dados produzidos somente em um ramo não ficam automaticamente disponíveis em outro. O editor exige uma alternativa ou tratamento de ausência. Excluir, mover ou alterar a saída de uma etapa revalida todos os consumidores.

Decisões simples usam campo + operador + valor: “Quantidade de faturas é maior que 1”, “Pedido existe”, “Consulta terminou com sucesso”. Uma decisão tem alternativas visuais aninhadas e um caminho padrão obrigatório. Não usa JavaScript digitado pelo usuário.

Quando a decisão exigir interpretação linguística, ela será identificada como decisão da IA e terá saídas limitadas, tratamento de incerteza e registro da escolha. Comparações financeiras e validações exatas continuam determinísticas.

Laços só são permitidos por mecanismos limitados, como tentar outro dado até três vezes. A validação rejeita ciclos ilimitados e caminhos sem conclusão ou espera explícita.

## 11. Exemplo de referência: segunda via

Condição de uso: cliente solicita uma nova via de uma fatura. Não usar para contestação ou negociação de dívida.

1. Coletar CPF/CNPJ se ainda necessário; aplicar a verificação de acesso exigida pelo serviço.
2. Chamar a API configurada para consultar faturas.
3. Guardar “Lista de faturas” e “Quantidade de faturas”.
4. Se nenhuma: explicar e oferecer correção ou transferência.
5. Se uma: selecioná-la. Se várias: apresentar opções seguras e coletar a escolha.
6. Chamar a ferramenta MCP configurada para obter o documento, usando o identificador escolhido. Essa etapa poderia também ser uma API; não é obrigatório misturar os dois mecanismos.
7. Guardar o resultado validado como “Documento da fatura”.
8. Entregar pelo canal suportado e perguntar se resolveu.
9. Em falha: informar a indisponibilidade e seguir a alternativa configurada, sem afirmar que o documento foi gerado.

Esse procedimento será um modelo opcional, inicialmente em rascunho. Não pode ser publicado até ter conexões, entradas, saídas e caminhos configurados.

## 12. Aparência, regras e conhecimento

Aparência: nome exibido, avatar e personalização suportada por canal, com prévia imediata. O tom de voz pertence a uma configuração única de comportamento; não haverá controles duplicados e contraditórios em abas diferentes.

Regras: escopo, assuntos proibidos, dados que não devem ser solicitados, confirmações, tentativas, transferência, horário com fuso e dias de funcionamento, comportamento fora do horário e limites de uso. Políticas obrigatórias do sistema não podem ser desativadas no editor.

Conhecimento: selecionar fontes reais, acompanhar processamento e apresentar falhas de ingestão. Publicar fixa as revisões de conteúdo autorizadas para aquela versão. Editar um documento cria nova revisão, sem alterar retrospectivamente a resposta de uma versão antiga por mudança silenciosa do índice.

Remoção de conteúdo por segurança ou privacidade é uma exceção administrativa rastreada: pode tornar versões indisponíveis, nunca manter conteúdo proibido apenas para preservar reprodução histórica.

Configuração de modelo, limites técnicos e provedores fica em área administrativa, com acesso apropriado. Simplificar a interface não significa remover os controles operacionais necessários.

## 13. Rascunho e colaboração

Autosave com atraso curto após edição e indicadores: alterações não salvas, salvando, salvo, conflito e falha. Rascunhos incompletos podem ser salvos; somente a publicação exige todas as condições operacionais.

Cada escrita informa a revisão lida. O servidor compara a revisão antes de salvar. Duas abas não podem sobrescrever silenciosamente o trabalho uma da outra. Em conflito, preservar a edição local e oferecer recarregar ou reconciliar.

Alterar o documento marca imediatamente “Há alterações não publicadas”. Salvar não altera o atendimento em produção. Navegar com gravação pendente exibe proteção contra perda de alterações.

## 14. Testar sem confundir prévia com execução

Três estados explícitos:

1. Prévia visual: exemplo de aparência, identificado como exemplo, sem afirmar execução.
2. Simulação do rascunho: percorre a lógica real com respostas externas simuladas e editáveis.
3. Teste de integração: chamada externa real, mediante permissão e confirmação explícita; usar ambiente de testes quando disponível.

Simulação e produção compartilham validação, mapeamento de dados e decisões. O adaptador de efeitos externos muda, não a lógica do procedimento. Mensagens fixas e timers de interface não são evidência de execução.

A conversa de teste usa uma sessão isolada. Não envia mensagens a clientes, não altera atendimentos reais e não salva dados simulados no CRM. Mostra procedimento escolhido, etapa atual, dados ainda necessários, resultados e motivo de falha em linguagem de negócio.

Testes reais indicam destino, operação e possíveis efeitos antes da confirmação. Respostas são sanitizadas; credenciais não aparecem. “Testar conexão” verifica conectividade/autenticação sem executar indiscriminadamente uma ferramenta com efeitos.

Cenários obrigatórios: dados completos, incompletos e inválidos; vários resultados; nenhum resultado; falha/timeout; mudança de assunto; pedido de humano; cancelamento de confirmação; limite de tentativas; retomada após reinício; mensagem duplicada; operação com resultado desconhecido.

## 15. Publicação única e histórico

Checklist obrigatório:

- Objetivo e condições de uso compreensíveis.
- Etapas suportadas e completas, com referências de dados válidas.
- Tipos compatíveis e entradas obrigatórias com origem definida.
- Conhecimento pronto e referenciado por revisão.
- Conexões e ferramentas existentes e permitidas no workspace.
- Tratamento para falha, ausência de resultado e transferência sem equipe disponível.
- Confirmações e limites compatíveis com o risco.
- Caminhos alcançáveis e sem execução ilimitada.
- Evidências de testes exigidos pela política para operações de risco.

Publicação registra uma versão imutável com documento do Estúdio, procedimentos exatos, revisões de conhecimento, capacidades autorizadas, políticas, versão do contrato de execução, autor e data. Não copia segredos para o manifesto.

Sequência técnica proposta:

1. Validar o rascunho e preparar dependências sem executar operações de negócio externas.
2. Abrir transação curta, bloquear a linha do agente e conferir a revisão esperada.
3. Conferir novamente as revisões locais das dependências e impedir publicação com dados obsoletos.
4. Registrar snapshots/referências imutáveis e manifesto, com numeração única.
5. Atualizar o ponteiro da versão ativa e concluir a transação.
6. Se falhar qualquer escrita, manter a versão anterior ativa e o rascunho recuperável.

Chamadas de rede não ficam dentro de uma transação longa. Testes anteriores não garantem disponibilidade eterna; execução sempre revalida as permissões atuais e aplica fallback.

Histórico permite comparar versões e restaurar uma versão para um novo rascunho. Restaurar não reescreve o passado nem publica automaticamente. Revogação de credencial ou permissão prevalece sobre uma versão antiga.

## 16. Contratos e execução

Contratos propostos, a consolidar com os tipos existentes:

- `AgentStudioDocument`: rascunho, revisão, identidade, jornada, procedimentos, conhecimento, aparência e políticas.
- `ProcedureDefinition`: condições de uso, etapas, contratos de entrada/saída e caminhos.
- `DataReference`: identificador estável, tipo, origem e sensibilidade.
- `ConnectionReference`: conexão autorizada sem material secreto.
- `AgentReleaseManifest`: versão imutável e dependências exatas.
- `AgentInvocation`: agente, release fixada, entradas, sessão e resultado.
- `AgentExecutionEvent`: evento auditável com versão, etapa, resultado e dados sanitizados.

Ao receber uma mensagem, o runtime resolve a versão no início da sessão e a mantém durante o atendimento. Carrega contexto permitido, seleciona procedimento, coleta dados, executa etapas autorizadas, persiste o progresso e devolve resposta, espera, conclusão ou transferência.

Uma nova publicação não troca a lógica no meio de uma conversa. Retomadas após falha utilizam o estado persistido e a mesma versão. Eventos repetidos são deduplicados. A execução de ações usa o mecanismo de auditoria/idempotência do produto, não chamadas paralelas sem rastreamento.

Os resultados externos passam por validação e mapeamento antes de alimentar decisões ou mensagens. Instruções em documentos, respostas HTTP ou ferramentas MCP não podem substituir as regras e autorizações do agente.

## 17. Reutilização no fluxo normal, sem redesign

Usar o bloco de agente e o padrão de inspetor existentes. Ajustar somente o necessário para selecionar agente publicado, versão e mapeamento de entrada/resultado.

Ao selecionar o agente, o rascunho do fluxo fixa uma versão específica. Publicar outra versão do agente não altera fluxos já publicados. Uma atualização aparece como aviso; aceitá-la altera o rascunho do fluxo, que precisa ser validado e publicado novamente.

Entrada: mensagem, contexto permitido e campos compatíveis com o contrato do agente. Saída: estado de resolução, dados permitidos e informação de transferência/falha, usando o padrão atual do bloco.

“Aguardando informação” suspende a invocação e retoma a mesma sessão quando a resposta chega; não reinicia o agente nem segue como se tivesse terminado. O adaptador deve ter testes próprios para essa retomada.

Validar workspace, existência e disponibilidade da versão na publicação e na execução. Exclusão de agente exige análise de dependências; referências em fluxos publicados impedem remoção direta sem resolução explícita.

Não redesenhar catálogo, canvas, cores, espaçamentos, conectores ou demais blocos do fluxo normal. Não introduzir procedimentos internos nessa tela.

## 18. Resultados e operação

Mostrar somente métricas calculadas de eventos reais, com período e denominadores definidos: sessões iniciadas, resolvidas, transferidas, falhas e tempo de resolução. Sessões em andamento não contam automaticamente como resolvidas.

Por procedimento: uso, conclusão, coleta que mais falha, integrações indisponíveis e saídas mais frequentes. Sem dados, mostrar estado vazio, não números ilustrativos.

Linha do tempo: solicitação, procedimento escolhido, informação solicitada, ação executada, resultado, confirmação e motivo de transferência. Dados pessoais são mascarados conforme o papel do usuário. Payloads técnicos ficam em observabilidade restrita.

Alertas operacionais: falhas de publicação, dependência revogada, erro de integração, excesso de tentativas, tempo e custo fora da política. Falha de telemetria não deve levar à repetição de uma ação já executada.

## 19. Transição dos agentes atuais

Não apagar agentes, conversas, widgets ou fluxos como uma etapa automática do redesign. Não substituir configurações reais por um modelo de fatura.

1. Inventariar agentes, procedimentos, conhecimento, canais e consumidores existentes.
2. Classificar quais configurações têm conversão sem perda e quais exigem revisão humana.
3. Fazer backup e ensaiar a conversão em ambiente isolado, com relatório de diferenças.
4. Para cada conversão válida, criar rascunho do Estúdio preservando a versão em execução até a publicação validada.
5. Exibir pendências explícitas para recursos que não puderem ser representados. Não omiti-los silenciosamente.
6. Trocar a experiência de autoria para o Estúdio sem oferecer uma alternância de canvas ao usuário.
7. Ativar novas versões de forma controlada, preservando sessões em andamento e rollback operacional.
8. Remover código legado de agentes somente depois de provar que não há consumidores. Não remover o runtime de workflow usado pelo fluxo normal.

Feature flags administrativas podem controlar a implantação, mas não criar um “Modo Canvas” persistente no produto final. Qualquer exclusão definitiva de dados exige escopo e autorização próprios.

## 20. Plano de implementação e evidência por fase

| Fase | Entrega | Evidência necessária para encerrar |
| --- | --- | --- |
| 1. Baseline e inventário | Limites entre Estúdio e fluxo normal; dependências reais | Rotas e importações mapeadas; baseline visual e funcional do fluxo normal |
| 2. Contratos | Documento, dados, procedimentos, manifesto e resultados | Testes de schemas, dependências, tipos e compatibilidade |
| 3. Persistência | Carregar, autosave, conflitos e histórico | Testes com duas revisões concorrentes, isolamento de workspace e restauração |
| 4. Jornada e procedimentos | Três estágios e editor interno fiel à referência | Criar/editar/excluir/reordenar; teclado; telas menores; estados vazios e erros |
| 5. Coleta | Validação, reaproveitamento, correção e privacidade | Cenários de coleta completos, inválidos e retomados |
| 6. API e MCP | Conexões, entradas, saídas, permissões e testes | Testes com serviços controlados; contratos; falhas; ausência de vazamento de segredo |
| 7. Runtime | Procedimentos executados a partir da versão publicada | Conversas completas com ações auditadas, espera, retomada e idempotência |
| 8. Teste e publicação | Simulação fiel e publicação atômica | Falha transacional; testes de risco; versão anterior preservada |
| 9. Ponte com fluxo normal | Agente configurado reutilizável por versão | Versão antiga continua após nova publicação; retomada; atualização manual |
| 10. Resultados | Métricas e linha do tempo reais | Conciliação entre eventos de teste controlado e indicadores exibidos |
| 11. Transição e aceite | Migração ensaiada, regressão e operação | Relatório de conversão, rollback, comparação visual e testes ponta a ponta |

Não estimar prazo fechado antes do inventário: dependências de publicação, conhecimento e runtime podem exigir mais trabalho do que o frontend. Cada fase tem demonstração verificável; build verde sozinho não encerra nenhuma fase funcional.

## 21. Matriz de aceite final

| Requisito | Como comprovar |
| --- | --- |
| Agentes sem canvas | Percorrer todas as entradas de criação/edição e rotas antigas; nenhuma oferece o editor técnico |
| Fluxo normal preservado | Comparação visual no mesmo viewport/estado e regressão funcional do editor existente |
| Configuração compreensível | Pessoa representativa cria um procedimento sem digitar identificadores internos; registrar dificuldades |
| Coleta funcional | Reutilização, validação, correção, máscara e limite exercitados no runtime |
| API funcional | Mapear entrada tipada, receber saída, decidir e responder; falha controlada segue alternativa |
| MCP funcional | Descoberta, parâmetros, permissão, confirmação, saída e mudança de contrato testados |
| Rascunho isolado | Editar não muda produção; conflito entre abas não perde dados |
| Publicação única | Falha injetada não deixa versão parcialmente ativa; nova versão tem dependências exatas |
| Versão executada corretamente | Identificador do manifesto observado no início, nas ações, na retomada e no resultado |
| Agente reutilizável | Fluxo normal chama versão fixada e recebe resultado/espera sem copiar procedimentos |
| Simulação honesta | Interface distingue exemplo, simulação e chamada real; nenhum efeito externo sem autorização |
| Segurança | Testes de acesso cruzado, credenciais, destino HTTP, permissões e conteúdo externo não confiável |
| Resultados reais | Métricas correspondem a eventos conhecidos; ausência de eventos produz estado vazio |
| Migração sem perda | Comparação de configurações antes/depois e recuperação ensaiada, sem exclusão implícita |
| Acessibilidade | Navegação por teclado, foco, rótulos, contraste e layout menor verificados |

O aceite técnico deve incluir testes unitários, integração com banco isolado e serviços externos controlados, e testes de interface. Smoke tests em integrações reais exigem autorização e não substituem a suíte reproduzível.

## 22. Estado observado antes da implementação (registro histórico)

Inspeção local, sem executar chamadas de API/MCP nem publicar configurações:

- Já existem tipos de coleta, HTTP e MCP em `src/services/agent-studio/types.ts` e uma implementação parcial do Estúdio.
- `src/actions/agent-studio.ts` grava documento e manifesto em snapshots. A busca por esses identificadores em `src` encontrou referências apenas nesse arquivo; não há evidência suficiente de que o runtime consuma a publicação nova.
- O componente `src/components/autopilot/ai-agent-journey-studio.tsx` contém resposta de teste via timer e um rótulo fixo de etapa executada. Isso não comprova teste real do procedimento.
- A rota `/nexus/flows/[id]` continua apontando para `StandaloneNexusFlowEditor`; a rota antiga de agente `/nexus/[id]` redireciona para `/autopilot/[id]`.
- Há alterações preexistentes não commitadas. Esta revisão não as removeu nem as considerou aprovadas.

Consequência: o projeto possui trabalho parcial aproveitável, mas não pode ser declarado pronto com base em aparência, schemas ou compilação. As fases e evidências acima continuam necessárias.

## 23. Aprovação e acompanhamento

O usuário autorizou a implementação e pediu continuidade até a conclusão. O escopo deste plano permanece integral. O acompanhamento atualizado está em `STATUS-estudio-agentes-ia.md`; o registro da seção 22 não descreve o estado atual. Exclusões e operações reais em produção continuam dependendo de autorização própria.
