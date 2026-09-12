import 'server-only';
import type Stripe from 'stripe';
import { db } from '@/lib/db';
import { addAiCredits } from './credits';

export async function fulfillAiCreditCheckout(session: Stripe.Checkout.Session) {
  if (session.metadata?.type !== 'ai_credits') return false;
  if (session.payment_status !== 'paid') return true;
  const result = await db.query('SELECT * FROM ai_credit_orders WHERE id=$1',[session.metadata.orderId]);
  const order = result.rows[0];
  if (!order || order.stripe_session_id !== session.id || session.currency !== 'brl' || session.amount_total !== order.amount_cents || session.client_reference_id !== order.id) throw new Error('Pagamento de creditos divergente do pedido.');
  await addAiCredits({workspaceId:order.workspace_id,credits:Number(order.credits),reference:`stripe:${session.id}`,description:'Recarga de creditos',kind:'purchase'});
  await db.query("UPDATE ai_credit_orders SET status='paid' WHERE id=$1",[order.id]);
  return true;
}
