export type PlanType = 'starter' | 'pro' | 'business' | 'enterprise';
export type SelfServePlanType = Exclude<PlanType, 'enterprise'>;

export const UNLIMITED_USERS = 999999;
export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_CHAT_ADDON_SIZE = 500;

// ---------------------------------------------------------------------------
// Tier-based pricing (inspired by SendPulse, monthly values in BRL)
// ---------------------------------------------------------------------------

/** Each volume tier has a fixed number of chats and a monthly price. */
export interface VolumeTier {
    chats: number;
    label: string;
    /** Monthly price in BRL */
    price: number;
}

/**
 * Fixed volume tiers with pre-defined monthly prices (BRL).
 * Based on SendPulse Profissional monthly rates.
 */
export const VOLUME_TIERS: VolumeTier[] = [
    { chats: 500,     label: '500',  price: 95.00   },
    { chats: 2_000,   label: '2K',   price: 170.00  },
    { chats: 5_000,   label: '5K',   price: 380.00  },
    { chats: 10_000,  label: '10K',  price: 600.00  },
    { chats: 15_000,  label: '15K',  price: 780.00  },
    { chats: 20_000,  label: '20K',  price: 950.00  },
    { chats: 30_000,  label: '30K',  price: 1_280.00 },
    { chats: 40_000,  label: '40K',  price: 1_740.00 },
    { chats: 50_000,  label: '50K',  price: 2_090.00 },
    { chats: 70_000,  label: '70K',  price: 2_490.00 },
    { chats: 100_000, label: '100K', price: 2_920.00 },
];

/** The labels shown in the tier selector UI */
export const TIER_LABELS = VOLUME_TIERS.map(t => t.label);

export const CHAT_VOLUME_MIN = VOLUME_TIERS[0].chats;
export const CHAT_VOLUME_MAX = VOLUME_TIERS[VOLUME_TIERS.length - 1].chats;
// Keep STEP for compatibility with any callers, but it's not used for the tier model
export const CHAT_VOLUME_STEP = 500;
export const VIP_CHAT_THRESHOLD = CHAT_VOLUME_MAX + CHAT_VOLUME_STEP;

/** Default tier index (first tier) */
export const DEFAULT_TIER_INDEX = 0;

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export interface PlanLimits {
    users: number;
    monthly_chats: number;
    whatsapp: number;
    history_months: number;
    departments: boolean;
    campaigns: boolean | 'moderate' | 'high';
    api: boolean;
    transcription: boolean;
    ai_byok: boolean;
}

export interface PlanDetails {
    id: PlanType;
    label: string;
    price: number;
    limits: PlanLimits;
    stripePriceId?: string;
    trialDays?: number;
}

export const PLANS: Record<PlanType, PlanDetails> = {
    starter: {
        id: 'starter',
        label: 'Dialogy',
        price: VOLUME_TIERS[0].price,
        trialDays: DEFAULT_TRIAL_DAYS,
        limits: { users: UNLIMITED_USERS, monthly_chats: CHAT_VOLUME_MIN, whatsapp: 5, history_months: 12, departments: true, campaigns: 'moderate', api: false, transcription: true, ai_byok: true }
    },
    pro: {
        id: 'pro',
        label: 'Dialogy',
        price: VOLUME_TIERS[0].price,
        trialDays: DEFAULT_TRIAL_DAYS,
        limits: { users: UNLIMITED_USERS, monthly_chats: CHAT_VOLUME_MIN, whatsapp: 5, history_months: 12, departments: true, campaigns: 'moderate', api: false, transcription: true, ai_byok: true }
    },
    business: {
        id: 'business',
        label: 'Dialogy',
        price: VOLUME_TIERS[0].price,
        trialDays: DEFAULT_TRIAL_DAYS,
        limits: { users: UNLIMITED_USERS, monthly_chats: CHAT_VOLUME_MIN, whatsapp: 5, history_months: 12, departments: true, campaigns: 'moderate', api: false, transcription: true, ai_byok: true }
    },
    enterprise: {
        id: 'enterprise',
        label: 'Grandes empresas',
        price: 0,
        limits: { users: UNLIMITED_USERS, monthly_chats: CHAT_VOLUME_MAX, whatsapp: 9999, history_months: 60, departments: true, campaigns: 'high', api: true, transcription: true, ai_byok: true }
    }
};

// ---------------------------------------------------------------------------
// Legacy aliases
// ---------------------------------------------------------------------------

