DELETE FROM public.embeddings_documents ed
WHERE (ed.workspace_id IS NULL OR ed.autopilot_config_id IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM public.autopilot_configs ac
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ac.knowledge_base_documents, '[]'::jsonb)) AS doc(value)
    WHERE doc.value->>'id' = ed.document_id::text
  );

UPDATE public.chat_case_memories memory
SET autopilot_config_id = chat.autopilot_config_id,
    updated_at = NOW()
FROM public.chats chat
WHERE memory.chat_id = chat.id
  AND memory.autopilot_config_id IS NULL
  AND chat.autopilot_config_id IS NOT NULL;
