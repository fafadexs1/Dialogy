export const REACTIONS = {
  pum: { emoji: '💨', title: 'PUM!', description: 'Uma surpresa nada discreta' },
  applause: { emoji: '👏', title: 'Aplausos!', description: 'Para comemorar junto' },
  party: { emoji: '🎉', title: 'Festa!', description: 'Hora de celebrar' },
  coffee: { emoji: '☕', title: 'Café virtual!', description: 'Uma pausa merecida' },
} as const;
export type ReactionKind = keyof typeof REACTIONS;
export function isReactionKind(value: unknown): value is ReactionKind {
  return typeof value === 'string' && Object.hasOwn(REACTIONS, value);
}
export const reactionTopic = (userId: string) => `private:team-reaction:${userId}`;
export type TeamReaction = { id: string; kind: ReactionKind | 'gif'; senderName: string; workspaceId: string; message?: string; gif?: { url: string; name: string; sound: ReactionKind | 'none' } };
