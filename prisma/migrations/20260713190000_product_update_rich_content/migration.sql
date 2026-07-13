ALTER TABLE public.product_updates
ADD COLUMN IF NOT EXISTS content_blocks JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.product_update_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  update_id UUID NOT NULL UNIQUE,
  question TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_update_polls_update_id_fkey
    FOREIGN KEY (update_id) REFERENCES public.product_updates(id) ON DELETE CASCADE,
  CONSTRAINT product_update_polls_question_check CHECK (length(trim(question)) BETWEEN 1 AND 240)
);

CREATE TABLE IF NOT EXISTS public.product_update_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT product_update_poll_options_poll_id_fkey
    FOREIGN KEY (poll_id) REFERENCES public.product_update_polls(id) ON DELETE CASCADE,
  CONSTRAINT product_update_poll_options_label_check CHECK (length(trim(label)) BETWEEN 1 AND 160),
  CONSTRAINT product_update_poll_options_poll_id_id_key UNIQUE (poll_id, id),
  CONSTRAINT product_update_poll_options_position_key UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS public.product_update_poll_votes (
  poll_id UUID NOT NULL,
  option_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT product_update_poll_votes_pkey PRIMARY KEY (poll_id, user_id),
  CONSTRAINT product_update_poll_votes_option_fkey
    FOREIGN KEY (poll_id, option_id)
    REFERENCES public.product_update_poll_options(poll_id, id) ON DELETE CASCADE,
  CONSTRAINT product_update_poll_votes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_update_poll_votes_option
ON public.product_update_poll_votes (option_id);

ALTER TABLE public.product_update_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_update_poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read product update polls"
ON public.product_update_polls FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can read product update poll options"
ON public.product_update_poll_options FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Authenticated users can read product update poll votes"
ON public.product_update_poll_votes FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Users can create their product update poll vote"
ON public.product_update_poll_votes FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their product update poll vote"
ON public.product_update_poll_votes FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.product_update_polls, public.product_update_poll_options,
  public.product_update_poll_votes FROM anon, authenticated;
GRANT SELECT ON public.product_update_polls, public.product_update_poll_options,
  public.product_update_poll_votes TO authenticated;
GRANT INSERT, UPDATE ON public.product_update_poll_votes TO authenticated;
GRANT ALL ON public.product_update_polls, public.product_update_poll_options,
  public.product_update_poll_votes TO service_role, postgres;

DROP TRIGGER IF EXISTS product_update_poll_votes_broadcast ON public.product_update_poll_votes;
CREATE TRIGGER product_update_poll_votes_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.product_update_poll_votes
FOR EACH ROW EXECUTE FUNCTION public.broadcast_product_update_community_change();
