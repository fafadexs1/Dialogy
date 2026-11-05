import type {ReactionKind} from '@/lib/team-reactions/catalog';
export function playReactionSound(context: AudioContext, kind: ReactionKind) {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.connect(gain); gain.connect(context.destination);
  oscillator.type = kind === 'pum' ? 'sawtooth' : 'sine';
  oscillator.frequency.setValueAtTime(kind === 'pum' ? 170 : kind === 'coffee' ? 500 : 660, now);
  oscillator.frequency.exponentialRampToValueAtTime(kind === 'pum' ? 55 : 950, now + 0.38);
  gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
  oscillator.start(now); oscillator.stop(now + 0.5);
}
export async function previewReactionSound(kind: ReactionKind) {
  if (typeof AudioContext === 'undefined') throw new Error('Seu navegador não suporta reprodução de áudio.');
  const context = new AudioContext();
  try { if (context.state === 'suspended') await context.resume(); playReactionSound(context,kind); }
  catch(error) { await context.close(); throw error; }
  setTimeout(() => { void context.close(); }, 1000);
}
