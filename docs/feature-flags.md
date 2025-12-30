# Feature Flags

Feature flags are stored in `system_settings` under the key `feature_flags` and
are evaluated server-side. Use them to control gradual rollouts, canary cohorts,
and per-user/workspace targeting without redeploying.

## JSON schema (summary)

```json
{
  "version": 1,
  "defaults": {
    "enabled": false,
    "releaseChannels": ["stable", "canary"]
  },
  "flags": {
    "new_inbox_ui": {
      "enabled": true,
      "rollout": 10,
      "users": ["user-id-1"],
      "workspaces": ["workspace-id-1"],
      "releaseChannels": ["canary"],
      "startAt": "2025-01-01T00:00:00Z",
      "endAt": "2025-02-01T00:00:00Z",
      "description": "New inbox UI rollout"
    }
  }
}
```

## Evaluation order

1. If the flag is not configured: **disabled**
2. If `startAt`/`endAt` are outside the window: **disabled**
3. If `releaseChannels` does not include the request channel: **disabled**
4. If `users` or `workspaces` match: **enabled**
5. If `enabled` is false: **disabled**
6. If `rollout` is defined: hash-based rollout by `workspaceId` (fallback to `userId`, then `requestId`)
7. Otherwise: **enabled**

## Server usage

```ts
import { isFeatureEnabled } from "@/lib/feature-flags";

const enabled = await isFeatureEnabled("new_inbox_ui", { workspaceId });
```

## Client usage

```txt
GET /api/feature-flags?flags=new_inbox_ui,ai_smart_reply&workspaceId=...
```

Response:

```json
{
  "flags": {
    "new_inbox_ui": true,
    "ai_smart_reply": false
  }
}
```

## Notes

- Use `releaseChannels` together with `APP_RELEASE_CHANNEL` (see `docs/release-strategy.md`).
- `rollout` should be used with `enabled: true`.
