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
  'ec890a95-128d-41d0-a32d-d726fe6b512b',
  'fatura-no-fluxo-listas-interativas-sgp',
  'A fatura pegou uma motinha: segunda via, PIX e boleto agora entram no fluxo',
  'O cliente escolhe contrato, fatura e forma de pagamento em listas interativas — enquanto Dialogy, NexusFlow e SGP fazem o trabalho pesado nos bastidores.',
  'A nova experiência de segunda via transforma uma solicitação repetitiva em uma conversa guiada, rápida e muito mais agradável para o cliente.',
  'Automação & Atendimento',
  'https://storage.klyraai.com.br/crm/community/2026/07/fatura-no-fluxo-listas-interativas.png',
  'violet',
  '[
    "Contratos identificados como Ativo ou Suspenso",
    "Listas interativas no lugar de paredões de texto",
    "Escolha guiada entre PIX, boleto ou link da fatura",
    "Saídas de sucesso e erro para continuar o atendimento"
  ]'::jsonb,
  'A fatura pegou uma motinha 🛵🧾',
  'Conheça a nova jornada que encontra o contrato, organiza as faturas e entrega PIX, boleto ou link sem transformar o atendimento em uma maratona de mensagens.',
  TRUE,
  timezone('utc', now()),
  jsonb_build_array(
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Tem novidade chegando ao fluxo de atendimento — e, desta vez, o boleto não vai precisar de GPS, café nem daquele clássico “só um minutinho que eu vou verificar”. 😄 A nova experiência de segunda via foi criada para transformar uma solicitação muito comum em uma conversa rápida, clara e agradável para o cliente.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Tudo acontece dentro do próprio atendimento. O cliente informa o CPF ou CNPJ, escolhe o contrato quando necessário, seleciona a fatura e decide como deseja receber. Enquanto isso, Dialogy, NexusFlow e SGP trabalham juntos nos bastidores para localizar as informações e conduzir cada etapa.'
    ),
    jsonb_build_object(
      'type', 'image',
      'url', 'https://storage.klyraai.com.br/crm/community/2026/07/fatura-no-fluxo-listas-interativas.png',
      'alt', 'Ilustração divertida de uma fatura sendo entregue por uma motinha ao lado de um celular com opções interativas',
      'caption', 'A fatura saiu para entrega — e o fluxo já sabe o caminho. 🛵'
    ),
    jsonb_build_object(
      'type', 'quote',
      'text', 'Automação boa não faz o cliente decorar números. Ela mostra o caminho, entrega o que ele precisa e sabe quando deve sair de cena.',
      'attribution', 'Time Dialogy'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Menos “aguarde”, mais “está aqui” 🚀'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Quando alguém pedir a segunda via, o fluxo consulta os dados do SGP e organiza a jornada automaticamente. Se existir mais de um contrato, o cliente verá as opções de forma clara, acompanhadas do endereço e do estado atual — como (Ativo) ou (Suspenso). Assim, ele sabe exatamente qual serviço está escolhendo.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Isso evita aquela pequena investigação digna de série policial: “É o contrato da casa?”, “Da loja?”, “Do endereço antigo?” ou “Daquele Wi-Fi que todo mundo usa, mas ninguém sabe no nome de quem está?”. 🕵️‍♂️'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Se houver somente um contrato elegível, melhor ainda: o fluxo pula essa pergunta e segue adiante. Automação inteligente também sabe quando ficar quieta.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Adeus, paredão de texto. Olá, listas interativas! 📱'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Uma das mudanças mais visíveis está na forma de apresentar escolhas. Em vez de receber uma mensagem enorme, cheia de números e instruções, o cliente abre uma lista organizada e toca na opção desejada. É mais bonito, mais rápido e reduz bastante o risco de alguém responder “segunda via” quando o robô estava esperando “3”. 😅'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'As listas interativas podem acompanhar diferentes momentos da conversa: escolha do setor, escolha do contrato, escolha da fatura e escolha entre PIX e boleto. O cliente continua podendo digitar quando isso fizer sentido. A conversa fica guiada sem virar uma catraca digital.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', 'Como era'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', '1 - Financeiro\n2 - Segunda via\n3 - Contrato 12345\n4 - PIX\n\nFunciona? Funciona. Mas exige leitura, memorização e digitação — justamente as pequenas fricções que fazem uma conversa simples parecer um formulário.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 3,
      'text', 'Como fica'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'O cliente toca em “Ver opções”, enxerga títulos curtos, descrições úteis e escolhe o item certo. Nos contratos, o status aparece logo no início para não ser cortado pela tela: 15532 (Ativo) ou 24123 (Suspenso), por exemplo. O endereço aparece como descrição para completar a identificação.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'PIX ou boleto? O cliente escolhe 💸'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Depois de identificar o contrato, o fluxo localiza as faturas em aberto e apresenta vencimento e valor. O cliente escolhe a cobrança correta e, na sequência, vê as formas de pagamento realmente disponíveis para aquela fatura.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Se houver PIX, ele poderá receber o código copia e cola. Se houver boleto, poderá receber a linha digitável ou o conteúdo configurado para esse envio. Nas operações com WhatsApp Cloud, PIX e boleto usam templates separados, porque cada formato merece chegar do jeito certo — sem colocar um código de barras em uma fantasia de PIX.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'E tem um detalhe importante: se a fatura não possuir PIX nem código de boleto, mas tiver um link disponível, o fluxo não abandona o cliente no acostamento. Ele envia o link da segunda via e mantém a jornada andando. 🛵💨'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Verde para sucesso, vermelho para imprevistos 🟢🔴'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'O bloco de segunda via não termina a conversa no escuro. Ele oferece uma saída verde para sucesso e uma saída vermelha para erro. Cada operação pode decidir o próximo passo: confirmar o envio, agradecer, oferecer outro serviço, pedir nova tentativa ou encaminhar para o Financeiro.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Se o CPF ou CNPJ estiver vazio, não existir no SGP ou gerar uma resposta inválida, o fluxo pode seguir pelo caminho de erro sem fingir que deu tudo certo. Se o documento pertencer a um cliente válido, a jornada continua com os contratos encontrados. É a diferença entre apenas executar uma tarefa e conduzir uma experiência.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Por que isso ajuda tanto? 🎯'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Para o cliente, significa autonomia. Ele não precisa esperar uma pessoa encontrar o cadastro, abrir o contrato, localizar a cobrança e copiar o código manualmente. Para a equipe, significa menos tarefas repetitivas e mais tempo para resolver casos que realmente exigem atenção humana.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Para a operação, significa uma jornada mais padronizada e disponível mesmo nos momentos em que o volume de conversas resolve fazer cosplay de avalanche. 🏔️ Respostas mais rápidas, menos erros de digitação, menos idas e voltas, opções fáceis de entender e uma equipe mais livre para negociar, analisar e cuidar das exceções.'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'O melhor robô é aquele que não parece um formulário de imposto 🤖'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Automação não precisa ser fria. Ela pode orientar, explicar e até arrancar um sorriso enquanto resolve uma tarefa importante. O cliente não precisa saber o que é endpoint, payload, webhook ou qualquer outro palavrão tecnológico. Ele só precisa tocar na opção certa e seguir o caminho.'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Por trás da tela, os sistemas fazem uma espécie de corrida de revezamento. A Dialogy mantém a conversa, o NexusFlow conduz as decisões e o SGP entrega os dados financeiros. O bastão é uma fatura — mas, felizmente, ninguém precisa correr de verdade. 🏃‍♂️🧾'
    ),
    jsonb_build_object(
      'type', 'divider'
    ),
    jsonb_build_object(
      'type', 'heading',
      'level', 2,
      'text', 'Uma experiência pequena na tela, uma grande diferença no atendimento 🌟'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Pedir segunda via é uma das solicitações mais comuns em operações de internet e serviços recorrentes. Justamente por ser tão frequente, cada clique economizado importa. Com contratos identificados pelo status, faturas organizadas, escolhas em listas interativas e entrega de PIX, boleto ou link, o atendimento fica mais direto do início ao fim.'
    ),
    jsonb_build_object(
      'type', 'quote',
      'text', 'A fatura chega. O cliente entende. A equipe respira. E o fluxo segue feliz para o próximo bloco. 💜',
      'attribution', 'Time Dialogy'
    ),
    jsonb_build_object(
      'type', 'paragraph',
      'text', 'Agora conta para a gente: qual outra tarefa repetitiva você gostaria de ver pegando uma motinha e se resolvendo sozinha? 🛵'
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
  published_at = EXCLUDED.published_at,
  content_blocks = EXCLUDED.content_blocks,
  updated_at = timezone('utc', now());
