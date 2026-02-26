-- Additional indexes for inbox hot paths.
-- Focus: chat list loading, message window pagination, and meta-contact lookup.

CREATE INDEX IF NOT EXISTS idx_messages_chat_created_id_desc
    ON messages (chat_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_meta_contacts_contact_created_desc
    ON meta_contacts (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chats_workspace_contact_id
    ON chats (workspace_id, contact_id, id);

CREATE INDEX IF NOT EXISTS idx_chats_workspace_status_agent
    ON chats (workspace_id, status, agent_id);
