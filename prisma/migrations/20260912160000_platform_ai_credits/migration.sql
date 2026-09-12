CREATE TABLE public.ai_platform_settings (
  id text PRIMARY KEY CHECK(id='global'),
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_provider_credentials (
  provider text PRIMARY KEY CHECK(provider IN ('googleai','openai','deepseek')),
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_platform_settings,public.ai_provider_credentials FROM anon,authenticated;
GRANT ALL ON public.ai_platform_settings,public.ai_provider_credentials TO service_role;

CREATE TABLE public.ai_credit_wallets (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  balance numeric(24,6) NOT NULL DEFAULT 0,
  reserved numeric(24,6) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ai_credit_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.ai_credit_wallets(workspace_id),
  reference text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('grant','purchase','usage','refund')),
  amount numeric(24,6) NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_credit_entries_workspace_created ON public.ai_credit_entries(workspace_id, created_at DESC);

CREATE TABLE public.ai_credit_calls (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.ai_credit_wallets(workspace_id),
  model text NOT NULL,
  source text NOT NULL,
  reserved numeric(24,6) NOT NULL CHECK (reserved >= 0),
  status text NOT NULL CHECK (status IN ('reserved','settled','released','review')),
  pricing jsonb NOT NULL,
  input_tokens bigint,
  output_tokens bigint,
  resolved_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_credit_calls_workspace_status ON public.ai_credit_calls(workspace_id,status);

CREATE TABLE public.ai_credit_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  credits numeric(24,6) NOT NULL CHECK (credits > 0),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  stripe_session_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_wallets, public.ai_credit_entries, public.ai_credit_calls, public.ai_credit_orders FROM anon, authenticated;
GRANT ALL ON public.ai_credit_wallets, public.ai_credit_entries, public.ai_credit_calls, public.ai_credit_orders TO service_role;
