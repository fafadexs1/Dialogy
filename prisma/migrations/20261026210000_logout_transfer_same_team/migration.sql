ALTER TABLE public.logout_transfer_settings DROP CONSTRAINT IF EXISTS logout_transfer_settings_destination_check;
ALTER TABLE public.logout_transfer_settings DROP CONSTRAINT IF EXISTS logout_transfer_settings_check;
ALTER TABLE public.logout_transfer_settings ALTER COLUMN destination SET DEFAULT 'same_team';
UPDATE public.logout_transfer_settings SET destination='same_team', destination_id=NULL WHERE destination <> 'same_team' OR destination_id IS NOT NULL;
ALTER TABLE public.logout_transfer_settings ADD CONSTRAINT logout_transfer_settings_destination_check CHECK (destination = 'same_team');
ALTER TABLE public.logout_transfer_settings ADD CONSTRAINT logout_transfer_settings_check CHECK (destination_id IS NULL);
