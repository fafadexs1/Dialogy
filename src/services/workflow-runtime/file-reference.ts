import { z } from 'zod';

/** Opaque metadata only. Storage keys and signed URLs never enter the execution graph. */
export const WorkflowFileReferenceSchema = z.object({
  kind: z.literal('workflow_file'),
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(150).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  size: z.number().int().min(0).max(10_000_000),
});
export type WorkflowFileReference = z.infer<typeof WorkflowFileReferenceSchema>;
