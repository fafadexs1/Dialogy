-- A committed checkpoint survives process failure/timeouts during card payment.
-- No card number, security code or holder data is persisted.
ALTER TABLE asaas_payments ADD COLUMN IF NOT EXISTS card_attempt_started_at timestamptz;
