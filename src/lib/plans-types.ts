export type PlanType = 'starter' | 'pro' | 'business' | 'enterprise';
export type SelfServePlanType = Exclude<PlanType, 'enterprise'>;

export const UNLIMITED = 999999;
export const UNLIMITED_USERS = UNLIMITED;
export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_CHAT_ADDON_SIZE = 500;

// ---------------------------------------------------------------------------
// Plan limits — differentiated by tier
// ---------------------------------------------------------------------------

export interface PlanLimits {
    // Core
    users: number;
    monthly_chats: number;

    // Channels
    whatsapp_baileys: number;
    whatsapp_cloud: number;
    instagram: number;
    messenger: number;
    telegram: number;

    // Inbox
    history_months: number;
    shortcuts: number;
    team_shortcuts: boolean;
    interactive_lists: boolean;
    chat_export: boolean;

    // Teams
    teams: number;
    auto_distribution: boolean;
    team_transfer: boolean;
    business_hours: boolean;

    // RBAC
    custom_roles: boolean;
    granular_permissions: boolean;

    // Tags
    close_reason_tags: boolean;
    team_tags: boolean;
    tag_categories: boolean;

    // AI
    transcription: boolean;
    autopilot_agents: number;
    knowledge_docs: number;
    ai_copilot: boolean;
    ai_byok: boolean;
    ai_model_selection: boolean;
    case_memory: boolean;
    private_agents: boolean;

    // CRM
    custom_fields: number;
    pipeline: boolean;
    lead_scoring: boolean;
    nlp_segments: boolean;
    conversion_tracking: boolean;

    // Campaigns
    campaigns_per_month: number;
    parallel_dispatch: boolean;
    api_dispatch: boolean;

    // Automations
    system_agents: number;
    nexusflow: boolean;
    crm_automations: boolean;
    webhook_dispatcher: boolean;

    // Analytics
    agent_performance: boolean;
    first_response_time: boolean;
    fcr_rate: boolean;
    conversion_metrics: boolean;
    crm_dashboard: boolean;
    data_export: boolean;

    // Developer
    developer_portal: boolean;
    public_api: boolean;

    // Legacy compat
    departments: boolean;
    campaigns: boolean | 'moderate' | 'high';
    api: boolean;
    /** @deprecated Use whatsapp_baileys + whatsapp_cloud */
    whatsapp: number;
}

// ---------------------------------------------------------------------------
// Plan details
// ---------------------------------------------------------------------------

export interface PlanDetails {
    id: PlanType;
    label: string;
    description: string;
    price: number;
    limits: PlanLimits;
    stripePriceId?: string;
    trialDays?: number;
    badge?: string;
    highlighted?: boolean;
}

// ---------------------------------------------------------------------------
// Plan definitions — R$249 / R$499 / R$999 / Enterprise
// ---------------------------------------------------------------------------

const ESSENCIAL_LIMITS: PlanLimits = {
    users: UNLIMITED,
    monthly_chats: 1_000,

    // Channels
    whatsapp_baileys: 2,
    whatsapp_cloud: 0,
    instagram: 0,
    messenger: 0,
    telegram: 1,

    // Inbox
    history_months: 6,
    shortcuts: 20,
    team_shortcuts: false,
    interactive_lists: false,
    chat_export: false,

    // Teams
    teams: 2,
    auto_distribution: false,
    team_transfer: false,
    business_hours: false,

    // RBAC
    custom_roles: false,
    granular_permissions: false,

    // Tags
    close_reason_tags: false,
    team_tags: false,
    tag_categories: false,

    // AI
    transcription: false,
    autopilot_agents: 0,
    knowledge_docs: 0,
    ai_copilot: false,
    ai_byok: false,
    ai_model_selection: false,
    case_memory: false,
    private_agents: false,

    // CRM
    custom_fields: 3,
    pipeline: false,
    lead_scoring: false,
    nlp_segments: false,
    conversion_tracking: false,

    // Campaigns
    campaigns_per_month: 0,
    parallel_dispatch: false,
    api_dispatch: false,

    // Automations
    system_agents: 0,
    nexusflow: false,
    crm_automations: false,
    webhook_dispatcher: false,

    // Analytics
    agent_performance: false,
    first_response_time: false,
    fcr_rate: false,
    conversion_metrics: false,
    crm_dashboard: false,
    data_export: false,

    // Developer
    developer_portal: false,
    public_api: false,

    // Legacy
    departments: true,
    campaigns: false,
    api: false,
    whatsapp: 3,
};

