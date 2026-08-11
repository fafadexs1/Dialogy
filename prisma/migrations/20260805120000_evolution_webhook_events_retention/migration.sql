-- Retenção da caixa de entrada durável de webhooks da Evolution.
--
-- A tabela é uma fila de trabalho, mas nunca teve poda: em 05/08/2026 estava com
-- 482.417 linhas (779 MB), 100% delas já `processed`, a mais antiga de 01/07.
--
-- Os índices existentes são todos parciais sobre os estados em voo
-- (`pending`/`failed`/`processing`) ou por workspace. Nenhum atende o filtro da
-- rotina de retenção (`status = 'processed' AND created_at < corte`): medido com
-- EXPLAIN, o plano cai em Seq Scan + Sort de 161k linhas (custo 88.657) a cada
-- lote. Com o índice vira um top-N já ordenado.
--
-- ATENÇÃO em produção: este `CREATE INDEX` pega SHARE lock e bloqueia INSERT/
-- UPDATE/DELETE na tabela enquanto constrói — e esta tabela é a porta de entrada
-- dos webhooks. Crie antes, fora de transação, com:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_webhook_events_processed_retention
--       ON evolution_webhook_events (created_at) WHERE status = 'processed';
--
-- O IF NOT EXISTS abaixo torna esta migration um no-op nesse caso. Em ambientes
-- novos (tabela vazia) rodar direto por aqui não tem custo.
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_processed_retention
    ON evolution_webhook_events (created_at)
    WHERE status = 'processed';

-- Tabela de altíssima rotatividade: todo evento é inserido, atualizado algumas
-- vezes e depois apagado pela retenção. Com o scale factor padrão (20%) o
-- autovacuum só acordaria depois de ~96k tuplas mortas, deixando a heap inchar
-- entre passagens.
ALTER TABLE evolution_webhook_events SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);
