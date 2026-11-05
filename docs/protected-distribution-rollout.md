# Protected opportunity distribution

Apply `20261028141517_protected_opportunity_distribution` with the existing Prisma deployment migration process **before** deploying the app. This is additive and does not change production assignments or activate v2. New tables are server-only, with RLS and no browser policies. The application's existing privileged database connection performs writes; do not grant browser roles access.

## Activation

The default is `CHAT_DISTRIBUTION_MODE=legacy`. Corrected workload measurement, atomic transfer operations, stale-state checks, and no-op protection are active independently of the selection policy. Legacy score is maintained separately for rollback.

Use the same environment settings in the app and every worker:

```text
CHAT_DISTRIBUTION_MODE=shadow
CHAT_DISTRIBUTION_WORKSPACES=e3b476a1-5de8-4744-80b5-a5d23fe15fab
CHAT_DISTRIBUTION_ROLLOUT=100
```

1. Observe one full business day in shadow mode. Actual assignments use the previous selector; hypothetical opportunity balances are isolated in the `shadow` phase.
2. Set mode to `active` for Velpro for two full business days. Active balances start independently, without inheriting hypothetical receipts.
3. Remove the workspace allowlist and use rollout percentages 10, 50, 100, one full business day per step. Buckets are stable by workspace, never by operator or request.
4. To revert selection, set mode to `legacy` consistently in all services. Keep the schema, operation records, workload correction and audit history. Do not restore a database backup or move existing conversations.

Expansion is an operational decision, not a timer: hold the current step if volume is insufficient. Stop expansion for integrity violations, assignment failures or >10% growth in p90 human first-response time against matching weekday/hour periods. Require at least 30 completed response observations in both periods; show the count and unresponded assignments alongside p90 to avoid hiding unfinished work.

## Evidence

Team → Routing displays the current portfolio, corrected load, receipt counts, distinct conversations, eligible opportunities, exclusions and five-missed-opportunity alerts. Preview assumes a standard new conversation; actual selection also accounts for the incoming conversation and operator. Legacy event totals include historical reassignments, and are not new-customer totals. Repetitions avoided are reported over the preceding 24h.

`chat_assignment_events.decision_snapshot` records phase, version, candidates, exclusion reasons, projected occupancy and opportunity credits/balances. Content is not copied. `candidate_snapshot.legacyStatusCount` identifies workloads relying on old messages without a delivery status.

Run the read-only comparison:

```powershell
npx tsx scripts/replay-chat-distribution.ts --workspace-id e3b476a1-5de8-4744-80b5-a5d23fe15fab --days 7
```

Check response latency for the observation window against the same weekday/hour one week earlier:

```powershell
npx tsx scripts/check-distribution-rollout.ts --workspace-id e3b476a1-5de8-4744-80b5-a5d23fe15fab --since 2026-10-28T08:00:00-03:00 --until 2026-10-28T18:00:00-03:00
```

Use the actual completed observation dates. `stop` blocks expansion, `insufficient_volume` holds the stage, and `review` still requires reviewing errors and unresponded assignments; none of these outcomes activates a stage automatically.

Historical replay holds observed workloads fixed and cannot prove the counterfactual result. The simulation tests evolve receipt history; database tests evolve assignments, messages and load; real PostgreSQL tests cover contention. Real customer response times require the staged observation above.

## Contracts and fairness

Transfer callers send a stable `operationId` and observed `expectedAgentId`, `expectedTeamId`, `expectedSystemAgentId` (explicit null for no owner). Token API clients can use `Idempotency-Key`; retain the same body/key on transport retry. Server adapters restore original preconditions from the operation journal. New intentional transfers use new keys. Missing keys remain accepted for legacy integrations; those callers cannot safely retry an unknown result and should migrate to keys.

Receipts are atomic with every eligible candidate's credit. Only confirmed operations advance balances. New candidates start at zero, ineligible candidates earn no credit, reconnects preserve balances, and a new turn starts at 06:00 workspace-local time. Carry is bounded to [-1,+1]. Equal continuous opportunities with equal capacities differ by at most one receipt; fixed unequal capacities converge proportionally when all remain in the protected eligible set. This guarantee does not apply across exclusions, intentional direct transfers, differing portfolios or different teams.

The projected-occupancy band is initially 0.25. If all candidates exceed desired capacity, choose minimum projected occupancy; the portfolio maximum is always hard. Assignment mutations take a workspace advisory gate before team/user/chat locks to coordinate direct, self and automatic assignments. This deliberately serializes assignment transactions within a workspace; monitor transaction latency before increasing rollout.

## Verification

```powershell
npx vitest run tests/opportunity-distribution.spec.ts tests/fair-chat-distribution.spec.ts tests/fair-chat-distribution-database.spec.ts tests/transfer-operation-action.spec.ts tests/bulk-transfer.spec.ts tests/logout-transfer.spec.ts tests/chat-list-visibility.spec.ts
$env:CHAT_DISTRIBUTION_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:15432/postgres'
npx vitest run tests/fair-chat-distribution-concurrency.spec.ts
npx tsc --noEmit --pretty false --incremental false
```

Use only a disposable local PostgreSQL database for the contention suite; it creates and drops its own temporary schema. No test should use production credentials.
