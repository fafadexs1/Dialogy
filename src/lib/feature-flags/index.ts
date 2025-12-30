import 'server-only';

import { getSystemSettings } from '@/actions/system-settings';
import { getRequestContext } from '@/lib/observability/request-context';
import { getReleaseChannel } from '@/lib/release-channel';
import { evaluateFeatureFlag } from './evaluate';
import { FeatureFlagsConfigSchema, type FeatureFlagsConfig } from './schema';
import type { FeatureFlagContext, FeatureFlagDecision } from './evaluate';

export type { FeatureFlagContext, FeatureFlagDecision } from './evaluate';
export type { FeatureFlagDefinition, FeatureFlagsConfig } from './schema';

type FeatureFlagsCache = {
  config: FeatureFlagsConfig;
  expiresAt: number;
  raw: string | null;
};

const DEFAULT_CONFIG: FeatureFlagsConfig = {
  version: 1,
  flags: {},
};

const CACHE_TTL_MS = Number(process.env.FEATURE_FLAGS_CACHE_MS || '15000');

declare global {
  // eslint-disable-next-line no-var
  var __featureFlagsCache: FeatureFlagsCache | undefined;
}

const resolveCache = (): FeatureFlagsCache | undefined => globalThis.__featureFlagsCache;

const storeCache = (cache: FeatureFlagsCache) => {
  globalThis.__featureFlagsCache = cache;
};

const parseConfig = (raw: string | null | undefined): FeatureFlagsConfig => {
  if (!raw) {
    return DEFAULT_CONFIG;
  }

  try {
    const parsedJson = JSON.parse(raw);
    const parsed = FeatureFlagsConfigSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.error('[FEATURE_FLAGS] Invalid config', parsed.error.flatten());
      return DEFAULT_CONFIG;
    }
    return parsed.data;
  } catch (error) {
    console.error('[FEATURE_FLAGS] Failed to parse config', error);
    return DEFAULT_CONFIG;
  }
};

export async function getFeatureFlagsConfig(options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false;
  const now = Date.now();
  const cached = resolveCache();
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.config;
  }

  const settings = await getSystemSettings(['feature_flags']);
  const raw = settings.feature_flags ?? null;
  const config = parseConfig(raw);
  storeCache({
    config,
    raw,
    expiresAt: now + CACHE_TTL_MS,
  });

  return config;
}

const buildContext = async (
  overrides?: Partial<FeatureFlagContext>
): Promise<FeatureFlagContext> => {
  const requestContext = await getRequestContext();
  return {
    userId: overrides?.userId ?? requestContext.userId,
    workspaceId: overrides?.workspaceId ?? requestContext.workspaceId,
    requestId: overrides?.requestId ?? requestContext.requestId,
    releaseChannel: overrides?.releaseChannel ?? (await getReleaseChannel()),
    now: overrides?.now,
  };
};

export async function getFeatureFlagDecision(
  flagName: string,
  overrides?: Partial<FeatureFlagContext>
): Promise<FeatureFlagDecision> {
  const config = await getFeatureFlagsConfig();
  const context = await buildContext(overrides);
  return evaluateFeatureFlag(flagName, config.flags?.[flagName], config.defaults, context);
}

export async function isFeatureEnabled(
  flagName: string,
  overrides?: Partial<FeatureFlagContext>
): Promise<boolean> {
  const decision = await getFeatureFlagDecision(flagName, overrides);
  return decision.enabled;
}

export async function getFeatureFlags(
  flagNames: string[],
  overrides?: Partial<FeatureFlagContext>
): Promise<Record<string, boolean>> {
  const config = await getFeatureFlagsConfig();
  const context = await buildContext(overrides);
  return flagNames.reduce<Record<string, boolean>>((acc, flagName) => {
    const decision = evaluateFeatureFlag(flagName, config.flags?.[flagName], config.defaults, context);
    acc[flagName] = decision.enabled;
    return acc;
  }, {});
}
