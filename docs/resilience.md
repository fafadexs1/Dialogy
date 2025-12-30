# Resilience: timeouts, retries, circuit breaker

This project uses a shared HTTP wrapper to protect outbound calls against
timeouts and cascading failures.

## How it works
- `resilientFetch` applies:
  - request timeout
  - exponential backoff + jitter for idempotent requests (GET/HEAD/OPTIONS)
  - circuit breaker per host (fail fast when a dependency is unhealthy)
- Non-idempotent requests (POST/PUT) do **not** retry by default to avoid
  duplicate side effects.

## Defaults (can be tuned via env)
- `HTTP_TIMEOUT_MS=8000`
- `HTTP_RETRY_COUNT=2`
- `HTTP_RETRY_BASE_DELAY_MS=200`
- `HTTP_RETRY_MAX_DELAY_MS=2000`
- `HTTP_RETRY_FACTOR=2`
- `HTTP_RETRY_JITTER=0.2`
- `HTTP_BREAKER_FAILURE_THRESHOLD=5`
- `HTTP_BREAKER_SUCCESS_THRESHOLD=2`
- `HTTP_BREAKER_OPEN_MS=15000`

## Where it is used
- Evolution API client (`src/actions/evolution-api.ts`)
- Meta Graph API (Instagram/Messenger) (`src/services/meta/*`)
- MercadoLivre API (`src/services/mercadolivre/messaging-service.ts`)
- Instagram profile lookup (`src/services/meta/instagram-webhook-service.ts`)
- Remote media download (`src/services/whatsapp/upload-temp-media.ts`)
