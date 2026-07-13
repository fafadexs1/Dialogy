CREATE TABLE IF NOT EXISTS public.community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  media_type TEXT,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT community_posts_body_check CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  CONSTRAINT community_posts_media_type_check CHECK (media_type IS NULL OR media_type IN ('image', 'youtube', 'vimeo')),
  CONSTRAINT community_posts_media_pair_check CHECK ((media_type IS NULL) = (media_url IS NULL)),
  CONSTRAINT community_posts_status_check CHECK (status IN ('published', 'hidden', 'deleted'))
);

CREATE TABLE IF NOT EXISTS public.community_post_reactions (
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL DEFAULT 'like',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT community_post_reactions_pkey PRIMARY KEY (post_id, user_id),
  CONSTRAINT community_post_reactions_check CHECK (reaction = 'like')
);

CREATE TABLE IF NOT EXISTS public.community_post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT community_post_comments_content_check CHECK (length(trim(content)) BETWEEN 1 AND 1200)
);

CREATE INDEX IF NOT EXISTS idx_community_posts_feed
ON public.community_posts (created_at DESC, id DESC)
WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_posts_author
ON public.community_posts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_post_comments_feed
ON public.community_post_comments (post_id, created_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_community_post_reactions_post
ON public.community_post_reactions (post_id, reaction);

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read community posts" ON public.community_posts;
CREATE POLICY "Authenticated users can read community posts"
ON public.community_posts FOR SELECT TO authenticated
USING (status = 'published' AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can create community posts" ON public.community_posts;
CREATE POLICY "Users can create community posts"
ON public.community_posts FOR INSERT TO authenticated
WITH CHECK (author_id = auth.uid() AND status = 'published');

DROP POLICY IF EXISTS "Users can update their community posts" ON public.community_posts;
CREATE POLICY "Users can update their community posts"
ON public.community_posts FOR UPDATE TO authenticated
USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can read community reactions" ON public.community_post_reactions;
CREATE POLICY "Authenticated users can read community reactions"
ON public.community_post_reactions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.community_posts cp WHERE cp.id = post_id AND cp.status = 'published' AND cp.deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can create their community reactions" ON public.community_post_reactions;
CREATE POLICY "Users can create their community reactions"
ON public.community_post_reactions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.community_posts cp WHERE cp.id = post_id AND cp.status = 'published' AND cp.deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can delete their community reactions" ON public.community_post_reactions;
CREATE POLICY "Users can delete their community reactions"
ON public.community_post_reactions FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can read community comments" ON public.community_post_comments;
CREATE POLICY "Authenticated users can read community comments"
ON public.community_post_comments FOR SELECT TO authenticated
USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.community_posts cp WHERE cp.id = post_id AND cp.status = 'published' AND cp.deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can create community comments" ON public.community_post_comments;
CREATE POLICY "Users can create community comments"
ON public.community_post_comments FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.community_posts cp WHERE cp.id = post_id AND cp.status = 'published' AND cp.deleted_at IS NULL));

DROP POLICY IF EXISTS "Users can update their community comments" ON public.community_post_comments;
CREATE POLICY "Users can update their community comments"
ON public.community_post_comments FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.community_posts, public.community_post_reactions, public.community_post_comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_posts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.community_post_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.community_post_comments TO authenticated;
GRANT ALL ON public.community_posts, public.community_post_reactions, public.community_post_comments TO service_role, postgres;

DROP TRIGGER IF EXISTS community_posts_broadcast ON public.community_posts;
CREATE TRIGGER community_posts_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.community_posts
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();

DROP TRIGGER IF EXISTS community_post_reactions_broadcast ON public.community_post_reactions;
CREATE TRIGGER community_post_reactions_broadcast
AFTER INSERT OR DELETE ON public.community_post_reactions
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();

DROP TRIGGER IF EXISTS community_post_comments_broadcast ON public.community_post_comments;
CREATE TRIGGER community_post_comments_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.community_post_comments
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();
