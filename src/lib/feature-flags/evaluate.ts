import { createHash } from 'crypto';
import type { FeatureFlagDefinition, FeatureFlagsConfig } from './schema';

export type FeatureFlagContext = {
  userId?: string;
  workspaceId?: string;
  requestId?: string;
  releaseChannel?: string;
  now?: Date;
};

export type FeatureFlagDecision = {
  enabled: boolean;
  reason:
    | 'not_configured'
    | 'outside_window'
    | 'channel_blocked'
    | 'targeted'
    | 'disabled'
    | 'missing_context'
    | 'rollout'
    | 'enabled';
  bucket?: number;
};

const normalizeRollout = (value: number | undefined): number | undefined => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
};

const hashToBucket = (seed: string): number => {
  const digest = createHash('sha256').update(seed).digest('hex');
  const head = digest.slice(0, 8);
  const asInt = parseInt(head, 16);
  return Math.abs(asInt) % 100;
};

const resolveStableId = (context: FeatureFlagContext): string | undefined => {
  return context.workspaceId || context.userId || context.requestId;
};

const isInList = (list: string[] | undefined, value: string | undefined) => {
  if (!list || !value) return false;
  return list.includes(value);
};

const isWithinWindow = (definition: FeatureFlagDefinition, now: Date) => {
  if (definition.startAt) {
    const start = new Date(definition.startAt);
    if (!Number.isNaN(start.getTime()) && now < start) {
      return false;
    }
  }
  if (definition.endAt) {
    const end = new Date(definition.endAt);
    if (!Number.isNaN(end.getTime()) && now > end) {
      return false;
    }
  }
  return true;
};

export function evaluateFeatureFlag(
  flagName: string,
  definition: FeatureFlagDefinition | undefined,
  defaults: FeatureFlagsConfig['defaults'] | undefined,
  context: FeatureFlagContext
): FeatureFlagDecision {
  if (!definition) {
    return { enabled: false, reason: 'not_configured' };
  }

  const now = context.now ?? new Date();

  if (!isWithinWindow(definition, now)) {
    return { enabled: false, reason: 'outside_window' };
  }

  const releaseChannels = definition.releaseChannels ?? defaults?.releaseChannels;
  if (releaseChannels && releaseChannels.length > 0) {
    const channel = context.releaseChannel || 'stable';
    if (!releaseChannels.includes(channel)) {
      return { enabled: false, reason: 'channel_blocked' };
    }
  }

  if (isInList(definition.users, context.userId) || isInList(definition.workspaces, context.workspaceId)) {
    return { enabled: true, reason: 'targeted' };
  }

  const enabled = definition.enabled ?? defaults?.enabled ?? false;
  if (!enabled) {
    return { enabled: false, reason: 'disabled' };
  }

  const rollout = normalizeRollout(definition.rollout ?? defaults?.rollout);
  if (rollout === undefined || rollout >= 100) {
    return { enabled: true, reason: 'enabled' };
  }

  const stableId = resolveStableId(context);
  if (!stableId) {
    return { enabled: false, reason: 'missing_context' };
  }

  const bucket = hashToBucket(`${flagName}:${stableId}`);
  const inRollout = bucket < rollout;
  return { enabled: inRollout, reason: 'rollout', bucket };
}
