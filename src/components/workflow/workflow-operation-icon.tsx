'use client';

import { useState } from 'react';
import { workflowNodeIcon } from './workflow-node-icons';
import { availableIntegrations } from '@/lib/integrations';

const SGP_ICON = availableIntegrations.find((integration) => integration.id === 'sgp')?.icon_url;

export function WorkflowOperationIcon({ type, size = 20 }: { type: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const Icon = workflowNodeIcon(type);
  if (type.startsWith('dialogy.sgp_') && SGP_ICON) {
    if (failed) return <span className="text-[10px] font-bold" aria-label="SGP">SGP</span>;
    // Reuse the same brand asset already used by the integration catalog.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={SGP_ICON} width={size + 4} height={size + 4} alt="SGP" className="object-contain" onError={() => setFailed(true)} />;
  }
  return <Icon size={size} aria-hidden="true" />;
}
