import { redirect } from "next/navigation";

import { ReferralsDashboard } from "@/components/referrals/referrals-dashboard";
import { getReferralDashboardForCurrentUser } from "@/lib/referrals-server";

export default async function ReferralsPage() {
  const dashboard = await getReferralDashboardForCurrentUser();

  if (!dashboard) {
    redirect("/login?next=/referrals");
  }

  return <ReferralsDashboard dashboard={dashboard} />;
}
