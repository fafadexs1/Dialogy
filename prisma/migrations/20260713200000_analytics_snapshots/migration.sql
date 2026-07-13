-- Durable analytics cache. Raw operational tables remain the source of truth;
-- these rows are disposable, versioned projections used for instant reads.
CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
  cache_key TEXT PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric_kind TEXT NOT NULL,
  team_id UUID,
  agent_id UUID,
  date_from TIMESTAMPTZ NOT NULL,
  date_to TIMESTAMPTZ NOT NULL,
  counter_mode TEXT,
  payload JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_at TIMESTAMPTZ,
  refresh_started_at TIMESTAMPTZ,
  last_error TEXT,
  CONSTRAINT analytics_snapshots_metric_kind_check
    CHECK (metric_kind IN ('overview', 'agent_performance', 'conversions')),
  CONSTRAINT analytics_snapshots_date_order_check
    CHECK (date_to >= date_from)
);

ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;

-- Snapshots are an internal server-side projection and must never be exposed
-- through the Supabase Data API. The database owner used by the backend keeps
-- its normal owner access even with RLS enabled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.analytics_snapshots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.analytics_snapshots FROM authenticated;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_workspace_range
  ON public.analytics_snapshots (workspace_id, metric_kind, date_from, date_to);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_refresh_due
  ON public.analytics_snapshots (stale_at)
  WHERE stale_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_compatible_lookup
  ON public.analytics_snapshots (
    workspace_id,
    metric_kind,
    team_id,
    agent_id,
    counter_mode,
    generated_at DESC
  );

COMMENT ON TABLE public.analytics_snapshots IS
  'Versioned, durable analytics results served stale-while-revalidate. Historical rows are intentionally retained.';
