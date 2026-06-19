import { db } from '@/lib/db';
import { createHash } from 'crypto';
import { extractAutopilotSlots, type ExtractedSlotDetail } from '@/services/autopilot/slots';
import type { AutopilotSlotName } from '@/services/autopilot/intent-types';
import type {
  ResourceFieldContract,
  ResourceFieldMapping,
  ResourceMappingInput,
  ResourceMappingResult,
  ResourceSlotEvidence,
} from './types';
import { loadResourceMappingProfileAliases } from './profiles';

const MIN_FIELD_MATCH_SCORE = 0.72;
const MIN_INFERRED_MATCH_SCORE = 0.82;
const MAX_FIELD_VALUE_CHARS = 500;

const SLOT_ALIASES: Record<AutopilotSlotName | string, string[]> = {
  name: ['nome', 'nome completo', 'cliente', 'lead', 'responsavel', 'contato'],
  customer_identifier: ['cpf', 'cnpj', 'cpf/cnpj', 'documento', 'identificador', 'identificador cadastrado', 'cadastro'],
  date: ['data', 'dia', 'data desejada', 'data de agendamento'],
  time: ['horario', 'hora', 'periodo', 'horario desejado'],
  phone: ['telefone', 'celular', 'whatsapp', 'numero', 'numero de contato', 'telefone de contato'],
  email: ['email', 'e-mail', 'correio eletronico'],
  address: ['endereco', 'endereco completo', 'rua', 'localizacao', 'localidade', 'cep'],
  order_or_request_id: ['pedido', 'protocolo', 'solicitacao', 'chamado', 'ticket', 'ordem'],
  invoice_or_payment_id: ['fatura', 'boleto', 'cobranca', 'pagamento'],
  product_or_service_id: ['produto', 'servico', 'plano', 'item'],
  product_or_service_preference: ['produto desejado', 'servico desejado', 'preferencia', 'interesse', 'plano escolhido', 'produto escolhido'],
  quantity: ['quantidade', 'qtd', 'unidades'],
  location: ['local', 'localidade', 'cidade', 'regiao'],
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 1));
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function stringifyFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_VALUE_CHARS);
}

function hashPayload(value: unknown): string | null {
  if (!value || (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)) return null;
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function parseOptions(options: unknown): string[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options
      .map((item) => typeof item === 'string' ? item : (item && typeof item === 'object' ? (item as any).label || (item as any).value : null))
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof options === 'object') {
    return Object.values(options as Record<string, unknown>)
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeFieldValue(field: ResourceFieldContract, rawValue: unknown): string | null {
  const value = stringifyFieldValue(rawValue);
  if (!value) return null;
  const fieldType = normalizeText(field.type);

  if (fieldType.includes('phone') || /\b(telefone|celular|whatsapp)\b/.test(normalizeText(field.label))) {
    const digits = onlyDigits(value);
    return digits.length >= 8 ? digits : value;
  }

  if (fieldType.includes('email') || /\bemail|e mail\b/.test(normalizeText(field.label))) {
    const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    return email || null;
  }

  if (fieldType.includes('number') || fieldType.includes('currency')) {
    const numeric = value.replace(/[^\d,.-]/g, '').replace(',', '.');
    return numeric ? numeric : null;
  }

  if (fieldType.includes('select')) {
    const options = parseOptions(field.options);
    if (options.length === 0) return value;
    const normalizedValue = normalizeText(value);
    const exact = options.find((option) => normalizeText(option) === normalizedValue);
    if (exact) return exact;
    const fuzzy = options.find((option) => {
      const normalizedOption = normalizeText(option);
      return normalizedOption.includes(normalizedValue) || normalizedValue.includes(normalizedOption);
    });
    return fuzzy || null;
  }

  if (fieldType.includes('checkbox')) {
    const normalized = normalizeText(value);
    if (/^(true|sim|yes|1|ok|confirmado)$/.test(normalized)) return 'true';
    if (/^(false|nao|não|no|0)$/.test(normalized)) return 'false';
  }

  return value;
}

function fieldAliases(field: Pick<ResourceFieldContract, 'label' | 'placeholder' | 'aliases'>): string[] {
  return Array.from(new Set([
    field.label,
    field.placeholder || '',
    ...field.aliases,
  ].map((item) => normalizeText(item)).filter(Boolean)));
}

function aliasesForFieldFromProfile(
  field: Pick<ResourceFieldContract, 'id' | 'label'>,
  profile: Record<string, string[]>,
): string[] {
  const normalizedLabel = normalizeText(field.label);
  return Array.from(new Set([
    ...(profile[field.id] || []),
    ...(profile[field.label] || []),
    ...(profile[normalizedLabel] || []),
  ].map((item) => String(item || '').trim()).filter(Boolean)));
}

function scoreAliasToField(alias: string, field: ResourceFieldContract): number {
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return 0;
  const aliases = fieldAliases(field);
  if (aliases.some((candidate) => candidate === normalizedAlias)) return 1;
  if (aliases.some((candidate) => candidate.includes(normalizedAlias) || normalizedAlias.includes(candidate))) return 0.88;

  const aliasTokens = tokenize(normalizedAlias);
  if (aliasTokens.size === 0) return 0;
  let best = 0;
  for (const candidate of aliases) {
    const candidateTokens = tokenize(candidate);
    const overlap = [...aliasTokens].filter((token) => candidateTokens.has(token)).length;
    if (overlap === 0) continue;
    const precision = overlap / aliasTokens.size;
    const recall = overlap / candidateTokens.size;
    best = Math.max(best, (2 * precision * recall) / Math.max(precision + recall, 0.0001));
  }
  return best;
}

function inferSlotFromRequestedKey(key: string): string | null {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) return null;
  for (const [slot, aliases] of Object.entries(SLOT_ALIASES)) {
    if ([slot, ...aliases].some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedKey === normalizedAlias ||
        normalizedKey.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedKey);
    })) {
      return slot;
    }
  }
  return null;
}

