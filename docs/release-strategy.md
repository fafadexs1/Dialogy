# Release Strategy (Canary / Blue-Green)

This repo supports release channels that can be used for canary or blue-green
deployments. The channel is exposed as `x-release-channel` for logs, tracing,
and feature flag targeting.

## How it works

- `APP_RELEASE_CHANNEL` sets the default channel for the deployment.
- `x-release-channel` request header overrides the default.
- `RELEASE_CHANNEL_COOKIE` (default: `dialogy_release_channel`) can override
  the channel per user for testing.

## Canary rollout

1. Deploy a canary environment with `APP_RELEASE_CHANNEL=canary`.
2. Shift a small percentage of traffic to it using your load balancer.
3. Gate features with `releaseChannels: ["canary"]` or with `rollout` percent.

## Blue-green

1. Deploy `blue` and `green` environments with `APP_RELEASE_CHANNEL=blue|green`.
2. Route traffic to the active color in your load balancer.
3. Use `releaseChannels` in feature flags to verify behavior on the inactive
   color before switching.

## Recommended env vars

```bash
APP_RELEASE_CHANNEL=stable
RELEASE_CHANNEL_COOKIE=dialogy_release_channel
```
