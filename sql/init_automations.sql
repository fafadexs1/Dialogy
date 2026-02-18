-- ============================================
-- CRM Automations — Fase 4
-- ============================================

CREATE TABLE IF NOT EXISTS crm_automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB DEFAULT '{}',
    actions JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_automations_workspace ON crm_automations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_crm_automations_active ON crm_automations(workspace_id, is_active) WHERE is_active = true;
