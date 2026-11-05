# Meta WhatsApp routing runbook

The public Meta callback is:

`https://dialogy.klyraai.com.br/api/webhooks/meta/whatsapp`

Do not change the Meta callback until the shadow validation has 100% ownership resolution and zero divergence.

## Required Dialogy configuration

- `META_WHATSAPP_VERIFY_TOKEN` (`META_VERIFY_TOKEN` is accepted as a migration fallback)
- `META_APP_SECRETS` (recommended JSON key ring: `{ "<app_id>": "<app_secret>" }`)
- `META_APP_SECRET` and `META_APP_ID` remain a backwards-compatible single-app fallback
- `META_PAYLOAD_ENCRYPTION_KEY` (independent random value, at least 32 characters)
- `DIALOGY_INTERNAL_HMAC_CURRENT_KEY_ID`
- `DIALOGY_INTERNAL_HMAC_KEYS` (JSON key ring containing current and next keys)
- `EVOLUTION_WEBHOOK_REQUIRE_HMAC=true` after both Evolution clusters are signing callbacks
- `META_RELAY_CONCURRENCY` (optional, default `5`)
- `META_RELAY_TIMEOUT_MS` (optional, default `10000`)

The signature selects the owning app from `META_APP_SECRETS`; the app id is never trusted from the webhook body.
Every Meta app whose WABAs point at this callback must be present in the key ring. Do not put this key ring in a
`NEXT_PUBLIC_*` variable.

### Evolution instance identity

`evolution_api_instances.id` and the routing tables' `instance_id` are Dialogy IDs.
They are not Evolution's `Instance.id`. The relay resolves Evolution's UUID through
the cluster's authenticated `/instance/fetchInstances?instanceName=...` endpoint,
checks the name, integration, Phone Number ID and WABA ID, and sends that provider
UUID as `target.instanceId`. Do not rewrite Dialogy primary keys or disable
Evolution's ownership checks to make these IDs equal.

If deliveries are quarantined with HTTP 409 `instance_id_mismatch`, deploy the
corrected `worker-meta-relay` and validate a new inbound message through Meta
delivery, Evolution inbox, Dialogy message and workflow execution. A connected
instance or successful outbound event does not prove inbound delivery is healthy.
Do not bulk replay quarantined messages without reviewing their age and conversation
state: a replay can trigger delayed or duplicate automated replies.

Apply migrations only through the normal migration ledger:

```bash
npx prisma migrate deploy
```

Never drop or recreate the routing tables. Back up PostgreSQL before applying the reconciliation migration.

## Required configuration on each Evolution cluster

- `DIALOGY_META_ENABLED=true`
- `DIALOGY_CLUSTER_ID` (the exact Dialogy `whatsapp_clusters.id` for that host)
- `DIALOGY_META_RESULT_URL=https://dialogy.klyraai.com.br/api/internal/webhooks/meta/evolution-result`
- The same `DIALOGY_INTERNAL_HMAC_CURRENT_KEY_ID` and `DIALOGY_INTERNAL_HMAC_KEYS` key ring as Dialogy
- `DIALOGY_EVOLUTION_WEBHOOK_SIGNING_ENABLED=true`

Apply the provider-specific Evolution migration before enabling the feature, then deploy the same immutable image digest to both clusters.

## Cutover gates

1. No Cloud instance may have a null Phone Number ID or WABA ID.
2. No `waba-unknown` route may exist.
3. Every WABA must belong to exactly one cluster.
4. Dialogy relay, Evolution receipt worker and result callback must all be healthy.
   The relay sends a signed Dialogy delivery whose `payload` is an intact, atomic Meta envelope
   (`object -> entry[0] -> changes[0] -> value`). The Evolution endpoint rejects malformed envelopes with `422`
   before persisting them.
5. Run shadow validation for 24 hours before switching the Meta callback.
   Set `DIALOGY_META_SHADOW_URL` on both Evolution clusters to the public Dialogy callback during this period.
   Shadow rows remain quarantined with `errors.shadow=true` and are never relayed.
6. Keep the old public `/webhook/meta` endpoint until 48 hours after a stable cutover, then block it at the proxy.
