import { redirect } from "next/navigation";

import { findReferrerByCode } from "@/lib/referrals-server";
import { normalizeReferralCode } from "@/lib/referrals";

export const dynamic = "force-dynamic";

export default async function ReferralRedirectPage(props: {
  params: Promise<{ code: string }>;
}) {
  const params = await props.params;
  const normalizedCode = normalizeReferralCode(params.code);

  if (!normalizedCode) {
    redirect("/register");
  }

  const referrer = await findReferrerByCode(normalizedCode);

  if (!referrer) {
    redirect("/register");
  }

  redirect(`/register?ref=${encodeURIComponent(normalizedCode)}`);
}
