CREATE TABLE public.nexus_workflow_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nexus_workflow_id uuid NOT NULL REFERENCES public.nexus_workflows(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    revision integer NOT NULL CHECK (revision > 0),
    published_revision integer CHECK (published_revision IS NULL OR published_revision > 0),
    definition jsonb NOT NULL,
    description text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'save'
        CHECK (source IN ('create', 'save', 'publish', 'restore', 'duplicate', 'import')),
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (nexus_workflow_id, revision)
);

CREATE INDEX nexus_workflow_versions_workspace_flow_idx
    ON public.nexus_workflow_versions (workspace_id, nexus_workflow_id, revision DESC);

CREATE INDEX nexus_workflow_versions_published_idx
    ON public.nexus_workflow_versions (nexus_workflow_id, published_revision DESC)
    WHERE published_revision IS NOT NULL;

INSERT INTO public.nexus_workflow_versions (
    nexus_workflow_id,
    workspace_id,
    revision,
    published_revision,
    definition,
    description,
    source,
    created_by,
    created_at
)
SELECT
    workflow.id,
    workflow.workspace_id,
    1,
    CASE WHEN workflow.published_revision > 0 THEN workflow.published_revision ELSE NULL END,
    workflow.draft_definition,
    'Estado inicial preservado ao ativar o histórico nativo do Nexus.',
    CASE WHEN workflow.published_revision > 0 THEN 'publish' ELSE 'create' END,
    workflow.created_by,
    workflow.updated_at
FROM public.nexus_workflows workflow
ON CONFLICT (nexus_workflow_id, revision) DO NOTHING;