const PROFISSIONAL_LIMITS: PlanLimits = {
    users: UNLIMITED,
    monthly_chats: 5_000,

    // Channels
    whatsapp_baileys: 5,
    whatsapp_cloud: 2,
    instagram: 1,
    messenger: 1,
    telegram: 3,

    // Inbox
    history_months: 12,
    shortcuts: UNLIMITED,
    team_shortcuts: true,
    interactive_lists: true,
    chat_export: true,

    // Teams
    teams: 10,
    auto_distribution: true,
    team_transfer: true,
    business_hours: true,

    // RBAC
    custom_roles: true,
    granular_permissions: true,

    // Tags
    close_reason_tags: true,
    team_tags: false,
    tag_categories: true,

    // AI
    transcription: true,
    autopilot_agents: 1,
    knowledge_docs: 5,
    ai_copilot: false,
    ai_byok: true,
    ai_model_selection: false,
    case_memory: false,
    private_agents: false,

    // CRM
    custom_fields: UNLIMITED,
    pipeline: true,
    lead_scoring: false,
    nlp_segments: false,
    conversion_tracking: true,

    // Campaigns
    campaigns_per_month: 2,
    parallel_dispatch: false,
    api_dispatch: false,

    // Automations
    system_agents: 3,
    nexusflow: false,
    crm_automations: false,
    webhook_dispatcher: false,

    // Analytics
    agent_performance: true,
    first_response_time: true,
    fcr_rate: true,
    conversion_metrics: false,
    crm_dashboard: false,
    data_export: false,

    // Developer
    developer_portal: false,
    public_api: false,

    // Legacy
    departments: true,
    campaigns: 'moderate',
    api: false,
    whatsapp: 12,
};

const OPERACAO_LIMITS: PlanLimits = {
    users: UNLIMITED,
    monthly_chats: 15_000,

    // Channels
    whatsapp_baileys: 10,
    whatsapp_cloud: 5,
    instagram: 3,
    messenger: 3,
    telegram: 5,

    // Inbox
    history_months: 24,
    shortcuts: UNLIMITED,
    team_shortcuts: true,
    interactive_lists: true,
    chat_export: true,

    // Teams
    teams: UNLIMITED,
    auto_distribution: true,
    team_transfer: true,
    business_hours: true,

    // RBAC
    custom_roles: true,
    granular_permissions: true,

    // Tags
    close_reason_tags: true,
    team_tags: true,
    tag_categories: true,

    // AI
    transcription: true,
    autopilot_agents: 5,
    knowledge_docs: 50,
    ai_copilot: true,
    ai_byok: true,
    ai_model_selection: false,
    case_memory: true,
    private_agents: true,

    // CRM
    custom_fields: UNLIMITED,
    pipeline: true,
    lead_scoring: true,
    nlp_segments: true,
    conversion_tracking: true,

    // Campaigns
    campaigns_per_month: UNLIMITED,
    parallel_dispatch: true,
    api_dispatch: true,

    // Automations
    system_agents: UNLIMITED,
    nexusflow: true,
    crm_automations: true,
    webhook_dispatcher: true,

    // Analytics
    agent_performance: true,
    first_response_time: true,
    fcr_rate: true,
    conversion_metrics: true,
    crm_dashboard: true,
    data_export: true,

    // Developer
    developer_portal: true,
    public_api: true,

    // Legacy
    departments: true,
    campaigns: 'high',
    api: true,
    whatsapp: 26,
};

