const DEFAULT_PRESENCE_TTL_S = 120;

export function getPresenceTtlSeconds(): number {
  return DEFAULT_PRESENCE_TTL_S;
}

export function getPresenceTtlInterval(): string {
  return `${getPresenceTtlSeconds()} seconds`;
}
