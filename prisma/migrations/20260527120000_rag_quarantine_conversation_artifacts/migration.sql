DELETE FROM public.embeddings_documents ed
USING public.autopilot_configs ac,
      LATERAL jsonb_array_elements(COALESCE(ac.knowledge_base_documents, '[]'::jsonb)) AS doc(value)
WHERE ed.autopilot_config_id = ac.id
  AND ed.document_id::text = doc.value->>'id'
  AND COALESCE(doc.value->>'name', '') ~* '^(conversa|chat|conversation)([[:space:]]|$)'
  AND NULLIF(BTRIM(COALESCE(doc.value->>'canonicalAnswer', doc.value->>'canonical_answer', '')), '') IS NULL;

DELETE FROM public.embeddings_documents ed
WHERE ed.autopilot_config_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.autopilot_configs ac
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ac.knowledge_base_documents, '[]'::jsonb)) AS doc(value)
    WHERE ac.id = ed.autopilot_config_id
      AND doc.value->>'id' = ed.document_id::text
  );