const ENTERPRISE_LIMITS: PlanLimits = {
    users: UNLIMITED,
    monthly_chats: 100_000,

    // Channels
    whatsapp_baileys: UNLIMITED,
    whatsapp_cloud: UNLIMITED,
    instagram: UNLIMITED,
    messenger: UNLIMITED,
    telegram: UNLIMITED,

    // Inbox
    history_months: 60,
    shortcuts: UNLIMITED,
    team_shortcuts: true,
    interactive_lists: true,
    chat_export: true,

    // Teams
    teams: UNLIMITED,
    auto_distribution: true,
    team_transfer: true,
    business_hours: true,

    // RBAC
    custom_roles: true,
    granular_permissions: true,

    // Tags
    close_reason_tags: true,
    team_tags: true,
    tag_categories: true,

    // AI
    transcription: true,
    autopilot_agents: UNLIMITED,
    knowledge_docs: UNLIMITED,
    ai_copilot: true,
    ai_byok: true,
    ai_model_selection: false,
    case_memory: true,
    private_agents: true,

    // CRM
    custom_fields: UNLIMITED,
    pipeline: true,
    lead_scoring: true,
    nlp_segments: true,
    conversion_tracking: true,

    // Campaigns
    campaigns_per_month: UNLIMITED,
    parallel_dispatch: true,
    api_dispatch: true,

    // Automations
    system_agents: UNLIMITED,
    nexusflow: true,
    crm_automations: true,
    webhook_dispatcher: true,

    // Analytics
    agent_performance: true,
    first_response_time: true,
    fcr_rate: true,
    conversion_metrics: true,
    crm_dashboard: true,
    data_export: true,

    // Developer
    developer_portal: true,
    public_api: true,

    // Legacy
    departments: true,
    campaigns: 'high',
    api: true,
    whatsapp: UNLIMITED,
};

export const PLANS: Record<PlanType, PlanDetails> = {
    starter: {
        id: 'starter',
        label: 'Essencial',
        description: 'Ideal para pequenas empresas que estão começando a organizar seu atendimento.',
        price: 249,
        stripePriceId: 'price_1TPAo6Chm5ywuupPPqWfvKzb',
        trialDays: DEFAULT_TRIAL_DAYS,
        limits: ESSENCIAL_LIMITS,
    },
    pro: {
        id: 'pro',
        label: 'Profissional',
        description: 'Para equipes em crescimento que precisam de IA, CRM e canais premium.',
        price: 499,
        stripePriceId: 'price_1TPAo7Chm5ywuupPEMyFpktS',
        trialDays: DEFAULT_TRIAL_DAYS,
        badge: 'Mais popular',
        highlighted: true,
        limits: PROFISSIONAL_LIMITS,
    },
    business: {
        id: 'business',
        label: 'Operação',
        description: 'Para operações de escala com API, automações avançadas e analytics completo.',
        price: 999,
        stripePriceId: 'price_1TPAo7Chm5ywuupPrZSNUfWk',
        trialDays: DEFAULT_TRIAL_DAYS,
        limits: OPERACAO_LIMITS,
    },
    enterprise: {
        id: 'enterprise',
        label: 'Enterprise',
        description: 'Arquitetura dedicada, onboarding completo e suporte 24x7.',
        price: 0,
        limits: ENTERPRISE_LIMITS,
    },
};

// ---------------------------------------------------------------------------
// Legacy volume tiers (kept for backwards compatibility with existing subs)
// ---------------------------------------------------------------------------

/** Each volume tier has a fixed number of chats and a monthly price. */
export interface VolumeTier {
    chats: number;
    label: string;
    /** Monthly price in BRL */
    price: number;
}

/**
 * Fixed volume tiers — legacy, kept for backwards compat.
 * New subscriptions use plan-based fixed pricing.
 */
