-- Campanhas com mensagem interativa (botões de resposta ou lista) no WhatsApp conectado.
BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS interactive_payload jsonb;

COMMIT;
