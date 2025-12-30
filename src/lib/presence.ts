const DEFAULT_PRESENCE_TTL_SECONDS = 120;
const MIN_PRESENCE_TTL_SECONDS = 30;
const MAX_PRESENCE_TTL_SECONDS = 3600;

export function getPresenceTtlSeconds(): number {
  const raw = process.env.PRESENCE_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PRESENCE_TTL_SECONDS;
  }
  const floored = Math.floor(parsed);
  return Math.min(Math.max(floored, MIN_PRESENCE_TTL_SECONDS), MAX_PRESENCE_TTL_SECONDS);
}

export function getPresenceTtlInterval(): string {
  return `${getPresenceTtlSeconds()} seconds`;
}
