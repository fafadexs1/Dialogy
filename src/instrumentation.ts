export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  const { registerNodeInstrumentation } = await import('./instrumentation.runtime');
  await registerNodeInstrumentation();
}
