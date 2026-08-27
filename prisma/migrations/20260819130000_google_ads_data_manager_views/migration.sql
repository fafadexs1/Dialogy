-- Views dedicadas para integracao direta do Google Data Manager via conexao PostgreSQL / BigQuery

DROP VIEW IF EXISTS public.google_ads_whatsapp_message CASCADE;
DROP VIEW IF EXISTS public.google_ads_lead_qualified CASCADE;
DROP VIEW IF EXISTS public.google_ads_cliente_instalado CASCADE;
DROP VIEW IF EXISTS public.google_ads_conversions_all CASCADE;

-- 1. View para Mensagens WhatsApp Recebidas (Topo de Funil / Conversao Secundaria)
CREATE VIEW public.google_ads_whatsapp_message AS
SELECT
    COALESCE(ce.transaction_id, 'dialogy:' || ce.workspace_id || ':whatsapp_message_received:' || aa.chat_id || ':' || aa.message_id) AS transaction_id,
    ac.gclid,
    ac.gbraid,
    ac.wbraid,
    ce.created_at AS conversion_time,
    'CRM' AS event_source,
    COALESCE(ce.conversion_value, 1) AS conversion_value,
    COALESCE(ce.currency, 'BRL') AS currency,
    ce.product_destination_id,
    ce.google_ads_customer_id,
    ce.workspace_id,
    NULLIF(LOWER(TRIM(ct.email)), '') AS contact_email,
    CASE
        WHEN regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g') = '' THEN NULL
        WHEN length(regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')) IN (10, 11)
            THEN '+55' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
        ELSE '+' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
    END AS contact_phone
FROM conversion_exports ce
JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
JOIN ad_clicks ac ON ac.id = aa.ad_click_id
LEFT JOIN contacts ct ON ct.id = aa.contact_id::uuid
WHERE ce.event_name = 'whatsapp_message_received'
  AND (ac.gclid IS NOT NULL OR ac.gbraid IS NOT NULL OR ac.wbraid IS NOT NULL OR ct.email IS NOT NULL OR ct.phone IS NOT NULL)
  AND COALESCE(aa.export_eligible, true) = true
  AND aa.confidence IN ('high', 'deterministic');

-- 2. View para Leads Qualificados (Meio de Funil)
CREATE VIEW public.google_ads_lead_qualified AS
SELECT
    COALESCE(ce.transaction_id, 'dialogy:' || ce.workspace_id || ':lead_qualificado:' || COALESCE(ce.deal_id, aa.contact_id)) AS transaction_id,
    ac.gclid,
    ac.gbraid,
    ac.wbraid,
    ce.created_at AS conversion_time,
    'CRM' AS event_source,
    COALESCE(ce.conversion_value, 1) AS conversion_value,
    COALESCE(ce.currency, 'BRL') AS currency,
    ce.product_destination_id,
    ce.google_ads_customer_id,
    ce.workspace_id,
    NULLIF(LOWER(TRIM(ct.email)), '') AS contact_email,
    CASE
        WHEN regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g') = '' THEN NULL
        WHEN length(regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')) IN (10, 11)
            THEN '+55' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
        ELSE '+' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
    END AS contact_phone
FROM conversion_exports ce
JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
JOIN ad_clicks ac ON ac.id = aa.ad_click_id
LEFT JOIN contacts ct ON ct.id = aa.contact_id::uuid
WHERE ce.event_name = 'lead_qualificado'
  AND (ac.gclid IS NOT NULL OR ac.gbraid IS NOT NULL OR ac.wbraid IS NOT NULL OR ct.email IS NOT NULL OR ct.phone IS NOT NULL)
  AND COALESCE(aa.export_eligible, true) = true;

-- 3. View para Cliente Instalado / Venda Fechada (Fundo de Funil / Conversao Principal com Valor Real)
CREATE VIEW public.google_ads_cliente_instalado AS
SELECT
    COALESCE(ce.transaction_id, 'dialogy:' || ce.workspace_id || ':sale_won:' || COALESCE(ce.deal_id, aa.contact_id)) AS transaction_id,
    ac.gclid,
    ac.gbraid,
    ac.wbraid,
    ce.created_at AS conversion_time,
    'CRM' AS event_source,
    COALESCE(ce.conversion_value, 1) AS conversion_value,
    COALESCE(ce.currency, 'BRL') AS currency,
    ce.product_destination_id,
    ce.google_ads_customer_id,
    ce.workspace_id,
    ce.deal_id,
    NULLIF(LOWER(TRIM(ct.email)), '') AS contact_email,
    CASE
        WHEN regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g') = '' THEN NULL
        WHEN length(regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')) IN (10, 11)
            THEN '+55' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
        ELSE '+' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
    END AS contact_phone
FROM conversion_exports ce
JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
JOIN ad_clicks ac ON ac.id = aa.ad_click_id
LEFT JOIN contacts ct ON ct.id = aa.contact_id::uuid
WHERE ce.event_name IN ('sale_won', 'cliente_instalado', 'instalado')
  AND (ac.gclid IS NOT NULL OR ac.gbraid IS NOT NULL OR ac.wbraid IS NOT NULL OR ct.email IS NOT NULL OR ct.phone IS NOT NULL)
  AND COALESCE(aa.export_eligible, true) = true;

-- 4. View Unificada com todas as etapas do funil
CREATE VIEW public.google_ads_conversions_all AS
SELECT
    ce.id AS export_id,
    COALESCE(ce.transaction_id, 'dialogy:' || ce.workspace_id || ':' || ce.event_name || ':' || COALESCE(ce.deal_id, aa.contact_id, ce.id)) AS transaction_id,
    ce.event_name,
    ac.gclid,
    ac.gbraid,
    ac.wbraid,
    ce.created_at AS conversion_time,
    'CRM' AS event_source,
    COALESCE(ce.conversion_value, 1) AS conversion_value,
    COALESCE(ce.currency, 'BRL') AS currency,
    ce.product_destination_id,
    ce.google_ads_customer_id,
    ce.workspace_id,
    ce.deal_id,
    NULLIF(LOWER(TRIM(ct.email)), '') AS contact_email,
    CASE
        WHEN regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g') = '' THEN NULL
        WHEN length(regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')) IN (10, 11)
            THEN '+55' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
        ELSE '+' || regexp_replace(split_part(COALESCE(ct.phone, ct.phone_number_jid, ''), '@', 1), '\D', '', 'g')
    END AS contact_phone,
    aa.confidence,
    aa.match_type
FROM conversion_exports ce
JOIN ad_attributions aa ON aa.id = ce.ad_attribution_id
JOIN ad_clicks ac ON ac.id = aa.ad_click_id
LEFT JOIN contacts ct ON ct.id = aa.contact_id::uuid
WHERE (ac.gclid IS NOT NULL OR ac.gbraid IS NOT NULL OR ac.wbraid IS NOT NULL OR ct.email IS NOT NULL OR ct.phone IS NOT NULL)
  AND COALESCE(aa.export_eligible, true) = true;