function buildEvidence(input: ResourceMappingInput): ResourceSlotEvidence[] {
  const slotExtraction = input.slotExtraction || extractAutopilotSlots({
    customerMessage: input.customerMessage,
    chatHistory: input.chatHistory,
    contact: input.contact,
  });

  const evidence: ResourceSlotEvidence[] = [];
  const detailsBySlot = new Map<string, ExtractedSlotDetail>();
  for (const detail of slotExtraction.details || []) {
    detailsBySlot.set(detail.name, detail);
  }

  for (const [slot, value] of Object.entries(slotExtraction.slots || {})) {
    if (!value) continue;
    const detail = detailsBySlot.get(slot);
    evidence.push({
      slot,
      value: stringifyFieldValue(value),
      source: detail?.source || 'inferred',
      confidence: detail?.confidence || 0.75,
    });
  }

  for (const [key, rawValue] of Object.entries(input.fields || {})) {
    const value = stringifyFieldValue(rawValue);
    if (!value) continue;
    evidence.push({
      slot: inferSlotFromRequestedKey(key) || key,
      value,
      source: 'model_payload',
      confidence: 0.68,
      requestedKey: key,
    });
  }

  return evidence;
}

function bestFieldForEvidence(
  evidence: ResourceSlotEvidence,
  fields: ResourceFieldContract[],
  usedFieldIds: Set<string>
): { field: ResourceFieldContract; score: number; reason: string } | null {
  const requestedKey = String(evidence.requestedKey || '').trim();
  if (requestedKey) {
    const exactId = fields.find((field) => !usedFieldIds.has(field.id) && field.id === requestedKey);
    if (exactId) {
      return { field: exactId, score: 1, reason: 'field_id_match' };
    }
  }

  const aliases = Array.from(new Set([
    evidence.slot,
    ...(SLOT_ALIASES[evidence.slot] || []),
  ].map((item) => String(item))));

  let best: { field: ResourceFieldContract; score: number; reason: string } | null = null;
  for (const field of fields) {
    if (usedFieldIds.has(field.id)) continue;
    const score = Math.max(...aliases.map((alias) => scoreAliasToField(alias, field)), 0);
    if (!best || score > best.score) {
      best = {
        field,
        score,
        reason: score >= 1
          ? 'field_exact_alias_match'
          : score >= 0.88
            ? 'field_fuzzy_alias_match'
            : 'field_token_overlap',
      };
    }
  }

  if (!best) return null;
  const threshold = evidence.source === 'model_payload' ? MIN_FIELD_MATCH_SCORE : MIN_INFERRED_MATCH_SCORE;
  return best.score >= threshold ? best : null;
}

