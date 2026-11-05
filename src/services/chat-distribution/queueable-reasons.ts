/**
 * Pure (no imports) so the workflow runtime can use it without pulling in the database layer.
 *
 * A team that cannot take a chat right now is a waiting problem, not a failure: the customer must
 * keep an owner (the team queue) and a message. `no_members` is excluded on purpose, since nobody
 * will ever pick that queue up and it signals a misconfigured team.
 */
const QUEUEABLE_REASONS: ReadonlySet<string> = new Set([
  'all_offline', 'not_accepting', 'portfolio_full', 'load_protected', 'outside_business_hours',
]);

export function isQueueableTeamReason(reason: unknown): reason is string {
  return typeof reason === 'string' && QUEUEABLE_REASONS.has(reason);
}
