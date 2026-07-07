BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS opted_out_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc', now());

ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT timezone('utc', now());

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz;

UPDATE public.campaign_recipients
SET scheduled_at = COALESCE(scheduled_at, timezone('utc', now())),
    status = CASE WHEN status = 'pending' THEN 'waiting' ELSE status END
WHERE scheduled_at IS NULL OR status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_campaign_contact
  ON public.campaign_recipients(campaign_id, contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_message
  ON public.campaign_recipients(message_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_due
  ON public.campaign_recipients(scheduled_at, campaign_id)
  WHERE status IN ('waiting', 'scheduled');

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_locked
  ON public.campaign_recipients(locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_contacts_marketing_opt_out
  ON public.contacts(workspace_id, marketing_opt_out_at)
  WHERE marketing_opt_out_at IS NOT NULL;

COMMIT;
