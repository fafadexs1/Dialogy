import 'server-only';

const REQUIRED_RUNTIME_SECRETS = [
  'PRIVATE_S3_ENDPOINT',
  'PRIVATE_S3_ACCESS_KEY_ID',
  'PRIVATE_S3_SECRET_ACCESS_KEY',
  'PRIVATE_S3_BUCKET',
  'QUEUE_WORKER_TOKEN',
  'MEDIA_PROXY_ALLOWED_HOSTS',
  'AUDIO_SOURCE_ALLOWED_HOSTS',
] as const;

export function validateSecurityRuntimeEnvironment(): void {
  const missing = REQUIRED_RUNTIME_SECRETS.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(`[startup] Missing required security configuration: ${missing.join(', ')}`);
  }
}
