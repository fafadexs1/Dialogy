import { z } from 'zod';

const digits = z.string().max(40).transform(value => value.replace(/\D/g, ''));
export const checkoutReferenceSchema = z.object({
  workspaceId: z.string().min(1).max(80),
  paymentId: z.string().regex(/^pay_[a-zA-Z0-9]+$/).max(100),
});
export const paymentMethodSchema = z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export function validCardNumber(number: string) {
  if (!/^\d{13,19}$/.test(number) || /^(\d)\1+$/.test(number)) return false;
  let sum = 0;
  for (let i = number.length - 1, double = false; i >= 0; i--, double = !double) {
    let digit = Number(number[i]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

export const cardPaymentSchema = z.object({
  creditCard: z.object({
    holderName: z.string().trim().min(3).max(150),
    number: digits.refine(validCardNumber, 'Confira o número do cartão.'),
    expiryMonth: z.string().regex(/^(0[1-9]|1[0-2])$/),
    expiryYear: z.string().regex(/^20\d{2}$/),
    ccv: z.string().regex(/^\d{3,4}$/),
  }).refine(card => new Date(Number(card.expiryYear), Number(card.expiryMonth), 1).getTime() > Date.now(), 'O cartão está vencido.'),
  creditCardHolderInfo: z.object({
    name: z.string().trim().min(3).max(150),
    email: z.string().email().max(200),
    cpfCnpj: digits.refine(value => /^\d{11}$|^\d{14}$/.test(value)),
    postalCode: digits.refine(value => /^\d{8}$/.test(value)),
    addressNumber: z.string().trim().min(1).max(20),
    phone: digits.refine(value => /^\d{10,11}$/.test(value)),
  }),
});
export type CardPayment = z.infer<typeof cardPaymentSchema>;
export type CheckoutPayment = {
  id: string;
  amount: number;
  dueDate: string;
  status: string;
  billingType: string;
  paid: boolean;
  canPay: boolean;
  awaitingConfirmation: boolean;
  pix?: { image: string; code: string; expiresAt: string };
  boleto?: { code: string; url: string | null };
};
