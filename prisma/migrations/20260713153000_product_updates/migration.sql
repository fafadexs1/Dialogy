CREATE TABLE IF NOT EXISTS public.product_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Atualização',
  image_url TEXT,
  accent_color TEXT NOT NULL DEFAULT 'emerald',
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  modal_title TEXT,
  modal_excerpt TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  author_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_updates_slug_key UNIQUE (slug),
  CONSTRAINT product_updates_author_id_fkey
    FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT product_updates_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT product_updates_content_not_blank CHECK (length(trim(content)) > 0),
  CONSTRAINT product_updates_accent_color_check
    CHECK (accent_color IN ('emerald', 'blue', 'violet', 'amber', 'rose'))
);

CREATE TABLE IF NOT EXISTS public.product_update_reactions (
  update_id UUID NOT NULL,
  user_id UUID NOT NULL,
  reaction TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_update_reactions_pkey PRIMARY KEY (update_id, user_id),
  CONSTRAINT product_update_reactions_update_id_fkey
    FOREIGN KEY (update_id) REFERENCES public.product_updates(id) ON DELETE CASCADE,
  CONSTRAINT product_update_reactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT product_update_reactions_reaction_check CHECK (reaction IN ('like', 'dislike'))
);

CREATE TABLE IF NOT EXISTS public.product_update_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_update_comments_update_id_fkey
    FOREIGN KEY (update_id) REFERENCES public.product_updates(id) ON DELETE CASCADE,
  CONSTRAINT product_update_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT product_update_comments_content_check
    CHECK (length(trim(content)) BETWEEN 1 AND 1200)
);

CREATE TABLE IF NOT EXISTS public.product_update_reads (
  update_id UUID NOT NULL,
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_update_reads_pkey PRIMARY KEY (update_id, user_id),
  CONSTRAINT product_update_reads_update_id_fkey
    FOREIGN KEY (update_id) REFERENCES public.product_updates(id) ON DELETE CASCADE,
  CONSTRAINT product_update_reads_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_updates_published
ON public.product_updates (published_at DESC)
WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_product_update_comments_feed
ON public.product_update_comments (update_id, created_at ASC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_update_reactions_update
ON public.product_update_reactions (update_id, reaction);

CREATE INDEX IF NOT EXISTS idx_product_update_reads_user
ON public.product_update_reads (user_id, read_at DESC);

ALTER TABLE public.product_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read published product updates" ON public.product_updates;
CREATE POLICY "Authenticated users can read published product updates"
ON public.product_updates FOR SELECT TO authenticated
USING (is_published = TRUE AND published_at <= NOW());

DROP POLICY IF EXISTS "Authenticated users can read product update reactions" ON public.product_update_reactions;
CREATE POLICY "Authenticated users can read product update reactions"
ON public.product_update_reactions FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "Users can create their product update reactions" ON public.product_update_reactions;
CREATE POLICY "Users can create their product update reactions"
ON public.product_update_reactions FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their product update reactions" ON public.product_update_reactions;
CREATE POLICY "Users can update their product update reactions"
ON public.product_update_reactions FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their product update reactions" ON public.product_update_reactions;
CREATE POLICY "Users can delete their product update reactions"
ON public.product_update_reactions FOR DELETE TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can read product update comments" ON public.product_update_comments;
CREATE POLICY "Authenticated users can read product update comments"
ON public.product_update_comments FOR SELECT TO authenticated
USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can create product update comments" ON public.product_update_comments;
CREATE POLICY "Users can create product update comments"
ON public.product_update_comments FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their product update comments" ON public.product_update_comments;
CREATE POLICY "Users can update their product update comments"
ON public.product_update_comments FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read their product update receipts" ON public.product_update_reads;
CREATE POLICY "Users can read their product update receipts"
ON public.product_update_reads FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their product update receipts" ON public.product_update_reads;
CREATE POLICY "Users can create their product update receipts"
ON public.product_update_reads FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their product update receipts" ON public.product_update_reads;
CREATE POLICY "Users can update their product update receipts"
ON public.product_update_reads FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.product_updates FROM anon, authenticated;
REVOKE ALL ON public.product_update_reactions FROM anon, authenticated;
REVOKE ALL ON public.product_update_comments FROM anon, authenticated;
REVOKE ALL ON public.product_update_reads FROM anon, authenticated;

GRANT SELECT ON public.product_updates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_update_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_update_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_update_reads TO authenticated;
GRANT ALL ON public.product_updates, public.product_update_reactions,
  public.product_update_comments, public.product_update_reads TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.broadcast_product_update_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime'
AS $function$
BEGIN
  IF NEW.is_published = TRUE
    AND NEW.published_at <= NOW()
    AND (
      TG_OP = 'INSERT'
      OR OLD.is_published IS DISTINCT FROM TRUE
      OR OLD.published_at IS DISTINCT FROM NEW.published_at
    )
  THEN
    PERFORM realtime.broadcast_changes(
      'system:product-updates', TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS product_updates_publication_broadcast ON public.product_updates;
CREATE TRIGGER product_updates_publication_broadcast
AFTER INSERT OR UPDATE ON public.product_updates
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_publication();

CREATE OR REPLACE FUNCTION public.broadcast_product_update_community_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime'
AS $function$
BEGIN
  PERFORM realtime.broadcast_changes(
    'system:product-updates-community', TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS product_update_reactions_broadcast ON public.product_update_reactions;
CREATE TRIGGER product_update_reactions_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.product_update_reactions
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();

DROP TRIGGER IF EXISTS product_update_comments_broadcast ON public.product_update_comments;
CREATE TRIGGER product_update_comments_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.product_update_comments
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();

DROP POLICY IF EXISTS "product_updates_receive" ON realtime.messages;
CREATE POLICY "product_updates_receive"
ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.messages.extension = 'broadcast'
  AND (SELECT realtime.topic()) IN ('system:product-updates', 'system:product-updates-community')
);