export async function loadCrmContactCustomFieldContracts(workspaceId: string): Promise<ResourceFieldContract[]> {
  const fieldsRes = await db.query(
    `SELECT id, label, type, placeholder, options
     FROM public.custom_field_definitions
     WHERE workspace_id = $1
     ORDER BY label ASC`,
    [workspaceId]
  );
  const aliasesByField = await loadResourceMappingProfileAliases({ workspaceId });

  return fieldsRes.rows
    .filter((row) => row.id && row.label)
    .map((row) => ({
      id: String(row.id),
      label: String(row.label || ''),
      type: String(row.type || 'text'),
      placeholder: row.placeholder ? String(row.placeholder) : null,
      options: row.options ?? null,
      aliases: aliasesForFieldFromProfile({
        id: String(row.id),
        label: String(row.label || ''),
      }, aliasesByField),
    }));
}

export async function mapCrmContactCustomFields(input: ResourceMappingInput): Promise<ResourceMappingResult> {
  const fields = await loadCrmContactCustomFieldContracts(input.workspaceId);
  const rejected: ResourceMappingResult['rejected'] = [];
  const mappings: ResourceFieldMapping[] = [];
  const mappedFields: Record<string, string> = {};
  const usedFieldIds = new Set<string>();

  if (fields.length === 0) {
    return {
      resource: 'crm.contact.custom_fields',
      operation: 'update',
      mappedAction: null,
      mappings: [],
      rejected: [{ slot: 'crm.contact.custom_fields', reason: 'Workspace nao possui campos customizados de CRM.' }],
      status: 'unmapped',
      confidence: 0,
      evidence: ['Workspace nao possui campos customizados de CRM para mapear.'],
      warnings: ['crm_fields_missing'],
      payloadHash: null,
    };
  }

  const evidenceList = buildEvidence(input)
    .filter((evidence) => evidence.value)
    .sort((left, right) => right.confidence - left.confidence);

  for (const evidence of evidenceList) {
    const match = bestFieldForEvidence(evidence, fields, usedFieldIds);
    if (!match) {
      rejected.push({
        slot: evidence.slot,
        value: evidence.value,
        reason: 'Nenhum campo de CRM com alias/label compativel foi encontrado.',
      });
      continue;
    }

    const value = normalizeFieldValue(match.field, evidence.value);
    if (!value) {
      rejected.push({
        slot: evidence.slot,
        value: evidence.value,
        reason: `Valor incompativel com o tipo do campo "${match.field.label}".`,
      });
      continue;
    }

    usedFieldIds.add(match.field.id);
    mappedFields[match.field.id] = value;
    mappings.push({
      resource: 'crm.contact.custom_fields',
      operation: 'update',
      slot: evidence.slot,
      fieldId: match.field.id,
      fieldLabel: match.field.label,
      value,
      confidence: Math.min(1, Number((evidence.confidence * match.score).toFixed(3))),
      source: evidence.source,
      reason: match.reason,
    });
  }

  const status = mappings.length === 0
    ? 'unmapped'
    : rejected.length > 0
      ? 'partial'
      : 'mapped';
  const confidence = mappings.length > 0
    ? Number((mappings.reduce((total, mapping) => total + mapping.confidence, 0) / mappings.length).toFixed(3))
    : 0;
  const payloadHash = hashPayload(mappedFields);

  return {
    resource: 'crm.contact.custom_fields',
    operation: 'update',
    mappedAction: mappings.length > 0
      ? {
          type: 'crm_update_contact_custom_fields',
          reason: input.reason || 'Resource Mapper atualizou campos de CRM a partir dos dados coletados.',
          payload: { fields: mappedFields },
        }
      : null,
    mappings,
    rejected,
    status,
    confidence,
    evidence: mappings.map((mapping) => (
      `${mapping.slot} -> ${mapping.fieldLabel} (${mapping.reason}, ${mapping.confidence})`
    )),
    warnings: rejected.map((item) => item.reason),
    payloadHash,
  };
}
