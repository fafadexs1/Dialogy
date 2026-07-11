-- Reconcile databases where the temporary Meta routing schema was deployed
-- before the canonical inbox/outbox migration.
--
-- New deliveries freeze ownership in cluster_id, instance_id, workspace_id and
-- route_version. route_frozen remains only for reading historical rows.
ALTER TABLE public.meta_whatsapp_deliveries
  ALTER COLUMN route_frozen DROP NOT NULL;
