export const REFERRAL_COOKIE_NAME = "dialogy_ref";
export const REFERRAL_BONUS_PERCENT = 15;

export type ReferralDashboardTotals = {
  totalSignups: number;
  workspaceCreated: number;
  validReferrals: number;
  totalSalesCents: number;
  totalBonusCents: number;
};

export type ReferralListItem = {
  id: string;
  name: string;
  email: string | null;
  workspaceName: string | null;
  status: "awaiting_workspace" | "awaiting_subscription" | "active";
  totalBonusCents: number;
  lastBonusAt: string | null;
};

export type ReferralBonusItem = {
  id: string;
  referredName: string;
  workspaceName: string | null;
  invoiceAmountCents: number;
  bonusAmountCents: number;
  currency: string;
  billingReason: string | null;
  invoicePaidAt: string;
};

export type ReferralDashboardData = {
  referralCode: string;
  referralLink: string;
  bonusPercent: number;
  totals: ReferralDashboardTotals;
  referrals: ReferralListItem[];
  recentBonuses: ReferralBonusItem[];
};

const MAX_REFERRAL_CODE_LENGTH = 32;

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeReferralCode(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = stripAccents(value)
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_REFERRAL_CODE_LENGTH);

  return normalized || null;
}

export function buildReferralCodeSeed(name?: string | null) {
  const normalizedName = stripAccents(name || "Dialogy")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const seed = normalizedName.split("-").filter(Boolean)[0] || "DIALOGY";
  return seed.slice(0, 10);
}

export function buildReferralLink(origin: string, code: string) {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  return `${normalizedOrigin}/r/${code}`;
}

export function formatCurrencyFromCents(amountInCents: number, currency = "BRL") {
  return (amountInCents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}
