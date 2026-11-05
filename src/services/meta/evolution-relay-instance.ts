import 'server-only';

/** Resolve the provider UUID without confusing it with Dialogy's local instance UUID. */
export async function resolveEvolutionRelayInstanceId(input: {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  phoneNumberId: string;
  wabaId: string;
}): Promise<string> {
  if (!input.apiKey || !input.instanceName || !input.phoneNumberId || !input.wabaId) {
    throw new Error('missing_evolution_instance_identity');
  }

  const url = new URL(`${input.apiUrl.replace(/\/+$/, '')}/instance/fetchInstances`);
  url.searchParams.set('instanceName', input.instanceName);
  const response = await fetch(url, {
    headers: { apikey: input.apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(Number(process.env.META_RELAY_TIMEOUT_MS || 10_000)),
  });
  if (!response.ok) throw new Error(`evolution_instance_lookup_http_${response.status}`);

  const instances: unknown = await response.json();
  if (!Array.isArray(instances)) throw new Error('invalid_evolution_instance_lookup');
  const matches = instances.filter((value): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && value.name === input.instanceName
  ));
  if (matches.length !== 1) throw new Error('ambiguous_or_missing_evolution_instance');
  const instance = matches[0];
  if (
    instance.integration !== 'WHATSAPP-BUSINESS'
    || instance.number !== input.phoneNumberId
    || instance.businessId !== input.wabaId
  ) {
    throw new Error('evolution_instance_ownership_mismatch');
  }
  if (typeof instance.id !== 'string' || !instance.id.trim()) {
    throw new Error('missing_evolution_instance_id');
  }
  return instance.id;
}
