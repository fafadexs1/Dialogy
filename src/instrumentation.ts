export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    const { validateSecurityRuntimeEnvironment } = await import('@/lib/security/runtime-env');
    validateSecurityRuntimeEnvironment();
  }
}
