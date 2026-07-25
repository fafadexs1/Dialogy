-- =============================================================================
-- FASE 0 — Estancamento de capacidade
-- =============================================================================
-- Objetivo: remover o gargalo que impede o sistema de passar de ~150 conexoes
-- simultaneas, sem deploy de codigo.
--
-- Contexto medido em producao (25/07/2026):
--   - Postgres 17.6, 8 vCPU, shared_buffers 9 GB, cache hit 99,43%
--   - chats: 162.403 linhas | messages: 1.880.978 linhas
--   - max_connections = 100, ~41 livres
--
-- IMPORTANTE — executar bloco a bloco, NAO como um script unico:
--   CREATE/DROP INDEX CONCURRENTLY nao pode rodar dentro de transacao.
--   Se o cliente SQL envolver tudo em BEGIN/COMMIT, os blocos 1 e 3 falham.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- BLOCO 1 — O indice que falta  [o ganho principal]
-- -----------------------------------------------------------------------------
-- A query de delta da lista de chats (actions/chats.ts:2697) filtra por
--   workspace_id = $1 AND (updated_at >= $2 OR last_activity_at >= $2)
-- Existe indice para last_activity_at, mas nenhum para updated_at. O OR entre
-- uma coluna indexada e uma nao indexada forca Parallel Seq Scan.
--
-- Medido:  com OR   -> 51,7 ms, 6.283 buffers, 2 workers paralelos
--          sem OR   ->  0,096 ms,   14 buffers, 1 processo
--
-- CONCURRENTLY nao bloqueia escrita. Leva alguns segundos numa tabela de 49 MB.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chats_workspace_updated_at
    ON public.chats (workspace_id, updated_at DESC);

-- Verificar que ficou valido (CONCURRENTLY pode falhar e deixar indice INVALID):
--   SELECT indexrelid::regclass AS indice, indisvalid
--   FROM pg_index WHERE indexrelid = 'idx_chats_workspace_updated_at'::regclass;
-- Se indisvalid = false:
--   DROP INDEX CONCURRENTLY idx_chats_workspace_updated_at;  -- e repetir


-- -----------------------------------------------------------------------------
-- BLOCO 2 — Timeouts e memoria de trabalho
-- -----------------------------------------------------------------------------
-- Hoje: statement_timeout = 0, idle_in_transaction_session_timeout = 0.
-- Nenhuma query tem prazo. Combinado com connectionTimeoutMillis = 0 no pool
-- da aplicacao, a saturacao se manifesta como travamento silencioso em vez de
-- erro — o pior modo de falha possivel.
--
-- Evidencia para o valor escolhido: em 33h de coleta do pg_stat_statements,
-- UM unico tipo de query passou de 15s (a de mensagens do app mobile, pico de
-- 86,4s — que e defeito, nao operacao legitima). A segunda mais lenta faz 4,2s.
-- 20s deixa margem confortavel para o job de retencao que roda a cada 6h.

ALTER ROLE postgres IN DATABASE postgres SET statement_timeout = '20s';
ALTER ROLE postgres IN DATABASE postgres SET idle_in_transaction_session_timeout = '120s';

-- work_mem: 4 MB e baixo para os DISTINCT ON / sorts deste schema — ha 83
-- arquivos temporarios registrados (spill para disco). Com 9 GB de
-- shared_buffers e 18 GB de effective_cache_size, ha folga de sobra.
ALTER ROLE postgres IN DATABASE postgres SET work_mem = '16MB';

-- ATENCAO: ALTER ROLE ... SET so vale para conexoes NOVAS. O pool da aplicacao
-- mantem conexoes por 40+ minutos, entao o efeito e gradual. Para valer agora:
--   docker compose restart dialogy worker worker-ai worker-campaign worker-meta-relay
--
-- Conferir depois do restart:
--   SELECT name, setting FROM pg_settings
--   WHERE name IN ('statement_timeout','idle_in_transaction_session_timeout','work_mem');


