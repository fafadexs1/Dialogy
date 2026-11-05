-- Run after the existing phone normalization trigger. BSUIDs must never be
-- searchable as synthetic telephone numbers. Existing phone rows are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.preserve_bsuid_contact_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.phone_number_jid LIKE 'bsuid:%' THEN
    NEW.phone_canonical := NULL;
    NEW.phone_digits := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_bsuid_contact_identity() FROM PUBLIC;

DROP TRIGGER IF EXISTS zz_contacts_preserve_bsuid_identity ON public.contacts;
CREATE TRIGGER zz_contacts_preserve_bsuid_identity
BEFORE INSERT OR UPDATE ON public.contacts
FOR EACH ROW
WHEN (NEW.phone_number_jid LIKE 'bsuid:%')
EXECUTE FUNCTION public.preserve_bsuid_contact_identity();

COMMIT;
