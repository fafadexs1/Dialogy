ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS referral_code TEXT;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS referred_by_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_referral_code
ON public.users(referral_code)
WHERE referral_code IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_referred_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_referred_by_user_id_fkey
      FOREIGN KEY (referred_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.referral_bonus_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL,
  referred_user_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  invoice_amount_cents INTEGER NOT NULL,
  bonus_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'brl',
  bonus_percent NUMERIC(5, 2) NOT NULL DEFAULT 15.00,
  billing_reason TEXT,
  invoice_paid_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT referral_bonus_ledger_referrer_user_id_fkey
    FOREIGN KEY (referrer_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT referral_bonus_ledger_referred_user_id_fkey
    FOREIGN KEY (referred_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT referral_bonus_ledger_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_bonus_ledger_invoice
ON public.referral_bonus_ledger(stripe_invoice_id);

CREATE INDEX IF NOT EXISTS idx_referral_bonus_ledger_referrer
ON public.referral_bonus_ledger(referrer_user_id, invoice_paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_referral_bonus_ledger_referred
ON public.referral_bonus_ledger(referred_user_id, invoice_paid_at DESC);
