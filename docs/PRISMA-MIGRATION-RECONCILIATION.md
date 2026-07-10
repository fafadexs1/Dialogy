# Reconciliação segura do histórico Prisma

O reconciliador existe para bancos cujo schema foi criado ou atualizado por SQL manual,
mas cujo `_prisma_migrations` não representa esse histórico. Ele **não executa o SQL das
migrations**. O modo padrão faz somente consultas aos catálogos PostgreSQL.

```bash
npm run db:migrations:audit
```

Um item só recebe `missing_verified` quando todos os pós-requisitos de catálogo inferidos
do seu `migration.sql` existem (ou estão ausentes, no caso de `DROP`) e a migration não
contém backfill/mutação de dados. Migrations sem pós-condição verificável, com objeto
ausente, com backfill, checksum divergente ou entrada Prisma falha ficam bloqueadas.

## Apply explícito

Depois de revisar o relatório e o backup do banco, selecione cada migration pelo nome:

```bash
npm run db:migrations:reconcile -- \
  --confirm=RECONCILE_VERIFIED_MIGRATIONS \
  --migration=20260210000001_add_workspace_queue_auto_close
```

Antes de inserir qualquer registro, o processo abre uma transação, toma um advisory lock
e repete a auditoria. Se qualquer migration já tiver sido registrada ou deixar de passar,
toda a transação é revertida. O ledger registra que o SQL não foi executado.

## Ordem operacional recomendada

1. Guardar backup e relatório de `db:migrations:audit`.
2. Resolver entradas falhas com o fluxo oficial `prisma migrate resolve`, apenas depois de
   comparar seus invariantes e logs. O reconciliador nunca resolve uma falha sozinho.
3. Reconciliar primeiro apenas `missing_verified`, em lotes pequenos e na ordem nominal.
4. Criar invariantes manuais e verificações de dados específicas para backfills bloqueados;
   não usar `migrate resolve --applied` como atalho.
5. Rodar novamente a auditoria e `prisma migrate status`.

## Cutover do Flowbuilder

A migration `20260710213000_native_flowbuilder_default` altera somente o default para
`native_v2`; linhas legadas não são convertidas automaticamente. A view
`autopilot_native_cutover_readiness` bloqueia a remoção definitiva da compatibilidade até
que, em todos os workspaces, `legacy_configs=0` e
`native_without_active_publication=0`.

## Incidente histórico de RLS de suporte

Em 2026-07-10, a entrada falha `20251210144500_fix_support_rls` foi resolvida com
`prisma migrate resolve --applied` após auditoria específica por
`scripts/repair-support-rls-migration.ts`. A falha original era `42710`: a policy
`Users can create tickets` já existia.

Não foi recriada a policy histórica separada `Superadmins can view all tickets`.
Ela havia sido substituída intencionalmente pela migration posterior
`20251210151000_fix_recursion`, que incorpora `check_is_superadmin()` nas policies
principais. A auditoria confirmou RLS ativo nas duas tabelas, função `SECURITY DEFINER`,
permissão de execução para `authenticated` e todas as regras efetivas de leitura e escrita.
