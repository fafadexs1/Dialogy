-- Multiple classification tags belong to the conversation. The legacy
-- chats.tag/chats.color columns remain available while queue routing finishes
-- moving to chats.team_id.
CREATE TABLE public.chat_tags (
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (chat_id, tag_id)
);

CREATE INDEX chat_tags_workspace_tag_idx
  ON public.chat_tags (workspace_id, tag_id, chat_id);

CREATE INDEX chat_tags_tag_id_idx
  ON public.chat_tags (tag_id);

-- Preserve the classifications that were previously stored in the single
-- legacy slot. Ambiguous duplicate labels resolve deterministically.
INSERT INTO public.chat_tags (chat_id, tag_id, workspace_id)
SELECT c.id, matched_tag.id, c.workspace_id
FROM public.chats c
JOIN LATERAL (
  SELECT t.id
  FROM public.tags t
  WHERE t.workspace_id = c.workspace_id
    AND t.is_close_reason = FALSE
    AND lower(t.label) = lower(c.tag)
  ORDER BY t.sort_order NULLS LAST, t.id
  LIMIT 1
) matched_tag ON TRUE
WHERE NULLIF(btrim(c.tag), '') IS NOT NULL
ON CONFLICT (chat_id, tag_id) DO NOTHING;

-- This relation is consumed only by authenticated server actions. Keep it out
-- of the browser-facing Data API even when public tables are auto-exposed.
ALTER TABLE public.chat_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_tags FROM anon, authenticated;
GRANT ALL ON public.chat_tags TO service_role;
