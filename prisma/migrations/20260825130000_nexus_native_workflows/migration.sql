CREATE TABLE public.nexus_workflows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    created_by uuid NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
    draft_definition jsonb NOT NULL,
    published_workflow_id text,
    published_workflow_version text,
    published_revision integer NOT NULL DEFAULT 0,
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT nexus_workflows_published_reference_pair CHECK (
        (published_workflow_id IS NULL AND published_workflow_version IS NULL)
        OR (published_workflow_id IS NOT NULL AND published_workflow_version IS NOT NULL)
    )
);

CREATE INDEX nexus_workflows_workspace_updated_idx
    ON public.nexus_workflows (workspace_id, updated_at DESC);

CREATE INDEX nexus_workflows_published_definition_idx
    ON public.nexus_workflows (published_workflow_id, published_workflow_version)
    WHERE published_workflow_id IS NOT NULL;

