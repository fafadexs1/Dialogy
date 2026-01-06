import 'server-only';

import { headers } from 'next/headers';

export type RequestContext = {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
};

export async function getRequestContext(): Promise<RequestContext> {
  try {
    const headerStore = await headers();
    return {
      requestId:
        headerStore.get('x-request-id') ||
        headerStore.get('x-correlation-id') ||
        undefined,
      userId: headerStore.get('x-user-id') || undefined,
      workspaceId: headerStore.get('x-workspace-id') || undefined,
    };
  } catch {
    return {};
  }
}
