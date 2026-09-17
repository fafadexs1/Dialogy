CREATE OR REPLACE FUNCTION public.update_contact_phone_digits()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
        DECLARE
            digits_set text[];
            raw_jid text;
            raw_phone text;
            canonical text;
            alt text;
            subscriber text;
            area_code text;
        BEGIN
            -- Extract only digits
            raw_jid := regexp_replace(COALESCE(NEW.phone_number_jid, ''), '[^0-9]', '', 'g');
            raw_phone := regexp_replace(COALESCE(NEW.phone, ''), '[^0-9]', '', 'g');
            
            -- If both are empty, do nothing
            IF raw_jid = '' AND raw_phone = '' THEN
                RETURN NEW;
            END IF;

            -- Priority to JID
            IF raw_jid = '' THEN
                raw_jid := raw_phone;
            END IF;

            -- Brazil Normalization (55 + 2 area + 8 or 9 subscriber)
            IF raw_jid ~ '^55[1-9]{2}[0-9]{8,9}$' THEN
                area_code := substring(raw_jid from 3 for 2);
                subscriber := substring(raw_jid from 5);
                
                -- If it's 8 digits and starts with 6-9, it's a mobile missing the 9
                IF length(subscriber) = 8 AND subscriber ~ '^[6-9]' THEN
                    canonical := '55' || area_code || '9' || subscriber;
                    alt := raw_jid;
                -- If it's 9 digits and starts with 9, it's already canonical
                ELSIF length(subscriber) = 9 AND subscriber ~ '^9' THEN
                    canonical := raw_jid;
                    alt := '55' || area_code || substring(subscriber from 2);
                ELSE
                    canonical := raw_jid;
                    alt := null;
                END IF;
            ELSE
                canonical := raw_jid;
                alt := null;
            END IF;

            -- Update field
            NEW.phone_canonical := canonical;
            
            -- Populate phone_digits array for GIN search
            digits_set := ARRAY[]::text[];
            IF canonical IS NOT NULL AND canonical <> '' THEN
                digits_set := array_append(digits_set, canonical);
            END IF;
            IF alt IS NOT NULL AND alt <> '' AND alt <> canonical THEN
                digits_set := array_append(digits_set, alt);
            END IF;
            IF raw_phone <> '' AND raw_phone <> canonical AND raw_phone <> alt THEN
                digits_set := array_append(digits_set, raw_phone);
            END IF;
            IF raw_jid <> '' AND raw_jid <> canonical AND raw_jid <> alt AND raw_jid <> raw_phone THEN
                digits_set := array_append(digits_set, raw_jid);
            END IF;
            
            -- Ensure distinct and not null
            NEW.phone_digits := (SELECT array_agg(DISTINCT x) FROM unnest(digits_set) x WHERE x IS NOT NULL AND x <> '');
            
            RETURN NEW;
        END;
        $function$
