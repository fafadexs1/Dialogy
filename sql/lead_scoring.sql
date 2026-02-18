-- ============================================
-- Lead Scoring — Fase 3
-- ============================================

-- Adicionar coluna de score e timestamp de atualização
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;

-- Índice para consultas ordenadas por score
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON contacts(workspace_id, lead_score DESC);
