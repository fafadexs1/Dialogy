import { AsaasBillingPanel } from '@/components/billing/asaas-billing-panel';
import LegacyStripeBillingPage from '@/components/billing/legacy-stripe-billing-page';
export default async function BillingPage({searchParams}:{searchParams:Promise<{provider?:string}>}) {
  const query=await searchParams;
  return query.provider==='stripe'?<LegacyStripeBillingPage/>:<AsaasBillingPanel/>;
}
