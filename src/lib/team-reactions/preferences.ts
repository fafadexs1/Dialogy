export const REACTION_SOUND_EVENT = 'dialogy:reaction-sound-preference';
export function notifyReactionSoundPreference(muted:boolean){window.dispatchEvent(new CustomEvent(REACTION_SOUND_EVENT,{detail:{muted}}));}

export type TeamReactionPreference = { userId: string; enabled: boolean; muted: boolean };
export const REACTION_PREFERENCE_EVENT = 'dialogy:team-reaction-preference';
export const reactionPreferenceKey = (userId: string) => `dialogy:team-reaction-preference:${userId}`;
export function notifyTeamReactionPreference(preference: TeamReactionPreference) {
  window.dispatchEvent(new CustomEvent(REACTION_PREFERENCE_EVENT, { detail: preference }));
  try { localStorage.setItem(reactionPreferenceKey(preference.userId), JSON.stringify({ ...preference, updatedAt: Date.now() })); }
  catch { /* The account preference remains saved even when browser storage is unavailable. */ }
}
