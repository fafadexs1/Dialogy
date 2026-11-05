CREATE TABLE public.nexus_workflow_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 0 AND 10000000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days')
);
CREATE INDEX nexus_workflow_files_scope_idx ON public.nexus_workflow_files(workspace_id,id);
CREATE INDEX nexus_workflow_files_expiry_idx ON public.nexus_workflow_files(expires_at);
ALTER TABLE public.nexus_workflow_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_workflow_files FROM anon, authenticated;

CREATE TABLE public.nexus_automation_policies (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  max_concurrency integer NOT NULL DEFAULT 5 CHECK(max_concurrency BETWEEN 1 AND 5)
);
ALTER TABLE public.nexus_automation_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_automation_policies FROM anon,authenticated;

ALTER TABLE public.nexus_credentials DROP CONSTRAINT nexus_credentials_credential_type_check;
ALTER TABLE public.nexus_credentials ADD CONSTRAINT nexus_credentials_credential_type_check
  CHECK (credential_type IN ('bearer','api_key','basic','smtp','google_oauth','database','oauth2'));

CREATE TABLE public.nexus_automation_jobs (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('webhook','batch','child','recovery')),
  parent_id text REFERENCES public.nexus_automation_jobs(id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting','completed','failed','cancelled','uncertain')),
  encrypted_payload text NOT NULL,
  encrypted_result text,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  attempts integer NOT NULL DEFAULT 0,
  model_reserved integer NOT NULL DEFAULT 0,
  tool_reserved integer NOT NULL DEFAULT 0,
  budget_reserved boolean NOT NULL DEFAULT false,
  concurrency integer NOT NULL DEFAULT 1 CHECK(concurrency BETWEEN 1 AND 5),
  model_available integer NOT NULL DEFAULT 0 CHECK(model_available>=0),
  tool_available integer NOT NULL DEFAULT 0 CHECK(tool_available>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nexus_automation_jobs_due_idx ON public.nexus_automation_jobs(available_at,lease_until) WHERE status IN ('queued','running','waiting');
CREATE INDEX nexus_automation_jobs_parent_idx ON public.nexus_automation_jobs(workspace_id,parent_id,status);
CREATE INDEX nexus_automation_jobs_execution_idx ON public.nexus_automation_jobs(workspace_id,execution_id);
ALTER TABLE public.nexus_automation_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_automation_jobs FROM anon,authenticated;

CREATE TABLE public.nexus_automation_approvals (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  node_id text NOT NULL,
  title text NOT NULL,
  arguments_hash text NOT NULL,
  encrypted_arguments text NOT NULL,
  resume_token text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired','cancelled')),
  decided_by uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz
);
CREATE INDEX nexus_automation_approvals_pending_idx ON public.nexus_automation_approvals(workspace_id,expires_at) WHERE status='pending';
CREATE INDEX nexus_automation_approvals_execution_idx ON public.nexus_automation_approvals(workspace_id,execution_id);
ALTER TABLE public.nexus_automation_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_automation_approvals FROM anon,authenticated;

CREATE TABLE public.nexus_automation_effects (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  arguments_hash text NOT NULL,
  encrypted_result text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.nexus_automation_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_automation_effects FROM anon,authenticated;

CREATE TABLE public.nexus_connectors (
  id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  encrypted_definition text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','revoked')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,id,version)
);
CREATE INDEX nexus_connectors_library_idx ON public.nexus_connectors(workspace_id,status,name);
ALTER TABLE public.nexus_connectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_connectors FROM anon,authenticated;

CREATE TABLE public.nexus_webhook_test_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  encrypted_sample text,
  expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '10 minutes'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nexus_webhook_test_expiry_idx ON public.nexus_webhook_test_sessions(expires_at);
ALTER TABLE public.nexus_webhook_test_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_webhook_test_sessions FROM anon,authenticated;

CREATE TABLE public.nexus_automation_events (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  event_name text NOT NULL,
  encrypted_payload text NOT NULL,
  resume_token text,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nexus_automation_events_pending_idx ON public.nexus_automation_events(workspace_id,execution_id,created_at) WHERE consumed_at IS NULL;
ALTER TABLE public.nexus_automation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_automation_events FROM anon,authenticated;
