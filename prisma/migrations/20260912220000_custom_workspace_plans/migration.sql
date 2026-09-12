-- Public offers remain public. Custom offers require an explicit workspace assignment.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'public'
  CHECK (scope IN ('public', 'custom'));
ALTER TABLE public.plans ADD CONSTRAINT plans_custom_not_default CHECK (scope <> 'custom' OR is_default = false);

CREATE TABLE public.plan_workspaces (
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, workspace_id)
);
CREATE INDEX plan_workspaces_workspace_idx ON public.plan_workspaces(workspace_id, plan_id);
ALTER TABLE public.plan_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_workspaces FROM PUBLIC, anon, authenticated;

-- Private prices and entitlements are read only by authenticated server actions.
-- The previous policies exposed every plan to anonymous Data API requests.
DROP POLICY IF EXISTS "Anyone can view plans" ON public.plans;
CREATE POLICY "Public active offers" ON public.plans FOR SELECT TO anon, authenticated
  USING (scope = 'public' AND is_active);
DROP POLICY IF EXISTS "Public view plan integrations" ON public.plan_integrations;
CREATE POLICY "Public offer integrations" ON public.plan_integrations FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_id AND p.scope = 'public' AND p.is_active));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.plans, public.plan_integrations FROM anon, authenticated;
