import type { AutopilotConfig } from '@/lib/types';

export function selectAutopilotConfigForRuntime(
  agents: AutopilotConfig[],
  requestedConfigId?: string | null
): AutopilotConfig | null {
  const requested = requestedConfigId?.trim();

  if (requested) {
    return agents.find((agent) => agent.id === requested) || null;
  }

  return (
    agents.find((agent) => agent.is_primary && !agent.is_private) ||
    agents.find((agent) => !agent.is_private) ||
    null
  );
}
