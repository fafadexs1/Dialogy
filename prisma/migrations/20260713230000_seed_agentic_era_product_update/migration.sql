INSERT INTO public.product_updates (
  id,
  slug,
  title,
  summary,
  content,
  category,
  image_url,
  accent_color,
  highlights,
  modal_title,
  modal_excerpt,
  is_published,
  published_at,
  content_blocks
)
VALUES (
  '2fd958c7-90e5-4587-a71a-1f3a89ab30d8',
  'era-agentica-dialogy-agentes-ia-em-testes',
  'Estamos na Era Agêntica: a próxima evolução da inteligência artificial já começou na Dialogy',
  'Mais do que responder mensagens, os novos agentes de IA da Dialogy estão sendo preparados para compreender objetivos, seguir processos, usar ferramentas com segurança, aprender com resultados e trabalhar ao lado da sua equipe.',
  'A Dialogy está construindo uma nova geração de atendimento inteligente: agentes de IA capazes de compreender, decidir e agir com responsabilidade dentro da operação.',
  'Inteligência Artificial',
  'https://storage.klyraai.com.br/evolution/evolution-api/Imagem%201%20gerada%20%281%29.png',
  'violet',
  '[
    "Agentes que compreendem o contexto antes de agir",
    "Decisões, ferramentas e resultados com rastreabilidade",
    "Testes controlados antes da adoção gradual em operações reais",
    "IA e equipe humana trabalhando como uma só operação"
  ]'::jsonb,
  'A Dialogy entrou na Era Agêntica',
  'Conheça o sistema de agentes de IA que já está em fase de testes e entenda como ele foi projetado para transformar atendimento em execução inteligente, segura e mensurável.',
  TRUE,
  timezone('utc', now()),
  jsonb_build_array(
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Durante muito tempo, falar em inteligência artificial no atendimento significou falar em chatbots: sistemas preparados para reconhecer algumas palavras, seguir uma sequência previamente definida e entregar uma resposta. Eles ajudaram empresas a automatizar tarefas importantes, mas quase sempre dependeram de caminhos rígidos. Quando o cliente escrevia de uma forma inesperada, mudava de assunto ou precisava resolver algo que atravessava mais de um sistema, a automação encontrava seus limites.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Esse cenário está mudando. Estamos entrando na Era Agêntica: uma etapa em que a inteligência artificial deixa de atuar somente como uma caixa de respostas e passa a trabalhar como um agente digital. Em termos simples, um agente não recebe apenas uma pergunta para gerar um texto. Ele recebe um objetivo, interpreta o contexto, organiza os próximos passos, consulta as informações autorizadas, escolhe ferramentas adequadas, executa ações permitidas e verifica se o resultado realmente ajudou o cliente.'
    ),
    jsonb_build_object(
      'type', 'quote',
      'text', 'A mudança mais importante não é uma IA que fala mais. É uma IA que compreende melhor, age com responsabilidade e consegue demonstrar o que fez.',
      'attribution', 'Time Dialogy'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'O que é, de verdade, um agente de IA?'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Pense em um atendimento comum. Um cliente informa que a internet está lenta. Um chatbot tradicional pode oferecer um menu ou enviar uma instrução genérica. Um agente de IA, quando devidamente configurado e autorizado, pode identificar que o objetivo é diagnosticar a conexão, descobrir quais dados ainda faltam, validar o contrato correto, consultar uma ferramenta técnica, interpretar o retorno, explicar o diagnóstico em linguagem simples e pedir confirmação antes de qualquer ação que possa alterar o serviço.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Essa diferença parece pequena na tela, porque para o cliente tudo continua acontecendo em uma conversa natural. Por trás dela, porém, existe uma arquitetura muito mais cuidadosa. O agente precisa saber o que pode fazer, o que não pode fazer, quando deve perguntar, quando precisa confirmar, quando deve parar e quando o melhor caminho é transferir a conversa para uma pessoa.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Na prática, a Era Agêntica combina a capacidade de comunicação dos modelos de IA com processos de negócio, memória, bases de conhecimento, integrações e regras operacionais. A inteligência deixa de ser uma camada isolada e passa a participar do fluxo de trabalho. É justamente nessa direção que a Dialogy tem concentrado seus esforços.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Como a Dialogy está construindo essa nova geração'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Nosso objetivo não é colocar um modelo de linguagem no atendimento e esperar que ele improvise. Estamos desenvolvendo um sistema completo de agentes, com camadas específicas para compreender, decidir, executar, validar e aprender. Cada camada existe para tornar a experiência mais útil para o cliente e mais segura para a empresa.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '1. Compreensão da intenção e do contexto'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'O primeiro trabalho do agente é entender o que a pessoa realmente deseja resolver. A mesma frase pode representar uma dúvida, um pedido de suporte, uma intenção de compra ou uma solicitação que exige confirmação. O sistema analisa a conversa atual, considera o histórico útil e identifica quais informações já estão disponíveis. Em vez de obrigar o cliente a recomeçar, o agente busca dar continuidade ao atendimento.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '2. Roteamento inteligente para o caminho correto'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Depois de compreender o objetivo, o sistema escolhe o caminho mais adequado. A Dialogy já possui um mecanismo de decisão capaz de comparar rotas, registrar a confiança da escolha, guardar as evidências consideradas e definir uma alternativa segura quando não há certeza suficiente. Isso permite atender situações diferentes sem transformar toda conversa em um menu engessado.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '3. Procedimentos executados passo a passo'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Um bom agente não depende apenas de criatividade. Ele também precisa seguir o processo da empresa. Por isso, estamos estruturando procedimentos que representam etapas reais: coletar um dado, validar uma informação, consultar um sistema, analisar o retorno, pedir autorização e concluir. O agente mantém o estado da conversa e sabe em qual etapa está, reduzindo repetições e evitando que uma parte importante seja pulada.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '4. Conhecimento conectado à realidade da empresa'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Respostas confiáveis dependem de fontes confiáveis. O agente pode trabalhar com uma base de conhecimento da operação, selecionando documentos relevantes para cada caso. Quando a informação não está disponível ou a cobertura é insuficiente, o comportamento esperado não é inventar uma resposta. O sistema pode pedir mais dados, usar uma alternativa previamente definida ou encaminhar o atendimento.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '5. Ferramentas e integrações com regras de segurança'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'É aqui que a IA começa a agir. Uma ferramenta pode consultar um cadastro, localizar um contrato, preencher um campo no CRM, buscar um diagnóstico ou acionar uma integração. Mas nenhuma ferramenta deve ser usada apenas porque o modelo sugeriu. Na arquitetura da Dialogy, as ferramentas passam por regras centrais: precisam existir, estar habilitadas, ser compatíveis com a intenção, receber os dados corretos e respeitar o nível de risco.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Ações sensíveis exigem tratamento especial. Quando há possibilidade de alterar um serviço ou gerar um efeito relevante, o agente pode interromper o fluxo e solicitar uma confirmação clara. Se uma execução falha ou fica com resultado incerto, o sistema foi projetado para evitar repetições automáticas perigosas. Segurança, nesse contexto, não é um aviso no final do projeto; é parte da decisão.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '6. Validação antes da resposta chegar ao cliente'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Antes de enviar a resposta, uma camada de validação verifica se o conteúdo está coerente com o que realmente aconteceu. Se uma consulta não foi realizada, o agente não deve afirmar que consultou. Se uma ferramenta retornou erro, ele não deve anunciar sucesso. Se a resposta expõe detalhes técnicos desnecessários ou não ajuda o cliente a avançar, ela pode ser ajustada, substituída por uma alternativa segura ou direcionada para atendimento humano.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '7. Uma memória útil, sem transformar conversa em improviso'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Memória não significa guardar tudo indiscriminadamente. Significa preservar os fatos necessários para que o atendimento tenha continuidade: qual é o objetivo, o que já foi confirmado, quais dados ainda faltam, qual procedimento está em andamento e qual foi o resultado das etapas anteriores. Dessa forma, o agente pode ser consistente ao longo da jornada e a equipe humana consegue assumir a conversa com mais contexto.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', '8. Decisões auditáveis e resultados mensuráveis'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Uma das partes mais importantes do sistema é a rastreabilidade. A Dialogy está preparando o agente para registrar por que tomou uma decisão: qual objetivo foi detectado, qual rota foi escolhida, quais dados estavam presentes ou ausentes, quais ferramentas foram consideradas, quais foram bloqueadas e qual resposta foi enviada. Isso permite investigar falhas, melhorar processos e evitar que a operação dependa de uma caixa-preta.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Também acompanhamos o que acontece depois da decisão. O atendimento foi resolvido? Precisou de uma pessoa? A ferramenta falhou? Determinada rota teve desempenho melhor? Esses resultados ajudam a separar uma resposta que parece boa de uma experiência que realmente funciona.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'O agente poderá aprender sozinho? Sim, mas com governança'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'O sistema já possui mecanismos para identificar padrões de resultado, comparar desempenhos e gerar sugestões de melhoria. Isso pode revelar, por exemplo, que uma rota transfere atendimentos demais, que uma etapa pede dados desnecessários ou que um procedimento funciona melhor em determinado cenário. O aprendizado, entretanto, não precisa significar mudanças invisíveis e incontroláveis.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Nossa visão é de uma autoevolução responsável: padrões são detectados, evidências são reunidas e melhorias podem ser revisadas, aplicadas e, quando necessário, revertidas. Cada empresa preserva sua própria configuração, suas regras e sua soberania. O objetivo é fazer o agente melhorar com a operação sem retirar o controle de quem responde por ela.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'O que significa dizer que o sistema está em fase de testes?'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Significa que não estamos apresentando apenas uma ideia. O núcleo técnico do motor já foi implementado e submetido a testes automatizados, avaliações de comportamento, simulações de falhas, testes com banco de dados e cenários de ponta a ponta em ambientes controlados. Já validamos componentes como decisão, roteamento, procedimentos, uso governado de ferramentas, registro de eventos, recuperação de falhas, prevenção de duplicidade e transferência segura para humanos.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Ao mesmo tempo, teste técnico não substitui a realidade de cada negócio. Agora avançamos com cuidado para a homologação em situações representativas, o ajuste de bases de conhecimento, a configuração dos procedimentos de cada operação e a observação do comportamento ao longo do tempo. Antes de ampliar qualquer uso, precisamos verificar qualidade, clareza, segurança, taxa de resolução e experiência do cliente no contexto em que o agente será utilizado.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Também precisamos de histórico real suficiente para responder a uma pergunta essencial: o agente de hoje está melhor do que o agente de trinta dias atrás? A estrutura para medir essa evolução já existe, mas uma conclusão responsável depende de volume, tempo e resultados reais. Por isso, falamos em fase de testes com transparência: temos uma base técnica avançada, mas não vamos confundir capacidade implementada com promessa já comprovada em todas as operações.'
    ),
    jsonb_build_object(
      'type', 'quote',
      'text', 'Inovar com velocidade importa. Inovar com evidência, segurança e capacidade de voltar atrás importa ainda mais.',
      'attribution', 'Time de Produto e Engenharia da Dialogy'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'E qual será o papel das pessoas?'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'A Era Agêntica não elimina o valor humano do atendimento. Ela pode eliminar parte do trabalho repetitivo, organizar informações e acelerar diagnósticos para que as pessoas se concentrem em negociação, empatia, exceções e decisões que exigem julgamento. Um agente bem projetado sabe que nem toda conversa deve ser automatizada até o fim.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Quando o cliente pede uma pessoa, quando a confiança é baixa, quando uma regra impede a ação ou quando o caso foge do procedimento, a transferência faz parte do sucesso. O atendente recebe uma conversa mais organizada, com contexto e histórico das tentativas anteriores. Em vez de competir com a equipe, a IA passa a funcionar como uma nova camada operacional ao lado dela.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'O que isso pode representar para os clientes da Dialogy'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Para quem conversa com uma empresa, a tecnologia deve aparecer como simplicidade: menos repetição, respostas mais contextualizadas, explicações claras e resolução mais rápida. Para a equipe, ela pode significar triagens melhores, processos consistentes, menos tarefas manuais e mais visibilidade sobre o que acontece em cada atendimento.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Para os gestores, o avanço mais relevante pode ser a capacidade de acompanhar não apenas quantas mensagens foram enviadas, mas como as decisões foram tomadas e quais resultados produziram. Isso abre espaço para melhorar conhecimento, ferramentas e procedimentos com base em evidências reais, mantendo limites e responsabilidades definidos.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Uma construção de longo prazo, feita com responsabilidade'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Estamos muito entusiasmados com essa evolução, mas escolhemos construí-la com rigor. Agentes de IA lidam com comunicação, dados e ações reais; por isso, precisam de arquitetura, observabilidade, testes e limites claros. A qualidade não será medida pela quantidade de frases impressionantes que a IA consegue produzir, e sim pela capacidade de resolver demandas sem criar novos problemas.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'A Dialogy seguirá aproximando engenharia, produto e operação para transformar esse potencial em uma experiência confiável. Cada teste, cada falha identificada e cada atendimento analisado ajuda a construir um agente mais preparado para o mundo real. É um caminho gradual, mas a direção é clara: sair da automação que apenas responde para chegar a uma inteligência que compreende, executa e presta contas.'
    ),
    jsonb_build_object(
      'type', 'divider'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Bem-vindos à Era Agêntica'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'A próxima geração da Dialogy já está sendo testada. Ela nasce para unir conversas, conhecimento, processos, ferramentas e pessoas em uma operação mais inteligente. Ainda há aprendizado pela frente — e fazemos questão de dizer isso —, mas o sistema que torna essa visão possível já deixou de ser apenas um projeto no papel.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Estamos construindo agentes que não apenas falam em nome da empresa, mas trabalham de acordo com as regras dela; que não apenas respondem, mas buscam resolver; que não apenas decidem, mas registram por que decidiram. Para nós, é isso que define a Era Agêntica. E ela já começou na Dialogy.'
    )
  )
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content = EXCLUDED.content,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  accent_color = EXCLUDED.accent_color,
  highlights = EXCLUDED.highlights,
  modal_title = EXCLUDED.modal_title,
  modal_excerpt = EXCLUDED.modal_excerpt,
  is_published = TRUE,
  published_at = LEAST(public.product_updates.published_at, EXCLUDED.published_at),
  content_blocks = EXCLUDED.content_blocks,
  updated_at = timezone('utc', now());
