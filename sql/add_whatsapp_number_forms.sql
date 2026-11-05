-- Memoria da forma de numero que o WhatsApp aceita para cada contato.
--
-- Celular brasileiro tem duas formas possiveis (com e sem o nono digito) e nem
-- sempre a conta responde nas duas. Aqui guardamos qual delas funcionou de fato,
-- para o proximo envio ja sair na forma certa em vez de depender do fallback.
--
-- A chave e o numero normalizado (sempre a forma com nono digito no Brasil), que
-- e a mesma para as duas variantes -- por isso a tabela e global e nao por
-- workspace: a forma aceita e uma propriedade da conta de WhatsApp, nao do
-- workspace que esta enviando.
BEGIN;

CREATE TABLE IF NOT EXISTS public.whatsapp_number_forms (
  normalized_digits text PRIMARY KEY,
  send_digits       text        NOT NULL,
  source            text        NOT NULL,
  confirmed_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.whatsapp_number_forms IS
  'Forma de numero (com/sem nono digito) confirmada como aceita pelo WhatsApp.';
COMMENT ON COLUMN public.whatsapp_number_forms.normalized_digits IS
  'Numero normalizado (BR sempre com nono digito). Chave estavel entre as variantes.';
COMMENT ON COLUMN public.whatsapp_number_forms.send_digits IS
  'Forma que deve ser usada no envio.';
COMMENT ON COLUMN public.whatsapp_number_forms.source IS
  'Como foi aprendida: inbound | send | send_fallback.';

COMMIT;
