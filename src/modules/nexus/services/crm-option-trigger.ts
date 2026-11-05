export type CrmOptionCondition = { fieldId: string; value: string };

/** Exact option values: "Não assinou" must never match "Assinou". */
export function crmOptionMatches(condition: unknown, payload: Record<string, unknown> = {}) {
  if (!condition || typeof condition !== 'object') return false;
  const { fieldId, value } = condition as CrmOptionCondition;
  if (typeof fieldId !== 'string' || !fieldId || typeof value !== 'string' || !value) return false;
  const changes = payload.changedFields;
  return Boolean(changes && typeof changes === 'object'
    && Object.prototype.hasOwnProperty.call(changes, fieldId)
    && (changes as Record<string, unknown>)[fieldId] === value);
}

export function changedCrmFields(previous: Record<string, unknown>, current: Record<string, unknown>) {
  return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter((id) => (previous[id] ?? '') !== (current[id] ?? ''))
    .map((id) => [id, current[id] ?? '']));
}
