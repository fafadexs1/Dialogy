ALTER TABLE public.nexus_workflows
    ADD COLUMN webhook_token_hash text;

CREATE TABLE public.nexus_schedule_runs (
    workflow_id uuid NOT NULL REFERENCES public.nexus_workflows(id) ON DELETE CASCADE,
    scheduled_for timestamptz NOT NULL,
    execution_id text,
    status text NOT NULL DEFAULT 'claimed'
        CHECK (status IN ('claimed', 'completed', 'failed')),
    claimed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    finished_at timestamptz,
    error text,
    PRIMARY KEY (workflow_id, scheduled_for)
);

CREATE INDEX nexus_schedule_runs_cleanup_idx
    ON public.nexus_schedule_runs (scheduled_for DESC);
