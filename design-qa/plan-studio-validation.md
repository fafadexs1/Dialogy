# Plan Studio and workspace-exclusive plans — 2026-09-12

Implemented at `/superadmin/plans`: public/custom-plans tabs; the four existing database offers; separate editor with offer, channels, AI, team, CRM, automations and integrations categories; live offer preview; duplication and blank creation; public visibility; explicit workspace assignment for custom plans.

The `20260912220000_custom_workspace_plans` migration was applied to the configured database and recorded in `_prisma_migrations`. Existing four plans retain public scope. No customer assignment or subscription was changed during verification.

Custom scope is immutable after saving. A custom offer can be made available only with at least one valid workspace. The authenticated billing action resolves the active workspace and the checkout service queries the catalog for that workspace. Anonymous storefront queries omit all custom offers. Database RLS hides custom offers and their integration prices from anonymous and authenticated Data API roles; assignment rows are server-only.

Assignment makes an offer available for subscription; it does not change an existing contract. Removing an assignment prevents a new subscription but leaves existing contracts in force. Additional integration prices remain catalog configuration; they are not automatically added to ASAAS subscription charges. ASAAS provider credentials are still required before real checkout.

Verification:

- Real database tests call `savePlan` and `readBillingCatalog` inside outer transactions and roll back every fixture. They cover price/limits/integration/workspace persistence, preservation when editing, assignment replacement, inactive offers, invalid workspaces, immutable custom scope, anonymous/authenticated RLS and unauthorized writes.
- Billing regression suites also verify unavailable custom plans are rejected before provider calls.
- Authenticated browser at localhost:9002: public and custom tabs; template selection; custom editor omits public publication/default controls; workspace search/selection; changes preserved across categories; unsaved-discard prompt. Responsive editor inspected at 390 px with document width 390 and body width 382.

Re-run database verification explicitly:

```powershell
$env:DIALOGY_VERIFY_DB='1'
npx vitest run tests/custom-plans-db.spec.ts tests/asaas-billing.spec.ts tests/asaas-access.spec.ts tests/billing-access.spec.ts
```

Migration status: `npx tsx scripts/apply-custom-plans-migration.ts` (read only when already applied). The script applies only this migration with `--apply` and checks its checksum on subsequent runs.
