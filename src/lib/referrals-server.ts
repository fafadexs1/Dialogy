import "server-only";

import { randomBytes } from "crypto";
import { cookies, headers } from "next/headers";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import {
  buildReferralCodeSeed,
  buildReferralLink,
  normalizeReferralCode,
  type ReferralDashboardData,
  REFERRAL_BONUS_PERCENT,
  REFERRAL_COOKIE_NAME,
} from "@/lib/referrals";

export type ReferralContext = {
  referredByUserId: string | null;
  referrerCode: string | null;
};

function randomReferralSuffix(size = 4) {
  return randomBytes(size).toString("hex").toUpperCase().slice(0, size * 2);
}

async function getRequestOrigin() {
  const requestHeaders = await headers();
  return (
    requestHeaders.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

export async function findReferrerByCode(code?: string | null) {
  const normalizedCode = normalizeReferralCode(code);

  if (!normalizedCode) {
    return null;
  }

  const result = await db.query(
    `
      SELECT id, referral_code, full_name
      FROM users
      WHERE referral_code = $1
      LIMIT 1
    `,
    [normalizedCode]
  );

  return result.rows[0] || null;
}

export async function ensureReferralCodeForUser(userId: string, fullName?: string | null) {
  const existingResult = await db.query(
    `
      SELECT referral_code, full_name
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (existingResult.rowCount === 0) {
    return null;
  }

  const existingCode = existingResult.rows[0]?.referral_code as string | null;
  if (existingCode) {
    return existingCode;
  }

  const baseSeed = buildReferralCodeSeed(fullName || existingResult.rows[0]?.full_name);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${baseSeed}-${randomReferralSuffix(2 + Math.min(attempt, 2))}`;

    try {
      const updateResult = await db.query(
        `
          UPDATE users
          SET referral_code = $1, updated_at = NOW()
          WHERE id = $2 AND referral_code IS NULL
          RETURNING referral_code
        `,
        [candidate, userId]
      );

      if (updateResult.rowCount && updateResult.rows[0]?.referral_code) {
        return updateResult.rows[0].referral_code as string;
      }

      const refreshedResult = await db.query(
        "SELECT referral_code FROM users WHERE id = $1 LIMIT 1",
        [userId]
      );

      if (refreshedResult.rows[0]?.referral_code) {
        return refreshedResult.rows[0].referral_code as string;
      }
    } catch (error: any) {
      if (error?.code !== "23505") {
        throw error;
      }
    }
  }

  throw new Error("Nao foi possivel gerar um codigo de indicacao unico.");
}

export async function getReferralContextForUser(userId: string): Promise<ReferralContext> {
  const result = await db.query(
    `
      SELECT
        u.referred_by_user_id,
        ref.referral_code AS referrer_code
      FROM users u
      LEFT JOIN users ref ON ref.id = u.referred_by_user_id
      WHERE u.id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    return {
      referredByUserId: null,
      referrerCode: null,
    };
  }

  return {
    referredByUserId: result.rows[0]?.referred_by_user_id || null,
    referrerCode: result.rows[0]?.referrer_code || null,
  };
}

export async function applyReferralToUser(userId: string, explicitCode?: string | null) {
  const cookieStore = await cookies();
  const normalizedCode =
    normalizeReferralCode(explicitCode) ||
    normalizeReferralCode(cookieStore.get(REFERRAL_COOKIE_NAME)?.value);

  if (!normalizedCode) {
    return { applied: false, referrerUserId: null as string | null };
  }

  const currentUserResult = await db.query(
    `
      SELECT referred_by_user_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (currentUserResult.rows[0]?.referred_by_user_id) {
    cookieStore.delete(REFERRAL_COOKIE_NAME);
    return {
      applied: false,
      referrerUserId: currentUserResult.rows[0].referred_by_user_id as string,
    };
  }

  const referrer = await findReferrerByCode(normalizedCode);
  if (!referrer || referrer.id === userId) {
    cookieStore.delete(REFERRAL_COOKIE_NAME);
    return { applied: false, referrerUserId: null as string | null };
  }

  const updateResult = await db.query(
    `
      UPDATE users
      SET referred_by_user_id = $1, updated_at = NOW()
      WHERE id = $2
        AND referred_by_user_id IS NULL
        AND id <> $1
      RETURNING referred_by_user_id
    `,
    [referrer.id, userId]
  );

  cookieStore.delete(REFERRAL_COOKIE_NAME);

  return {
    applied: (updateResult.rowCount ?? 0) > 0,
    referrerUserId:
      (updateResult.rows[0]?.referred_by_user_id as string | null) || referrer.id,
  };
}

export async function getReferralDashboardForCurrentUser(): Promise<ReferralDashboardData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const userResult = await db.query(
    `
      SELECT id, full_name
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [user.id]
  );

  if (userResult.rowCount === 0) {
    return null;
  }

  const fullName = userResult.rows[0]?.full_name as string | null;
  const referralCode = await ensureReferralCodeForUser(user.id, fullName);

  if (!referralCode) {
    return null;
  }

  const origin = await getRequestOrigin();

  const [totalResult, workspaceResult, activeResult, sumsResult, referralsResult, bonusesResult] = await Promise.all([
    db.query(
      `
        SELECT COUNT(*)::int AS count
        FROM users
        WHERE referred_by_user_id = $1
      `,
      [user.id]
    ),
    db.query(
      `
        SELECT COUNT(DISTINCT referred.id)::int AS count
        FROM users referred
        JOIN workspaces w ON w.owner_id = referred.id
        WHERE referred.referred_by_user_id = $1
      `,
      [user.id]
    ),
    db.query(
      `
        SELECT COUNT(DISTINCT referred.id)::int AS count
        FROM users referred
        JOIN workspaces w ON w.owner_id = referred.id
        JOIN billing_info b ON b.workspace_id = w.id
        WHERE referred.referred_by_user_id = $1
          AND b.status = 'active'
      `,
      [user.id]
    ),
    db.query(
      `
        SELECT
          COALESCE(SUM(invoice_amount_cents), 0)::int AS total_sales_cents,
          COALESCE(SUM(bonus_amount_cents), 0)::int AS total_bonus_cents
        FROM referral_bonus_ledger
        WHERE referrer_user_id = $1
      `,
      [user.id]
    ),
    db.query(
      `
        SELECT
          referred.id,
          referred.full_name,
          referred.email,
          workspace_info.workspace_name,
          COALESCE(ledger_stats.total_bonus_cents, 0)::int AS total_bonus_cents,
          ledger_stats.last_bonus_at,
          COALESCE(workspace_info.has_workspace, FALSE) AS has_workspace,
          COALESCE(workspace_info.has_active_subscription, FALSE) AS has_active_subscription
        FROM users referred
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              MAX(w.name) FILTER (WHERE b.status = 'active'),
              MAX(w.name)
            ) AS workspace_name,
            COUNT(w.id) > 0 AS has_workspace,
            BOOL_OR(b.status = 'active') AS has_active_subscription
          FROM workspaces w
          LEFT JOIN billing_info b ON b.workspace_id = w.id
          WHERE w.owner_id = referred.id
        ) workspace_info ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(ledger.bonus_amount_cents), 0)::int AS total_bonus_cents,
            MAX(ledger.invoice_paid_at) AS last_bonus_at
          FROM referral_bonus_ledger ledger
          WHERE ledger.referrer_user_id = $1
            AND ledger.referred_user_id = referred.id
        ) ledger_stats ON TRUE
        WHERE referred.referred_by_user_id = $1
        ORDER BY
          ledger_stats.last_bonus_at DESC NULLS LAST,
          referred.full_name ASC
        LIMIT 12
      `,
      [user.id]
    ),
    db.query(
      `
        SELECT
          ledger.id,
          referred.full_name AS referred_name,
          w.name AS workspace_name,
          ledger.invoice_amount_cents,
          ledger.bonus_amount_cents,
          ledger.currency,
          ledger.billing_reason,
          ledger.invoice_paid_at
        FROM referral_bonus_ledger ledger
        JOIN users referred ON referred.id = ledger.referred_user_id
        LEFT JOIN workspaces w ON w.id = ledger.workspace_id
        WHERE ledger.referrer_user_id = $1
        ORDER BY ledger.invoice_paid_at DESC, ledger.created_at DESC
        LIMIT 20
      `,
      [user.id]
    ),
  ]);

  return {
    referralCode,
    referralLink: buildReferralLink(origin, referralCode),
    bonusPercent: REFERRAL_BONUS_PERCENT,
    totals: {
      totalSignups: totalResult.rows[0]?.count ?? 0,
      workspaceCreated: workspaceResult.rows[0]?.count ?? 0,
      validReferrals: activeResult.rows[0]?.count ?? 0,
      totalSalesCents: sumsResult.rows[0]?.total_sales_cents ?? 0,
      totalBonusCents: sumsResult.rows[0]?.total_bonus_cents ?? 0,
    },
    referrals: referralsResult.rows.map((row) => ({
      id: row.id as string,
      name: row.full_name as string,
      email: (row.email as string | null) || null,
      workspaceName: (row.workspace_name as string | null) || null,
      status: row.has_active_subscription
        ? "active"
        : row.has_workspace
          ? "awaiting_subscription"
          : "awaiting_workspace",
      totalBonusCents: row.total_bonus_cents ?? 0,
      lastBonusAt: row.last_bonus_at ? new Date(row.last_bonus_at).toISOString() : null,
    })),
    recentBonuses: bonusesResult.rows.map((row) => ({
      id: row.id as string,
      referredName: row.referred_name as string,
      workspaceName: (row.workspace_name as string | null) || null,
      invoiceAmountCents: row.invoice_amount_cents ?? 0,
      bonusAmountCents: row.bonus_amount_cents ?? 0,
      currency: (row.currency as string) || "brl",
      billingReason: (row.billing_reason as string | null) || null,
      invoicePaidAt: new Date(row.invoice_paid_at).toISOString(),
    })),
  };
}

export async function recordReferralBonusForInvoice(
  invoice: Stripe.Invoice | Record<string, any>,
  workspaceId: string | null | undefined
) {
  const normalizedInvoice = invoice as Record<string, any>;

  if (!workspaceId) {
    return { recorded: false, reason: "workspace_not_found" as const };
  }

  if (
    normalizedInvoice.status !== "paid" &&
    normalizedInvoice.status !== "open" &&
    normalizedInvoice.paid !== true
  ) {
    return { recorded: false, reason: "invoice_not_paid" as const };
  }

  if (
    normalizedInvoice.billing_reason !== "subscription_create" &&
    normalizedInvoice.billing_reason !== "subscription_cycle"
  ) {
    return { recorded: false, reason: "billing_reason_not_eligible" as const };
  }

  const invoiceId = normalizedInvoice.id;
  const invoiceAmountCents = normalizedInvoice.amount_paid ?? 0;
  const subscriptionId =
    typeof normalizedInvoice.subscription === "string"
      ? normalizedInvoice.subscription
      : normalizedInvoice.subscription?.id || null;
  const stripeCustomerId =
    typeof normalizedInvoice.customer === "string"
      ? normalizedInvoice.customer
      : normalizedInvoice.customer?.id || null;

  if (!invoiceId || invoiceAmountCents <= 0) {
    return { recorded: false, reason: "invoice_amount_invalid" as const };
  }

  const referralResult = await db.query(
    `
      SELECT
        owner.id AS referred_user_id,
        owner.referred_by_user_id AS referrer_user_id
      FROM workspaces w
      JOIN users owner ON owner.id = w.owner_id
      WHERE w.id = $1
      LIMIT 1
    `,
    [workspaceId]
  );

  const referredUserId = referralResult.rows[0]?.referred_user_id as string | null;
  const referrerUserId = referralResult.rows[0]?.referrer_user_id as string | null;

  if (!referredUserId || !referrerUserId || referrerUserId === referredUserId) {
    return { recorded: false, reason: "no_referral_relation" as const };
  }

  const bonusAmountCents = Math.round(
    invoiceAmountCents * (REFERRAL_BONUS_PERCENT / 100)
  );

  const insertResult = await db.query(
    `
      INSERT INTO referral_bonus_ledger (
        referrer_user_id,
        referred_user_id,
        workspace_id,
        stripe_subscription_id,
        stripe_invoice_id,
        stripe_customer_id,
        invoice_amount_cents,
        bonus_amount_cents,
        currency,
        bonus_percent,
        billing_reason,
        invoice_paid_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12))
      ON CONFLICT (stripe_invoice_id) DO NOTHING
      RETURNING id
    `,
    [
      referrerUserId,
      referredUserId,
      workspaceId,
      subscriptionId,
      invoiceId,
      stripeCustomerId,
      invoiceAmountCents,
      bonusAmountCents,
      normalizedInvoice.currency || "brl",
      REFERRAL_BONUS_PERCENT,
      normalizedInvoice.billing_reason || null,
      normalizedInvoice.status_transitions?.paid_at || Math.floor(Date.now() / 1000),
    ]
  );

  return {
    recorded: (insertResult.rowCount ?? 0) > 0,
    reason: (insertResult.rowCount ?? 0) > 0 ? ("inserted" as const) : ("duplicate" as const),
    bonusAmountCents,
  };
}
