'use client';

import { useStore } from '@xyflow/react';

/** Subscribe only this small readout, rather than the entire editor, to zoom frames. */
export function WorkflowZoomLevel() {
  const zoom = useStore((state) => state.transform[2]);
  return <span className="wf-zoom" aria-label={`Zoom ${Math.round(zoom * 100)}%`}>{Math.round(zoom * 100)}%</span>;
}
