-- Additive indexes for contact-thread lookups used by the inbox.
-- This migration does not delete or rewrite contact/message/chat data.

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_phone_number_jid
    ON contacts (workspace_id, phone_number_jid);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_phone_digits
    ON contacts (
        workspace_id,
        (regexp_replace(COALESCE(phone_number_jid, phone, ''), '[^0-9]', '', 'g'))
    );
