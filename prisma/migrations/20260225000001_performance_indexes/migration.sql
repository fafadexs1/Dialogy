-- Performance indexes for chat loading optimization
-- These indexes target the exact query patterns used by fetchChats and getChatMessagesWindow

-- Index for the last_message_details CTE (DISTINCT ON m.chat_id ORDER BY m.created_at DESC)
-- This is the single most impactful index: it eliminates the full-table scan on messages
CREATE INDEX IF NOT EXISTS idx_messages_chat_created
    ON messages (chat_id, created_at DESC);

-- Index for workspace + status filtering on chats (used in filtered_chats CTE)
CREATE INDEX IF NOT EXISTS idx_chats_workspace_status
    ON chats (workspace_id, status);

-- Partial index for unread message counting (the COALESCE(m.is_read, false) = false pattern)
CREATE INDEX IF NOT EXISTS idx_messages_unread
    ON messages (chat_id)
    WHERE from_me = false AND COALESCE(is_read, false) = false;

-- Index for delta sync and workspace-level message queries
CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
    ON messages (workspace_id, created_at DESC);

-- Index for getChatMessagesWindow contact-based thread loading
CREATE INDEX IF NOT EXISTS idx_chats_contact
    ON chats (contact_id, workspace_id);
