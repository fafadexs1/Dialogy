type FeatureFlagContext = {
    now?: Date;
    releaseChannel?: string;
    userId?: string;
    workspaceId?: string;
};

type FeatureFlagConfig = {
    enabled?: boolean;
    startAt?: string;
    releaseChannels?: string[];
    users?: string[];
    rollout?: number;
};

type EvaluationResult = {
    enabled: boolean;
    reason: 'not_configured' | 'outside_window' | 'channel_blocked' | 'targeted' | 'disabled' | 'rollout' | 'enabled';
    bucket?: number;
};

function getRolloutBucket(identifier: string): number {
    let hash = 0;
    for (let i = 0; i < identifier.length; i++) {
        hash = ((hash << 5) - hash) + identifier.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 100;
}

export function evaluateFeatureFlag(
    flagName: string,
    config?: FeatureFlagConfig,
    defaults?: FeatureFlagConfig,
    context: FeatureFlagContext = {}
): EvaluationResult {
    const effectiveConfig = { ...defaults, ...config };

    if (config === undefined && defaults === undefined) {
        return { enabled: false, reason: 'not_configured' };
    }

    // 1. Check time window
    if (effectiveConfig.startAt) {
        const now = context.now || new Date();
        const startAt = new Date(effectiveConfig.startAt);
        if (now < startAt) {
            return { enabled: false, reason: 'outside_window' };
        }
    }

    // 2. Check release channel
    if (effectiveConfig.releaseChannels && effectiveConfig.releaseChannels.length > 0) {
        if (!context.releaseChannel || !effectiveConfig.releaseChannels.includes(context.releaseChannel)) {
            return { enabled: false, reason: 'channel_blocked' };
        }
    }

    // 3. Check targeted users (whitelist overrides disabled state)
    if (effectiveConfig.users && context.userId) {
        if (effectiveConfig.users.includes(context.userId)) {
            return { enabled: true, reason: 'targeted' };
        }
    }

    // 4. Check explicit disable (unless targeted)
    if (effectiveConfig.enabled === false) {
        return { enabled: false, reason: 'disabled' };
    }

    // 5. Check rollout
    if (typeof effectiveConfig.rollout === 'number') {
        // Determine identifier for consistent hashing (user > workspace > random)
        const identifier = context.userId || context.workspaceId || Math.random().toString();
        const bucket = getRolloutBucket(identifier);

        if (bucket >= effectiveConfig.rollout) {
            return { enabled: false, reason: 'rollout', bucket };
        }
    }

    return { enabled: true, reason: 'enabled' };
}
