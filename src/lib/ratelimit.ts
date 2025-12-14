type Bucket = {
  count: number;
  expiresAt: number;
};

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(
  key: string,
  max: number,
  windowMs: number
): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.expiresAt < now) {
    const bucket = { count: 1, expiresAt: now + windowMs };
    buckets.set(key, bucket);
    return { ok: true, remaining: max - 1 };
  }

  if (existing.count >= max) {
    return { ok: false, retryAfter: existing.expiresAt - now };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return { ok: true, remaining: max - existing.count };
}
