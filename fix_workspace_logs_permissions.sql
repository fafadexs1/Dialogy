-- Create the table if it doesn't exist (inferred schema from logger.ts)
CREATE TABLE IF NOT EXISTS workspace_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  workspace_id UUID,
  user_id UUID,
  action TEXT NOT NULL,
  payload JSONB
);

-- Grant full permissions to the service_role (used by the backend logger)
GRANT ALL ON TABLE workspace_logs TO service_role;

-- Grant usage on the sequence if the ID is auto-incrementing (optional but recommended)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Verify the table owner (optional)
-- ALTER TABLE workspace_logs OWNER TO postgres;
