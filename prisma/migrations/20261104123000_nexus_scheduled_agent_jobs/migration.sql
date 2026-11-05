ALTER TABLE public.nexus_automation_jobs DROP CONSTRAINT IF EXISTS nexus_automation_jobs_kind_check;
ALTER TABLE public.nexus_automation_jobs ADD CONSTRAINT nexus_automation_jobs_kind_check CHECK (kind IN ('webhook','batch','child','recovery','scheduled'));
