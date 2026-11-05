-- Keep imported values scoped to the campaign recipient, including scheduled sends and retries.
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS csv_data jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(csv_data) = 'object');
