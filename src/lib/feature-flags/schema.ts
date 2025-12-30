import { z } from 'zod';

export const FeatureFlagDefinitionSchema = z
  .object({
    enabled: z.boolean().optional(),
    rollout: z.number().min(0).max(100).optional(),
    users: z.array(z.string()).optional(),
    workspaces: z.array(z.string()).optional(),
    releaseChannels: z.array(z.string()).optional(),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    description: z.string().optional(),
  })
  .passthrough();

export const FeatureFlagsConfigSchema = z
  .object({
    version: z.number().optional(),
    defaults: z
      .object({
        enabled: z.boolean().optional(),
        rollout: z.number().min(0).max(100).optional(),
        releaseChannels: z.array(z.string()).optional(),
      })
      .optional(),
    flags: z.record(FeatureFlagDefinitionSchema).default({}),
  })
  .passthrough();

export type FeatureFlagDefinition = z.infer<typeof FeatureFlagDefinitionSchema>;
export type FeatureFlagsConfig = z.infer<typeof FeatureFlagsConfigSchema>;
