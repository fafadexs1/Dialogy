CREATE TABLE public.nexus_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by uuid NOT NULL,
    name text NOT NULL,
    credential_type text NOT NULL CHECK (credential_type IN ('bearer', 'api_key', 'basic', 'smtp', 'google_oauth', 'database')),
    encrypted_payload text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (workspace_id, name)
);

CREATE INDEX nexus_credentials_workspace_type_idx
    ON public.nexus_credentials (workspace_id, credential_type, name);

