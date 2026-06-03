import type { Contact } from '@/lib/types';
import type { AutopilotIntentResolution, AutopilotSlotName } from './intent-types';
import type { SlotExtractionResult } from './slots';

export type TurnContinuationRequirement = {
  required: boolean;
  missingSlots: AutopilotSlotName[];
  nextSlot?: AutopilotSlotName;
  nextQuestion?: string;
  reason: string;
};

export type TurnContinuationRepair = {
  repaired: boolean;
  response: string;
  requirement: TurnContinuationRequirement;
};

const INTAKE_INTENTS = new Set<AutopilotIntentResolution['intent']>([
  'purchase_inquiry',
  'catalog_request',
  'pricing_request',
  'promotion_request',
  'availability_request',
  'scheduling_request',
  'order_or_request_status',
  'support_request',
  'change_request',
  'document_request',
  'unknown',
]);

const GENERIC_INTAKE_SLOTS: AutopilotSlotName[] = [
  'product_or_service_preference',
  'name',
  'customer_identifier',
  'address',
  'phone',
];

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasSlot(slots: SlotExtractionResult['slots'], slot: AutopilotSlotName): boolean {
  return Boolean(slots[slot]?.trim());
}

function isProgressiveTask(input: {
  intent: AutopilotIntentResolution['intent'];
  customerMessage: string;
  chatHistory?: string | null;
  response: string;
  slotExtraction: SlotExtractionResult;
  requiredSlots?: AutopilotSlotName[] | null;
}): boolean {
  if (input.requiredSlots?.length) return true;
  const text = normalizeText([
    input.customerMessage,
    input.chatHistory || '',
    input.response,
  ].join('\n'));
  const collectedCount = GENERIC_INTAKE_SLOTS.filter((slot) => hasSlot(input.slotExtraction.slots, slot)).length;
  return (
    INTAKE_INTENTS.has(input.intent) &&
    (
      collectedCount >= 2 ||
      /\b(cadastro|registr|formulario|solicitacao|pedido|reserva|agendamento|orcamento|cotacao|inscricao|contrat|assinar|atualizar dados|dados de contato|dados necessarios)\b/.test(text)
    )
  );
}

function slotQuestion(slot: AutopilotSlotName, contact?: Contact | null): string {
  switch (slot) {
    case 'product_or_service_preference':
      return 'Qual produto ou servico voce deseja?';
    case 'name':
      return 'Agora me informe seu nome completo, por favor.';
    case 'customer_identifier':
      return 'Agora me informe seu documento ou identificador cadastral, por favor.';
    case 'address':
      return 'Agora me informe o endereco ou localidade completa.';
    case 'phone':
      if (contact?.phone || contact?.phone_number_jid) {
        return 'Posso usar este WhatsApp como telefone de contato?';
      }
      return 'Agora me informe seu telefone ou WhatsApp de contato com DDD.';
    case 'email':
      return 'Agora me informe seu email de contato.';
    case 'date':
      return 'Qual data voce prefere?';
    case 'time':
      return 'Qual horario voce prefere?';
    case 'order_or_request_id':
      return 'Agora me informe o numero do pedido, protocolo ou solicitacao.';
    case 'invoice_or_payment_id':
      return 'Agora me informe o numero da fatura ou cobranca.';
    case 'location':
      return 'Agora me informe a localidade.';
    case 'quantity':
      return 'Qual quantidade voce precisa?';
    case 'product_or_service_id':
      return 'Qual produto ou servico devo considerar?';
    default:
      return `Para continuar, me informe ${slot}.`;
  }
}

