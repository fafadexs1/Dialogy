'use client';

import { use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { WorkflowExecutionDebugger } from '@/components/workflow/workflow-execution-debugger';

export default function WorkflowExecutionPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = use(params);
  const router = useRouter();
  const onBack = useCallback(() => router.back(), [router]);

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden">
      <WorkflowExecutionDebugger executionId={executionId} onBack={onBack} />
    </div>
  );
}

