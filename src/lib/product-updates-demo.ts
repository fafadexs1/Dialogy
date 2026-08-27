import type { ProductUpdateAnnouncement, ProductUpdateFeedItem } from '@/lib/product-updates';

export const LOCAL_PRODUCT_UPDATE_DEMO_ID = '8e9c589d-32cd-4ea7-9b11-1c763ea16934';

export const localProductUpdateDemo: ProductUpdateFeedItem = {
  kind: 'update',
  id: LOCAL_PRODUCT_UPDATE_DEMO_ID,
  slug: 'bem-vindos-a-comunidade-dialogy',
  title: 'Bem-vindos à Comunidade Dialogy',
  summary: 'Um novo espaço para descobrir lançamentos, acompanhar os bastidores do produto e construir os próximos capítulos junto com a gente.',
  content: 'A Dialogy agora tem um espaço vivo para compartilhar cada evolução da plataforma.',
  category: 'Grande lançamento',
  imageUrl: '/landing-hero-inbox-dark.webp',
  accentColor: 'violet',
  highlights: [
    'Novidades organizadas em um feed visual',
    'Conversas entre usuários de diferentes operações',
    'Enquetes para ajudar a priorizar o produto',
  ],
  contentBlocks: [
    {
      type: 'paragraph',
      text: 'A partir de agora, cada melhoria importante ganha contexto: o que mudou, por que construímos e como isso pode transformar a rotina da sua equipe. E o melhor: a conversa não termina quando o artigo acaba.',
    },
    { type: 'heading', level: 2, text: 'Um produto construído perto de quem usa' },
    {
      type: 'image',
      url: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1600&q=85',
      alt: 'Equipe colaborando em um ambiente de trabalho',
      caption: 'Comunidade, produto e operação na mesma conversa. Foto: Unsplash.',
    },
    {
      type: 'paragraph',
      text: 'Comentários, reações e enquetes aproximam o roadmap da operação real. Você pode contar o que funcionou, levantar um ponto de atenção ou sugerir a próxima evolução — tudo no mesmo lugar em que conhece a novidade.',
    },
    {
      type: 'quote',
      text: 'A melhor atualização não é apenas a que adiciona recursos. É a que resolve uma rotina real e abre espaço para a próxima conversa.',
      attribution: 'Time Dialogy',
    },
    { type: 'heading', level: 2, text: 'Conteúdo que vai além do texto' },
    {
      type: 'video',
      url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      poster: '/placeholder-video.png',
      caption: 'Vídeo externo CC0 usado para demonstrar o player de mídia da comunidade.',
    },
    {
      type: 'paragraph',
      text: 'Os próximos artigos podem combinar demonstrações em vídeo, capturas reais da plataforma, galerias, listas de melhorias e chamadas para participação. O formato se adapta à história que cada lançamento precisa contar.',
    },
    {
      type: 'image',
      url: '/landing-hero-inbox-dark.webp',
      alt: 'Interface da Inbox Dialogy em tema escuro',
      caption: 'A nova Inbox Dialogy — uma das experiências que poderão ganhar bastidores e demonstrações por aqui.',
    },
    { type: 'divider' },
    { type: 'heading', level: 3, text: 'Agora queremos ouvir você' },
    {
      type: 'paragraph',
      text: 'Vote na enquete abaixo e teste a experiência. Este artigo é uma demonstração local: nenhuma reação, comentário ou voto será enviado para produção.',
    },
  ],
  poll: {
    id: '94310327-8e42-4ba4-baea-77cb2dfa9f7d',
    question: 'Qual área você quer ver evoluir primeiro?',
    isActive: true,
    totalVotes: 12,
    selectedOptionId: null,
    options: [
      { id: '95ec2047-6630-4267-9209-6c8aaa835a38', label: 'Autopilot & Inteligência Artificial', votes: 5, percentage: 42 },
      { id: '184b8125-4f3b-466f-88d0-024021075a21', label: 'Inbox e produtividade do time', votes: 4, percentage: 33 },
      { id: '31619fa8-71c7-4f78-8004-88d3514bb751', label: 'CRM, Analytics e conversão', votes: 2, percentage: 17 },
      { id: '7e2b1920-48f4-42ce-ab44-5b075cf0be70', label: 'Integrações e novos canais', votes: 1, percentage: 8 },
    ],
  },
  publishedAt: new Date().toISOString(),
  author: { id: 'dialogy', name: 'Time Dialogy', avatarUrl: '/logo.png', workspaceName: 'Dialogy' },
  media: null,
  isMine: false,
  reactions: { likes: 24, dislikes: 1, mine: null },
  commentsCount: 2,
  isDemo: true,
  demoComments: [
    {
      id: '9f4b8f38-a61a-491f-a5d9-48a83254304e',
      updateId: LOCAL_PRODUCT_UPDATE_DEMO_ID,
      content: 'Gostei muito da ideia. Seria ótimo ver demonstrações curtas das melhorias antes de colocá-las na operação.',
      createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      isEdited: false,
      isMine: false,
      author: { id: '2c5cb42a-75be-4aec-b8ab-e762445963fc', name: 'Marina Costa', avatarUrl: null, workspaceName: 'Comunidade Dialogy' },
    },
    {
      id: '0cae4be0-2261-4284-8d6d-0cfa0a183364',
      updateId: LOCAL_PRODUCT_UPDATE_DEMO_ID,
      content: 'Meu voto vai para Inbox. Pequenos ganhos de produtividade fazem muita diferença no fim do mês.',
      createdAt: new Date(Date.now() - 1000 * 60 * 16).toISOString(),
      isEdited: false,
      isMine: false,
      author: { id: 'd504163c-0963-4834-825b-514fe9168276', name: 'Rafael Martins', avatarUrl: null, workspaceName: 'Comunidade Dialogy' },
    },
  ],
};

export const localProductUpdateAnnouncement: ProductUpdateAnnouncement = {
  id: LOCAL_PRODUCT_UPDATE_DEMO_ID,
  slug: 'segunda-via-sgp-fatura-pdf',
  title: 'Segunda via do SGP agora também pode ser enviada em PDF',
  excerpt: 'A segunda via do SGP foi aprimorada. Além de PIX e boleto, o cliente agora também pode escolher receber a fatura em PDF para baixar e consultar com mais facilidade.',
  category: 'Atualização do SGP',
  accentColor: 'blue',
  publishedAt: new Date().toISOString(),
};
