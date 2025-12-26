export type PlanType = 'starter' | 'pro' | 'business' | 'enterprise';

export interface PlanLimits {
    users: number;
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
}

// Client-safe constant for UI fallback/skeleton
export const PLANS: Record<PlanType, PlanDetails> = {
    // This is now just a type-safe skeleton or default.
    // Callers MUST fetch from DB. 
    // If strict sync usage exists, we might need a different strategy.
    starter: { id: 'starter', label: 'Starter', price: 97, limits: { users: 5, whatsapp: 1, history_months: 3, departments: false, campaigns: false, api: false, transcription: false, ai_byok: true } },
    pro: { id: 'pro', label: 'Pro', price: 297, limits: { users: 15, whatsapp: 2, history_months: 12, departments: true, campaigns: 'moderate', api: false, transcription: true, ai_byok: true } },
    business: { id: 'business', label: 'Business', price: 697, limits: { users: 35, whatsapp: 4, history_months: 36, departments: true, campaigns: 'high', api: true, transcription: true, ai_byok: true } },
    enterprise: { id: 'enterprise', label: 'Enterprise', price: 0, limits: { users: 9999, whatsapp: 9999, history_months: 60, departments: true, campaigns: 'high', api: true, transcription: true, ai_byok: true } }
};

export const ADDONS = {
    storage_gb: {
        label: 'Armazenamento Extra (GB)',
        price: 1.00
    },
    whatsapp_extra: {
        label: 'WhatsApp Adicional',
        price: 97.00
    },
    user_extra: {
        label: 'Usuário Adicional',
        price: 29.90
    }
};
