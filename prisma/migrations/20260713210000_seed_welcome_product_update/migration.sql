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
  '8e9c589d-32cd-4ea7-9b11-1c763ea16934',
  'bem-vindos-a-comunidade-dialogy',
  'Bem-vindos à Comunidade Dialogy',
  'Um novo espaço para descobrir lançamentos, acompanhar os bastidores do produto e construir os próximos capítulos junto com a gente.',
  'A Dialogy agora tem um espaço vivo para compartilhar cada evolução da plataforma.',
  'Grande lançamento',
  '/landing-hero-inbox-dark.webp',
  'violet',
  '["Novidades organizadas em um feed visual", "Conversas entre usuários de diferentes operações", "Enquetes para ajudar a priorizar o produto"]'::jsonb,
  'A Comunidade Dialogy chegou ✨',
  'Conheça o novo feed, veja fotos e vídeo, vote na primeira enquete e experimente as conversas da comunidade.',
  TRUE,
  timezone('utc', now()),
  '[
    {"type":"paragraph","text":"A partir de agora, cada melhoria importante ganha contexto: o que mudou, por que construímos e como isso pode transformar a rotina da sua equipe."},
    {"type":"heading","level":2,"text":"Um produto construído perto de quem usa"},
    {"type":"image","url":"https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1600&q=85","alt":"Equipe colaborando em um ambiente de trabalho","caption":"Comunidade, produto e operação na mesma conversa. Foto: Unsplash."},
    {"type":"paragraph","text":"Comentários, reações e enquetes aproximam o roadmap da operação real. Conte o que funcionou, levante pontos de atenção e ajude a escolher a próxima evolução."},
    {"type":"quote","text":"A melhor atualização não é apenas a que adiciona recursos. É a que resolve uma rotina real e abre espaço para a próxima conversa.","attribution":"Time Dialogy"},
    {"type":"heading","level":2,"text":"Conteúdo que vai além do texto"},
    {"type":"video","url":"https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4","poster":"/placeholder-video.png","caption":"Vídeo externo CC0 usado para demonstrar o player de mídia da comunidade."},
    {"type":"image","url":"/landing-hero-inbox-dark.webp","alt":"Interface da Inbox Dialogy em tema escuro","caption":"A nova Inbox Dialogy."},
    {"type":"divider"},
    {"type":"heading","level":3,"text":"Agora queremos ouvir você"},
    {"type":"paragraph","text":"Vote na enquete abaixo e participe da conversa."}
  ]'::jsonb
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

INSERT INTO public.product_update_polls (id, update_id, question, is_active)
SELECT
  '94310327-8e42-4ba4-baea-77cb2dfa9f7d',
  id,
  'Qual área você quer ver evoluir primeiro?',
  TRUE
FROM public.product_updates
WHERE slug = 'bem-vindos-a-comunidade-dialogy'
ON CONFLICT (update_id) DO UPDATE SET
  question = EXCLUDED.question,
  is_active = TRUE;

INSERT INTO public.product_update_poll_options (id, poll_id, label, position)
VALUES
  ('95ec2047-6630-4267-9209-6c8aaa835a38', '94310327-8e42-4ba4-baea-77cb2dfa9f7d', 'Autopilot & Inteligência Artificial', 0),
  ('184b8125-4f3b-466f-88d0-024021075a21', '94310327-8e42-4ba4-baea-77cb2dfa9f7d', 'Inbox e produtividade do time', 1),
  ('31619fa8-71c7-4f78-8004-88d3514bb751', '94310327-8e42-4ba4-baea-77cb2dfa9f7d', 'CRM, Analytics e conversão', 2),
  ('7e2b1920-48d4-4eeb-88d3-91442f9c6547', '94310327-8e42-4ba4-baea-77cb2dfa9f7d', 'Integrações e novos canais', 3)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  position = EXCLUDED.position;
