import 'server-only';
import { type PoolClient } from 'pg';
import { ASAAS_PAID_STATUSES } from '@/lib/asaas-billing';
import { type CardPayment, type CheckoutPayment, type PaymentMethod } from '@/lib/asaas-checkout';
import { asaasRequest, readAsaasConfig, safeInvoiceUrl, AsaasError, type AsaasPayment } from './asaas-client';
import { withBillingLock, persistPayment, refreshAccess } from './asaas';

// The caller supplies only a reference. Ownership, environment, value and provider
// association are verified again before any payment data is returned or changed.
async function withPayment<T>(workspaceId: string, paymentId: string, operation: (
  context: { client: PoolClient; local: any; payment: AsaasPayment; config: Awaited<ReturnType<typeof readAsaasConfig>>; attempted: boolean },
) => Promise<T>) {
  return withBillingLock(workspaceId, async client => {
    const row = (await client.query(
      `SELECT s.*,p.card_attempt_started_at FROM asaas_subscriptions s
       JOIN asaas_payments p ON p.subscription_id=s.id WHERE s.workspace_id=$1 AND p.id=$2`,
      [workspaceId, paymentId],
    )).rows[0];
    if (!row) throw new Error('Fatura não encontrada neste workspace. Atualize a página.');
    const config = await readAsaasConfig();
    if (row.environment !== config.environment) throw new Error('O ambiente da cobrança mudou. Entre em contato com o suporte.');
    const payment = await asaasRequest<AsaasPayment>(config, `/payments/${encodeURIComponent(paymentId)}`);
    if (payment.id !== paymentId) throw new Error('Identificador da cobrança divergente.');
    await persistPayment(client, row, payment);
    await refreshAccess(client, row.id);
    return operation({ client, local: row, payment, config, attempted: !!row.card_attempt_started_at });
  });
}

function view(payment: AsaasPayment, attempted: boolean): CheckoutPayment {
  const paid = !payment.deleted && ASAAS_PAID_STATUSES.includes(payment.status);
  const payableStatus = ['PENDING', 'OVERDUE'].includes(payment.status);
  return {
    id: payment.id, amount: Number(payment.value), dueDate: payment.dueDate,
    status: payment.deleted ? 'DELETED' : payment.status, billingType: payment.billingType, paid,
    canPay: !payment.deleted && payableStatus && !attempted,
    awaitingConfirmation: !payment.deleted && !paid && ((attempted && payableStatus) || ['AWAITING_RISK_ANALYSIS', 'DUNNING_REQUESTED'].includes(payment.status)),
  };
}

export async function readCheckoutPayment(workspaceId: string, paymentId: string) {
  return withPayment(workspaceId, paymentId, async ({ payment, attempted }) => view(payment, attempted));
}

export async function prepareCheckoutPayment(workspaceId: string, paymentId: string, method: PaymentMethod) {
  return withPayment(workspaceId, paymentId, async ({ client, local, payment, config, attempted }) => {
    if (!view(payment, attempted).canPay) return view(payment, attempted);
    if (payment.billingType !== method) {
      payment = await asaasRequest<AsaasPayment>(config, `/payments/${encodeURIComponent(paymentId)}`, 'PUT', {
        billingType: method, value: Number(payment.value), dueDate: payment.dueDate,
      });
      if (payment.id !== paymentId) throw new Error('Identificador da cobrança divergente.');
      await persistPayment(client, local, payment);
      await refreshAccess(client, local.id);
    }
    const result = view(payment, attempted);
    if (!result.canPay) return result;
    if (method === 'PIX') {
      const pix = await asaasRequest<{ encodedImage: string; payload: string; expirationDate: string }>(config, `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
      if (!pix.payload || !pix.encodedImage) throw new Error('O Pix ainda não está disponível. Tente novamente em instantes.');
      result.pix = { image: `data:image/png;base64,${pix.encodedImage}`, code: pix.payload, expiresAt: pix.expirationDate };
    }
    if (method === 'BOLETO') {
      const boleto = await asaasRequest<{ identificationField: string }>(config, `/payments/${encodeURIComponent(paymentId)}/identificationField`);
      if (!boleto.identificationField) throw new Error('O boleto está sendo registrado. Tente novamente em instantes.');
      result.boleto = { code: boleto.identificationField, url: safeInvoiceUrl(payment.bankSlipUrl) };
    }
    return result;
  });
}

export async function payCheckoutWithCard(workspaceId: string, paymentId: string, card: CardPayment) {
  return withPayment(workspaceId, paymentId, async ({ client, local, payment, config, attempted }) => {
    if (!view(payment, attempted).canPay) return view(payment, attempted);
    if (payment.billingType !== 'CREDIT_CARD') {
      payment = await asaasRequest<AsaasPayment>(config, `/payments/${encodeURIComponent(paymentId)}`, 'PUT', {
        billingType: 'CREDIT_CARD', value: Number(payment.value), dueDate: payment.dueDate,
      });
      if (payment.id !== paymentId) throw new Error('Identificador da cobrança divergente.');
      await persistPayment(client, local, payment);
      await refreshAccess(client, local.id);
      if (!view(payment, attempted).canPay) return view(payment, attempted);
    }
    // Checkpoint commits before the non-idempotent request. Keep it on network
    // errors, 5xx, process death or failed persistence; NEVER automatically retry.
    await client.query('UPDATE asaas_payments SET card_attempt_started_at=now() WHERE id=$1', [paymentId]);
    try {
      payment = await asaasRequest<AsaasPayment>(config, `/payments/${encodeURIComponent(paymentId)}/payWithCreditCard`, 'POST', card, 65000);
    } catch (error) {
      if (error instanceof AsaasError && [400, 401, 403, 404, 422].includes(error.status)) {
        await client.query('UPDATE asaas_payments SET card_attempt_started_at=NULL WHERE id=$1', [paymentId]);
        throw new Error('O pagamento não foi autorizado. Confira os dados ou consulte o emissor do cartão.');
      }
      return { ...view(payment, true), awaitingConfirmation: true };
    }
    if (payment.id !== paymentId) throw new Error('Identificador da cobrança divergente.');
    await persistPayment(client, local, payment);
    await refreshAccess(client, local.id);
    return view(payment, true);
  });
}
