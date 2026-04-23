import { db } from '@/lib/db';
import { getPlan, PlanType, PlanLimits, normalizePlanLimits } from '@/lib/plans';

/**
 * Billing statuses that BLOCK the workspace entirely.
 * The workspace cannot create new chats, connect channels, or use any paid features.
 * They can still LOG IN and VIEW existing data, but cannot operate.
 */
const BLOCKED_STATUSES = ['canceled', 'cancelled', 'unpaid', 'incomplete_expired'];

/**
 * Billing statuses that are in a grace period — the customer still has FULL access
 * to their current plan, but will be blocked if payment is not resolved.
 * Stripe typically retries 3 times over ~7 days before canceling.
 */
const GRACE_STATUSES = ['past_due', 'incomplete'];

/**
 * Frozen limits: used when a workspace is blocked due to non-payment.
 * The user can log in and see their data, but CANNOT:
 * - Create new chats (0 monthly chats)
 * - Connect new channels
 * - Send campaigns
 * - Use AI features
 */
const FROZEN_LIMITS: PlanLimits = {
    monthly_chats: 0,
    users: 9999,          // Can still log in and view
    whatsapp: 0,
    whatsapp_baileys: 0,
    whatsapp_cloud: 0,
    instagram: 0,
    messenger: 0,
    telegram: 0,
    departments: 0,
    auto_distribution: false,
    business_hours: false,
    custom_roles: false,
    custom_fields: 0,
    pipeline: false,
    lead_scoring: false,
    campaigns: false,
    campaign_limit: 0,
    transcription: false,
    autopilot_agents: 0,
    knowledge_docs: 0,
    ai_copilot: false,
    ai_byok: false,
    case_memory: false,
    nexusflow: false,
    api: false,
    developer_portal: false,
    webhook_dispatcher: false,
    analytics_full: false,
    analytics_export: false,
    history_months: 1,
    storage_gb: 0,
};

export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'inactive' | null;

export function isBillingBlocked(status: BillingStatus): boolean {
    return BLOCKED_STATUSES.includes(status || '');
}

export function isBillingGrace(status: BillingStatus): boolean {
    return GRACE_STATUSES.includes(status || '');
}

export async function getWorkspaceBillingStatus(workspaceId: string): Promise<BillingStatus> {
    const res = await db.query(
        `SELECT status FROM billing_info WHERE workspace_id = $1`,
        [workspaceId]
    );
    return (res.rows[0]?.status as BillingStatus) || null;
}

export async function getWorkspaceLimits(workspaceId: string): Promise<{ plan: PlanType, limits: PlanLimits, billingStatus: BillingStatus, blocked: boolean }> {
    try {
        const res = await db.query(
            `SELECT 
                COALESCE(b.plan, 'starter') as plan, 
                w.custom_limits,
                b.status as billing_status
             FROM workspaces w
             LEFT JOIN billing_info b ON b.workspace_id = w.id
             WHERE w.id = $1`,
            [workspaceId]
        );

        if (res.rowCount === 0) {
            throw new Error('Workspace not found');
        }

        const { plan, custom_limits, billing_status } = res.rows[0];
        const billingStatus = (billing_status as BillingStatus) || null;
        const planType = (plan as PlanType) || 'starter';

        // ── BLOCKED: subscription canceled/unpaid → freeze everything ──
        if (isBillingBlocked(billingStatus)) {
            console.warn(`[billing] Workspace ${workspaceId} BLOCKED (status="${billingStatus}"). All operations frozen.`);
            return {
                plan: planType,
                limits: { ...FROZEN_LIMITS },
                billingStatus,
                blocked: true,
            };
        }

        // ── GRACE: past_due → keep full access, Stripe is retrying ──
        // (no changes to limits, but the UI should show a warning banner)

        const planDetails = await getPlan(planType);
        const baseLimits = normalizePlanLimits(planDetails?.limits, planType);

        // Merge custom limits if they exist
        const limits: PlanLimits = normalizePlanLimits({
            ...baseLimits,
            ...(custom_limits || {})
        }, planType);

        return { plan: planType, limits, billingStatus, blocked: false };
    } catch (error) {
        console.error('[getWorkspaceLimits] Error:', error);
        return {
            plan: 'starter',
            limits: normalizePlanLimits(null, 'starter'),
            billingStatus: null,
            blocked: false,
        };
    }
}

export async function checkLimit(workspaceId: string, feature: keyof PlanLimits, currentCount: number = 0): Promise<{ allowed: boolean, limit: number, plan: PlanType, billingStatus: BillingStatus, blocked: boolean }> {
    const { plan, limits, billingStatus, blocked } = await getWorkspaceLimits(workspaceId);

    // If blocked, deny everything
    if (blocked) {
        return { allowed: false, limit: 0, plan, billingStatus, blocked };
    }

    const limit = limits[feature];

    if (typeof limit === 'boolean') {
        return { allowed: limit, limit: limit ? 1 : 0, plan, billingStatus, blocked };
    }

    if (typeof limit === 'string') {
        return { allowed: true, limit: 0, plan, billingStatus, blocked };
    }

    return { allowed: currentCount < (limit as number), limit: limit as number, plan, billingStatus, blocked };
}

export async function getMonthlyChatLimitStatus(workspaceId: string): Promise<{ allowed: boolean, limit: number, plan: PlanType, current: number, billingStatus: BillingStatus, blocked: boolean }> {
    const countRes = await db.query(
        `SELECT COUNT(*) as count
         FROM chats
         WHERE workspace_id = $1
           AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
        [workspaceId]
    );
    const current = parseInt(countRes.rows[0]?.count || '0', 10);
    const limitCheck = await checkLimit(workspaceId, 'monthly_chats', current);

    return {
        ...limitCheck,
        current,
    };
}

/**
 * Check if a workspace has an active, paying subscription.
 * Returns false for free/trial-expired/canceled workspaces.
 */
export async function isWorkspaceSubscriptionActive(workspaceId: string): Promise<boolean> {
    const status = await getWorkspaceBillingStatus(workspaceId);
    if (!status) return false;
    return ['active', 'trialing'].includes(status);
}