const LEGACY_PLAN_ALIASES: Record<string, PlanType> = {
    starter: 'starter',
    standard: 'starter',
    essential: 'starter',
    essentials: 'starter',
    essencial: 'starter',
    basic: 'starter',
    basico: 'starter',
    padrao: 'starter',
    'padrão': 'starter',
    pro: 'pro',
    profissional: 'pro',
    professional: 'pro',
    growth: 'pro',
    advanced: 'pro',
    business: 'business',
    empresarial: 'business',
    operacao: 'business',
    'operação': 'business',
    scale: 'business',
    enterprise: 'enterprise',
    vip: 'enterprise',
    'grandes empresas': 'enterprise',
    'grandes-empresas': 'enterprise',
    custom: 'enterprise',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function normalizePlanKey(rawPlan?: string | null): PlanType | string {
    if (!rawPlan) {
        return 'starter';
    }

    const normalized = rawPlan.trim().toLowerCase();
    return LEGACY_PLAN_ALIASES[normalized] || rawPlan;
}

export function getPlanLabel(rawPlan?: string | null): string {
    const planKey = normalizePlanKey(rawPlan);
    if (typeof planKey === 'string' && planKey in PLANS) {
        return PLANS[planKey as PlanType].label;
    }

    return rawPlan || PLANS.starter.label;
}

export function isSelfServePlanType(planType: string): planType is SelfServePlanType {
    return planType === 'starter' || planType === 'pro' || planType === 'business';
}

/**
 * Find the nearest valid tier index for a given chat count.
 * Returns the index into VOLUME_TIERS.
 */
export function findNearestTierIndex(rawChats?: number | null): number {
    const chats = Number(rawChats);
    if (!Number.isFinite(chats) || chats <= VOLUME_TIERS[0].chats) return 0;
    if (chats >= VOLUME_TIERS[VOLUME_TIERS.length - 1].chats) return VOLUME_TIERS.length - 1;

    // Find closest tier
    let closestIdx = 0;
    let closestDiff = Math.abs(chats - VOLUME_TIERS[0].chats);
    for (let i = 1; i < VOLUME_TIERS.length; i++) {
        const diff = Math.abs(chats - VOLUME_TIERS[i].chats);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestIdx = i;
        }
    }
    return closestIdx;
}

/**
 * Clamp a raw chat value to the nearest valid tier value.
 * For enterprise, allows values above CHAT_VOLUME_MAX.
 */
export function clampMonthlyChats(rawValue?: number | null, planType: PlanType = 'starter'): number {
    if (planType === 'enterprise') {
        const parsedEnterpriseValue = Number(rawValue);
        return Number.isFinite(parsedEnterpriseValue) && parsedEnterpriseValue > CHAT_VOLUME_MAX
            ? Math.round(parsedEnterpriseValue)
            : CHAT_VOLUME_MAX;
    }

    const tierIndex = findNearestTierIndex(rawValue);
    return VOLUME_TIERS[tierIndex].chats;
}

/**
 * Get the monthly price for a given chat volume.
 * Uses the tier-based pricing table. planType is kept for backwards compatibility
 * but all plans share the same price.
 */
export function calculatePlanPrice(_planType: SelfServePlanType, rawMonthlyChats?: number | null): number {
    const tierIndex = findNearestTierIndex(rawMonthlyChats);
    return VOLUME_TIERS[tierIndex].price;
}

/** Shorthand that doesn't require a plan type. */
export function getTierPrice(rawMonthlyChats?: number | null): number {
    const tierIndex = findNearestTierIndex(rawMonthlyChats);
    return VOLUME_TIERS[tierIndex].price;
}

export function buildPlanLimits(planType: PlanType, rawMonthlyChats?: number | null): PlanLimits {
    const defaults = PLANS[planType]?.limits || PLANS.starter.limits;
    return normalizePlanLimits({
        ...defaults,
        monthly_chats: clampMonthlyChats(rawMonthlyChats, planType),
    }, planType);
}

export function normalizePlanLimits(rawLimits?: Partial<PlanLimits> | null, planType: PlanType = 'starter'): PlanLimits {
    const defaults = PLANS[planType]?.limits || PLANS.starter.limits;
    const normalizedMonthlyChats = typeof rawLimits?.monthly_chats === 'number'
        ? clampMonthlyChats(rawLimits.monthly_chats, planType)
        : defaults.monthly_chats;

    return {
        ...defaults,
        ...(rawLimits || {}),
        users: UNLIMITED_USERS,
        monthly_chats: normalizedMonthlyChats,
        whatsapp: typeof rawLimits?.whatsapp === 'number' ? rawLimits.whatsapp : defaults.whatsapp,
        history_months: typeof rawLimits?.history_months === 'number' ? rawLimits.history_months : defaults.history_months,
        departments: typeof rawLimits?.departments === 'boolean' ? rawLimits.departments : defaults.departments,
        campaigns: typeof rawLimits?.campaigns !== 'undefined' ? rawLimits.campaigns : defaults.campaigns,
        api: typeof rawLimits?.api === 'boolean' ? rawLimits.api : defaults.api,
        transcription: typeof rawLimits?.transcription === 'boolean' ? rawLimits.transcription : defaults.transcription,
        ai_byok: typeof rawLimits?.ai_byok === 'boolean' ? rawLimits.ai_byok : defaults.ai_byok,
    };
}

export const ADDONS = {
    storage_gb: {
        label: 'Armazenamento Extra (GB)',
        price: 1.00
    },
    whatsapp_extra: {
        label: 'Canal Extra',
        price: 39.00
    },
    chat_extra_500: {
        label: `Pacote extra de ${DEFAULT_CHAT_ADDON_SIZE} chats`,
        price: 99.00
    },
    ai_copilot_workspace: {
        label: 'IA Copilot por Workspace',
        price: 149.00
    }
};