function responseAsksForSlot(response: string, slot: AutopilotSlotName): boolean {
  const text = normalizeText(response);
  const asks = /\b(informe|envie|me passe|passa|diga|qual|pode me informar|pode me dizer|preciso|confirme)\b/.test(text) || response.includes('?');
  if (!asks) return false;
  const patterns: Record<AutopilotSlotName, RegExp> = {
    product_or_service_preference: /\b(produto|servico|item|opcao|contratar|assinar)\b/,
    name: /\b(nome|nome completo)\b/,
    customer_identifier: /\b(cpf|cnpj|documento|identificador)\b/,
    address: /\b(endereco|rua|quadra|lote|numero|bairro|cidade|cep|localizacao|localidade)\b/,
    phone: /\b(telefone|whatsapp|numero de contato|contato)\b/,
    email: /\b(email|e-mail)\b/,
    date: /\b(data|dia)\b/,
    time: /\b(horario|hora)\b/,
    order_or_request_id: /\b(protocolo|pedido|solicitacao|chamado|ticket)\b/,
    invoice_or_payment_id: /\b(fatura|boleto|cobranca)\b/,
    product_or_service_id: /\b(produto|servico)\b/,
    quantity: /\b(quantidade|quantos|quantas)\b/,
    location: /\b(localidade|bairro|cidade|regiao|endereco)\b/,
  };
  return patterns[slot]?.test(text) || false;
}

function responseAsksAnyQuestion(response: string): boolean {
  const text = normalizeText(response);
  return response.includes('?') ||
    /\b(informe|envie|me passe|passa|diga|qual|pode me informar|pode me dizer|preciso|confirme|como posso|quer que eu|deseja)\b/.test(text);
}

function responseHasProgressCommitment(response: string): boolean {
  const text = normalizeText(response);
  return /\b(vou registrar|vou finalizar|vou encaminhar|equipe.*entrar[a]? em contato|cadastro.*concluido|registro.*concluido|solicitacao.*registrada|dados necessarios.*coletados|nao falta mais nada|atendimento encerrado)\b/.test(text);
}

function isShortAcknowledgement(response: string): boolean {
  const text = normalizeText(response);
  if (response.includes('?')) return false;
  if (response.length > 180) return false;
  return /\b(ok|certo|perfeito|otimo|obrigad\w*|confirmad\w*|anotad\w*|registrad\w*|recebid\w*|ja tenho|pronto)\b/.test(text);
}

export function deriveTurnContinuationRequirement(input: {
  response: string;
  customerMessage: string;
  chatHistory?: string | null;
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
  contact?: Contact | null;
  requiredSlots?: AutopilotSlotName[] | null;
}): TurnContinuationRequirement {
  if (!isProgressiveTask({
    intent: input.intentResolution.intent,
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    response: input.response,
    slotExtraction: input.slotExtraction,
    requiredSlots: input.requiredSlots,
  })) {
    return { required: false, missingSlots: [], reason: 'not_progressive_task' };
  }

  const slotsToCheck = input.requiredSlots?.length ? input.requiredSlots : GENERIC_INTAKE_SLOTS;
  if (!isShortAcknowledgement(input.response)) {
    return { required: false, missingSlots: [], reason: 'informational_response_without_explicit_required_slots' };
  }
  const missingSlots = slotsToCheck.filter((slot) => !hasSlot(input.slotExtraction.slots, slot));
  const nextSlot = missingSlots[0];
  if (!nextSlot) {
    return { required: true, missingSlots: [], reason: 'progress_complete' };
  }

  return {
    required: true,
    missingSlots,
    nextSlot,
    nextQuestion: slotQuestion(nextSlot, input.contact),
    reason: 'progress_missing_next_slot',
  };
}

export function repairTurnContinuation(input: {
  response: string;
  customerMessage: string;
  chatHistory?: string | null;
  intentResolution: AutopilotIntentResolution;
  slotExtraction: SlotExtractionResult;
  contact?: Contact | null;
  requiredSlots?: AutopilotSlotName[] | null;
}): TurnContinuationRepair {
  const response = compact(input.response);
  const requirement = deriveTurnContinuationRequirement(input);
  if (!requirement.required) return { repaired: false, response, requirement };

  if (requirement.nextSlot && requirement.nextQuestion) {
    if (responseAsksForSlot(response, requirement.nextSlot) || responseAsksAnyQuestion(response)) {
      return { repaired: false, response, requirement };
    }
    return {
      repaired: true,
      response: [response, requirement.nextQuestion].filter(Boolean).join('\n\n'),
      requirement,
    };
  }

  if (responseHasProgressCommitment(response)) {
    return { repaired: false, response, requirement };
  }

  return {
    repaired: true,
    response: [
      response,
      'Ja tenho os dados principais. Vou registrar as informacoes e dar continuidade ao atendimento.',
    ].filter(Boolean).join('\n\n'),
    requirement,
  };
}
