-- Narrow indexes for the analytics read path. Keep these ordered by the equality
-- key first and the range/order key second so Postgres can avoid workspace-wide
-- scans without adding write-heavy, overlapping indexes.

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_created_at
  ON public.contacts (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_meta_conversations_chat_activity_desc
  ON public.meta_conversations (
    chat_id,
    last_message_at DESC NULLS LAST,
    updated_at DESC NULLS LAST,
    created_at DESC NULLS LAST
  );

-- Some installations created CRM deals through the legacy SQL bootstrap rather
-- than Prisma, so keep this migration compatible with databases without it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'deals'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_deals_analytics_won_closed_owner
      ON public.deals (workspace_id, closed_at, owner_id)
      INCLUDE (contact_id, value)
      WHERE won = true';
  END IF;
END $$;