-- -----------------------------------------------------------------------------
-- BLOCO 3 — Indices redundantes por estrutura
-- -----------------------------------------------------------------------------
-- NAO usamos idx_scan = 0 como criterio: as estatisticas foram zeradas em
-- 24/07 04:11, ou seja ha apenas ~33h. Um indice de relatorio semanal ou de
-- tela administrativa apareceria com zero usos sem ser inutil.
--
-- Criterio usado aqui e independente de estatistica: cada indice abaixo e
-- PREFIXO ESTRITO de outro que permanece. Qualquer plano que use o menor pode
-- usar o maior — a remocao e segura por construcao.
--
--   idx_chats_workspace              (workspace_id)
--       ⊂ idx_chats_workspace_status_last_activity (workspace_id, status, last_activity_at DESC)
--   idx_chats_workspace_status       (workspace_id, status)
--       ⊂ idx_chats_workspace_status_last_activity
--   idx_chats_workspace_status_agent (workspace_id, status, agent_id)
--       ⊂ idx_chats_workspace_status_agent_last_activity
--   idx_messages_chat                (chat_id)
--       ⊂ idx_messages_chat_created_id_desc (chat_id, created_at DESC, id DESC)
--   idx_messages_chat_created        (chat_id, created_at DESC)
--       ⊂ idx_messages_chat_created_id_desc
--   idx_messages_workspace           (workspace_id)
--       ⊂ idx_messages_workspace_created_chat (workspace_id, created_at, chat_id)
--
-- Ganho: menos escrita por INSERT/UPDATE nas duas tabelas mais quentes.
-- A tabela chats tem 17 indices ocupando 137 MB contra 49 MB de dados.

-- Antes de remover, ver quanto sera recuperado:
--   SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamanho
--   FROM pg_stat_user_indexes
--   WHERE indexrelname IN (
--     'idx_chats_workspace','idx_chats_workspace_status','idx_chats_workspace_status_agent',
--     'idx_messages_chat','idx_messages_chat_created','idx_messages_workspace')
--   ORDER BY pg_relation_size(indexrelid) DESC;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_chats_workspace;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chats_workspace_status;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_chats_workspace_status_agent;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_messages_chat;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_messages_chat_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_messages_workspace;


-- -----------------------------------------------------------------------------
-- BLOCO 4 — Candidatos que NAO devem ser removidos agora
-- -----------------------------------------------------------------------------
-- Registrados para revisitar depois de 7-14 dias de estatistica acumulada.
--
--   idx_messages_workspace_created (workspace_id, created_at DESC) — 99 MB
--     Provavelmente redundante com idx_messages_workspace_created_chat via
--     backward index scan, mas o argumento e sutil demais para aplicar sem
--     observacao. Reavaliar.
--
--   embeddings_messages_vector_idx — 350 MB, zero usos em 33h
--     E o indice vetorial do RAG. Zero uso sugere que a busca semantica nao
--     esta sendo exercitada, e nao que o indice seja inutil. Investigar o
--     motivo antes de qualquer remocao — pode ser funcionalidade quebrada.
--
--   idx_chats_protocol — 19 MB, zero usos
--     E UNIQUE: sustenta uma restricao de integridade. NAO remover.


-- -----------------------------------------------------------------------------
-- BLOCO 5 — Validacao
-- -----------------------------------------------------------------------------
-- Confirmar que o plano do delta mudou de Seq Scan para Index Scan.
-- Substituir o UUID pelo workspace com mais chats.

-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT c.id FROM chats c
-- WHERE c.workspace_id = 'e3b476a1-5de8-4744-80b5-a5d23fe15fab'
--   AND (c.updated_at >= now() - interval '30 seconds'
--        OR c.last_activity_at >= now() - interval '30 seconds');
--
-- Esperado: Bitmap Heap Scan combinando os dois indices via BitmapOr,
-- com buffers na casa das dezenas em vez de 6.283.
--
-- Observacao: o ganho completo (0,096 ms) so vem na Fase 1, quando o OR for
-- reescrito como UNION em fetchChatsDelta. Este indice sozinho ja permite ao
-- planner usar BitmapOr em vez de varrer a tabela inteira.


-- -----------------------------------------------------------------------------
-- ROLLBACK — tudo aqui e reversivel
-- -----------------------------------------------------------------------------
-- Bloco 1:
--   DROP INDEX CONCURRENTLY IF EXISTS public.idx_chats_workspace_updated_at;
--
-- Bloco 2:
--   ALTER ROLE postgres IN DATABASE postgres RESET statement_timeout;
--   ALTER ROLE postgres IN DATABASE postgres RESET idle_in_transaction_session_timeout;
--   ALTER ROLE postgres IN DATABASE postgres RESET work_mem;
--
-- Bloco 3 (recriar, se necessario):
--   CREATE INDEX CONCURRENTLY idx_chats_workspace ON public.chats (workspace_id);
--   CREATE INDEX CONCURRENTLY idx_chats_workspace_status ON public.chats (workspace_id, status);
--   CREATE INDEX CONCURRENTLY idx_chats_workspace_status_agent ON public.chats (workspace_id, status, agent_id);
--   CREATE INDEX CONCURRENTLY idx_messages_chat ON public.messages (chat_id);
--   CREATE INDEX CONCURRENTLY idx_messages_chat_created ON public.messages (chat_id, created_at DESC);
--   CREATE INDEX CONCURRENTLY idx_messages_workspace ON public.messages (workspace_id);
