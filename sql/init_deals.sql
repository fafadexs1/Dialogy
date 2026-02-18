-- ============================================
-- CRM Deals & Stage Log
-- ============================================

-- Deals (oportunidades de venda)
CREATE TABLE IF NOT EXISTS deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    contact_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    value DECIMAL(15, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
    stage VARCHAR(50) NOT NULL DEFAULT 'novo',
    probability INTEGER DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
    expected_close_date DATE,
    closed_at TIMESTAMPTZ,
    won BOOLEAN,
    owner_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_contact ON deals(contact_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(workspace_id, stage);
CREATE INDEX IF NOT EXISTS idx_deals_workspace_won ON deals(workspace_id, won);

-- Stage change log (histórico de movimentações no funil)
CREATE TABLE IF NOT EXISTS contact_stage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL,
    from_stage VARCHAR(50),
    to_stage VARCHAR(50) NOT NULL,
    changed_by UUID,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_log_contact ON contact_stage_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_stage_log_date ON contact_stage_log(changed_at DESC);
