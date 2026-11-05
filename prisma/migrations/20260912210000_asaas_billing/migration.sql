-- Additive migration: existing Stripe subscriptions are retained.
ALTER TABLE billing_info ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';
ALTER TABLE billing_info ADD COLUMN IF NOT EXISTS access_until timestamptz;

CREATE TABLE IF NOT EXISTS asaas_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  customer_id text,
  subscription_id text UNIQUE,
  plan_slug text NOT NULL REFERENCES plans(slug),
  price numeric(12,2) NOT NULL CHECK (price > 0),
  status text NOT NULL DEFAULT 'creating',
  create_started_at timestamptz,
  trial_until timestamptz,
  paid_until timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS asaas_payments (
  id text PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES asaas_subscriptions(id),
  plan_slug text NOT NULL,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL,
  billing_type text NOT NULL,
  due_date date NOT NULL,
  paid_at timestamptz,
  invoice_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asaas_payments_subscription_due ON asaas_payments(subscription_id,due_date DESC);
CREATE TABLE IF NOT EXISTS asaas_webhook_events (
  id text PRIMARY KEY,
  event text NOT NULL,
  payment_id text,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE asaas_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE asaas_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON asaas_subscriptions, asaas_payments, asaas_webhook_events FROM anon, authenticated;
