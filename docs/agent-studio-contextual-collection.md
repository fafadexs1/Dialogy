# Coleta contextual independente de segmento

O comportamento é compartilhado por Studio e atendimento publicado. Não cria nem treina um modelo e não representa AGI. A interpretação usa o modelo fixado na publicação e o catálogo configurado pela empresa, sem regras específicas de segmento.

## Decisão e autoridade

1. Respostas explícitas a opções passam pelo resolvedor determinístico, sem chamada adicional de IA.
2. Dúvidas preservam a etapa e usam somente as fontes autorizadas da publicação e as opções disponíveis.
3. Respostas ainda não reconhecidas em campos `single_select` não sensíveis passam por uma interpretação semântica limitada a uma chamada por campo/turno. Texto e campos estruturados também distinguem resposta, dúvida e mudança de assunto sem permitir que o modelo invente valores.
4. O modelo retorna um identificador permitido: opção, dúvida, ambiguidade ou outra solicitação. Não retorna valores de integração, ferramentas ou ações.
5. Uma opção inferida vira proposta separada de `values` e `sessionFacts`. Só uma confirmação explícita permite validar e armazenar a escolha. Uma resposta explícita diferente substitui a proposta.
6. A proposta expira após dez minutos. O rótulo publicado e o valor tipado da integração precisam continuar iguais. Alterações ou expiração exigem nova escolha.
7. Confirmar a escolha não confirma operações com efeitos. Permanecem as verificações de publicação, autorização, confirmação da ação, persistência e idempotência.

Cancelamento e pedido explícito de atendimento humano têm prioridade. Outra solicitação passa pelo roteamento e pela confirmação de mudança existentes. Falhas de interpretação e dúvidas não consomem tentativas de validação. O limite global de turnos permanece ativo.

## Limites deliberados

- CPF, telefone, datas e outros campos mantêm seus validadores; não são preenchidos por inferência semântica.
- Campos sensíveis não usam o novo interpretador.
- Datas relativas usam o fuso configurado; horários, quantidades e escolhas múltiplas têm normalizações determinísticas antes da validação. Formas ambíguas continuam exigindo esclarecimento.
- Catálogos acima de 100 opções ou 24.000 caracteres não são truncados para inferência; o agente pede esclarecimento.
- O interpretador pode errar. A confirmação humana protege a escolha inferida, mas não substitui avaliações reais da qualidade do modelo.
- Mudanças em regras, fontes, idioma e procedimentos devem ser configuradas pela empresa. Este trabalho não altera a publicação, não faz deploy e não modifica atendimento de clientes por conta própria.

## Verificação

`npx vitest run tests/agent-studio` cobre o motor, persistência/recarregamento de estado, replay, propostas, expiração, correção, catálogo dinâmico, falhas e separação entre escolha e autorização de ação. Há contratos de interpretação para comércio, hotelaria, agendamento, software e educação, além da regressão de seleção numérica.

A suíte padrão usa adaptadores controlados. A avaliação opcional `node scripts/evaluate-studio-model.cjs --agent UUID --workspace UUID` utiliza o modelo efetivamente publicado, credenciais do workspace e conversas sintéticas. `--list` lista somente agentes ativos publicados e o modelo fixado. Ela não troca o modelo, não envia mensagens a clientes nem executa ações de negócio; o gravador de uso é substituído para não escrever no banco. A consulta de histórico é exercitada em modo somente leitura. Esta avaliação mede o corpus, não garante todos os nichos nem substitui homologação operacional.

Eventos específicos: `collection_interpretation_proposed`, `collection_interpretation_confirmed`, `collection_proposal_rejected`, `collection_proposal_expired`, `collection_needs_clarification` e `collection_interpreter_unavailable`. Os eventos não incluem o conteúdo escolhido pelo cliente.

## Histórico, memória e retomada

O adaptador publicado carrega até 80 mensagens anteriores à mensagem de origem, com isolamento por workspace/conversa e exclusão de notas internas e mensagens de sistema. O runtime compartilha a montagem de contexto: fatos aceitos e não sensíveis têm espaço reservado, e mensagens inteiras são selecionadas por recência/relevância. Um histórico compacto também acompanha o estado persistido como fallback, com dados de campos sensíveis omitidos.

Mudanças de assunto podem suspender até três procedimentos por 30 minutos, somente antes de operações externas. “Voltar ao assunto anterior” pede confirmação e restaura o ponto pendente. Campos sensíveis, valores antigos e valores dinâmicos não são reutilizados. A confirmação da retomada não restaura autorizações de ações nem resultados de ferramentas. Cancelamento não cria uma tarefa suspensa.

## Regras do negócio

Removidas as instruções médicas fixas, a identificação de pediatria pelo nome e a substituição de números/contatos. O runtime não reescreve respostas segundo um nicho presumido. Regras específicas devem estar nos procedimentos e fontes configurados pelo usuário. Permanecem validação de dados, escopo da publicação, isolamento e autorização técnica das ações.
