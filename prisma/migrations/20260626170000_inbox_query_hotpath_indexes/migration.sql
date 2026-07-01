-- Inbox hot-path indexes.
-- Defensive blocks keep this migration compatible with older local databases
-- whose schema was partly evolved by runtime maintenance scripts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'last_activity_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_activity_desc
      ON public.chats (workspace_id, last_activity_at DESC, id)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_active_activity_desc
      ON public.chats (workspace_id, last_activity_at DESC, id)
      WHERE status IN (''gerais'', ''atendimentos'')';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_closed_activity_desc
      ON public.chats (workspace_id, last_activity_at DESC, id)
      WHERE status = ''encerrados''';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_agent_activity_desc
      ON public.chats (workspace_id, agent_id, last_activity_at DESC, id)
      WHERE agent_id IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'updated_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_updated_desc
      ON public.chats (workspace_id, updated_at DESC, id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'team_members'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_team_members_user_team
      ON public.team_members (user_id, team_id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evolution_api_instances'
      AND column_name = 'instance_name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_evo_instances_workspace_instance
      ON public.evolution_api_instances (workspace_id, instance_name)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evolution_api_instances'
      AND column_name = 'name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_evo_instances_workspace_name
      ON public.evolution_api_instances (workspace_id, name)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_chat_instance_created_id_desc
  ON public.messages (chat_id, created_at DESC, id DESC)
  WHERE instance_name IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'name'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contacts_inbox_name_trgm
      ON public.contacts USING gin (name gin_trgm_ops)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'phone_number_jid'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contacts_inbox_phone_jid_trgm
      ON public.contacts USING gin (phone_number_jid gin_trgm_ops)
      WHERE phone_number_jid IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'phone'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contacts_inbox_phone_trgm
      ON public.contacts USING gin (phone gin_trgm_ops)
      WHERE phone IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'phone_canonical'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contacts_inbox_phone_canonical_trgm
      ON public.contacts USING gin (phone_canonical gin_trgm_ops)
      WHERE phone_canonical IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'email'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_contacts_inbox_email_trgm
      ON public.contacts USING gin (email gin_trgm_ops)
      WHERE email IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chats' AND column_name = 'protocol'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_chats_inbox_protocol_trgm
      ON public.chats USING gin (protocol gin_trgm_ops)
      WHERE protocol IS NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'content'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_messages_inbox_content_trgm
      ON public.messages USING gin (content gin_trgm_ops)
      WHERE content IS NOT NULL';
  END IF;
END $$;