export const VOLUME_TIERS: VolumeTier[] = [
    { chats: 500,     label: '500',  price: 95.00   },
    { chats: 1_000,   label: '1K',   price: 249.00  },
    { chats: 2_000,   label: '2K',   price: 170.00  },
    { chats: 5_000,   label: '5K',   price: 499.00  },
    { chats: 10_000,  label: '10K',  price: 600.00  },
    { chats: 15_000,  label: '15K',  price: 999.00  },
    { chats: 20_000,  label: '20K',  price: 950.00  },
    { chats: 30_000,  label: '30K',  price: 1_280.00 },
    { chats: 40_000,  label: '40K',  price: 1_740.00 },
    { chats: 50_000,  label: '50K',  price: 2_090.00 },
    { chats: 70_000,  label: '70K',  price: 2_490.00 },
    { chats: 100_000, label: '100K', price: 2_920.00 },
];

/** The labels shown in the tier selector UI */
export const TIER_LABELS = VOLUME_TIERS.map(t => t.label);

export const CHAT_VOLUME_MIN = 500;
export const CHAT_VOLUME_MAX = VOLUME_TIERS[VOLUME_TIERS.length - 1].chats;
// Keep STEP for compatibility with any callers, but it's not used for the tier model
export const CHAT_VOLUME_STEP = 500;
export const VIP_CHAT_THRESHOLD = CHAT_VOLUME_MAX + CHAT_VOLUME_STEP;

/** Default tier index (first tier) */
export const DEFAULT_TIER_INDEX = 0;

// ---------------------------------------------------------------------------
// Plan features for pricing UI
// ---------------------------------------------------------------------------

export interface PlanFeatureGroup {
    category: string;
    features: {
        label: string;
        starter: string | boolean;
        pro: string | boolean;
        business: string | boolean;
        enterprise: string | boolean;
    }[];
}

export const PLAN_FEATURE_HIGHLIGHTS: Record<SelfServePlanType, string[]> = {
    starter: [
        'Usuários ilimitados',
        '1.000 chats/mês',
        '2 WhatsApp (QR Code)',
        '1 Telegram',
        'Inbox unificado',
        '2 departamentos',
        '20 atalhos rápidos',
        'Histórico de 6 meses',
        '7 dias grátis',
    ],
    pro: [
        'Tudo do Essencial, mais:',
        '5.000 chats/mês',
        '7 WhatsApp (QR + API Oficial)',
        'Instagram Direct + Messenger',
        'IA: Autopilot + Transcrição',
        'CRM com Pipeline Kanban',
        '2 campanhas/mês',
        'RBAC com permissões granulares',
        'Histórico de 12 meses',
    ],
    business: [
        'Tudo do Profissional, mais:',
        '15.000 chats/mês',
        '18 WhatsApp (QR + API)',
        'IA Copilot + Case Memory',
        'Campanhas ilimitadas',
        'NexusFlow (low-code)',
        'API pública + Developer Portal',
        'Analytics completo + Exportação',
        'Histórico de 24 meses',
    ],
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
 * Get the fixed monthly price for a plan.
 * New model: each plan has a fixed price regardless of chat volume.
 */
export function getPlanPrice(planType: SelfServePlanType): number {
    return PLANS[planType]?.price || PLANS.starter.price;
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

    // In the new model, each plan has a fixed chat volume
    return PLANS[planType]?.limits.monthly_chats || PLANS.starter.limits.monthly_chats;
}

/**
 * @deprecated Use getPlanPrice(planType) instead.
 * Kept for backwards compatibility.
 */
export function calculatePlanPrice(planType: SelfServePlanType, _rawMonthlyChats?: number | null): number {
    return getPlanPrice(planType);
}

/** @deprecated Use getPlanPrice() instead */
export function getTierPrice(rawMonthlyChats?: number | null): number {
    const tierIndex = findNearestTierIndex(rawMonthlyChats);
    return VOLUME_TIERS[tierIndex].price;
}

export function buildPlanLimits(planType: PlanType, _rawMonthlyChats?: number | null): PlanLimits {
    return { ...(PLANS[planType]?.limits || PLANS.starter.limits) };
}

export function normalizePlanLimits(rawLimits?: Partial<PlanLimits> | null, planType: PlanType = 'starter'): PlanLimits {
    const defaults = PLANS[planType]?.limits || PLANS.starter.limits;
    return {
        ...defaults,
        ...(rawLimits || {}),
        users: UNLIMITED,
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
