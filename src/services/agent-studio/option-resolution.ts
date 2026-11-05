/** Resolve customer language only against the options actually offered this turn. */
export type StudioOptionResolution =
  | { kind: 'selected'; value: string; strategy: 'exact' | 'position' | 'label' | 'short_answer' }
  | { kind: 'ambiguous'; options: string[] }
  | { kind: 'unrecognized' };

const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

export function isStudioInformationQuestion(message: string): boolean {
  const text = normalize(message);
  return message.includes('?') || /^(?:e )?(?:qual|quais|como|quanto|quantos|quando|onde|por que|porque|tem|possui|inclui|aceita|funciona|existe|pode me explicar|me explica|me explique|gostaria de saber|quero saber|tenho uma duvida)\b/.test(text);
}

export function extractExplicitChoiceClause(message: string): string | undefined {
  if (!message || typeof message !== 'string') return undefined;
  if (/\b(?:desde que|mas\s+(?:somente|apenas|so\b)|a menos que)\b/i.test(message)) return undefined;
  const parts = message.split(/(?:[.?!\n;]+|\s+(?:mas|porem|so que|e queria|e gostaria|e me diz|tu pode|voce pode)\b)/i)
    .map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const norm = normalize(part);
    if (/\b(?:nao quero|não quero|nao prefiro|não prefiro|desisti|nem pensar)\b/.test(norm)) continue;
    if (/\b(?:quero|prefiro|escolho|seleciono|fico com|vou ficar com|vou querer|pode ser)\b/.test(norm)) {
      if (/\b(?:quero|gostaria de)\s+(?:saber|entender|ver|conhecer|tirar)\b/.test(norm)) continue;
      return part;
    }
  }
  return undefined;
}

const ordinals = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'setimo', 'oitavo', 'nono', 'decimo'];
const selectionText = (text: string) => text
  .replace(/^acho que (?=(?:eu )?(?:fico com|quero|prefiro|escolho)\b)/, '')
  .replace(/^(?:(?:eu )?(?:quero|prefiro|escolho|seleciono|vou querer|fico com|vou ficar com|pode ser)\s+)?(?:(?:na verdade|realmente)\s+)?(?:(?:o|a|esse|este|essa|esta|aquele|aquela)\s+)?(?:(?:plano|opcao|alternativa)(?: de| numero)?\s+|de\s+)?/, '')
  .replace(/\s+(?:por favor|mesmo|obrigad[oa])$/, '').trim();

function resolveCandidates(options: string[], strategy: 'label' | 'short_answer'): StudioOptionResolution {
  if (options.length === 1) return { kind: 'selected', value: options[0], strategy };
  return options.length ? { kind: 'ambiguous', options } : { kind: 'unrecognized' };
}

export function resolveStudioOption(options: readonly string[], message: string, allowPosition = true): StudioOptionResolution {
  if (!message.trim() || message.length > 4000) return { kind: 'unrecognized' };

  const choiceClause = extractExplicitChoiceClause(message);
  if (choiceClause && choiceClause !== message) {
    const resolved = resolveStudioOption(options, choiceClause, allowPosition);
    if (resolved.kind === 'selected') return resolved;
  }

  if (isStudioInformationQuestion(message) && !options.some((option) => option.trim() === message.trim())) {
    return { kind: 'unrecognized' };
  }

  const text = normalize(message);
  const exact = options.filter((option) => normalize(option) === text);
  if (exact.length === 1) return { kind: 'selected', value: exact[0], strategy: 'exact' };
  if (exact.length > 1) return { kind: 'ambiguous', options: exact };

  const isNegated = /\b(?:nao|não|nem)\s+(?:quero|prefiro|escolho|seleciono|fico|vou)\b/.test(text);
  if (isNegated) return { kind: 'unrecognized' };

  if (/\b(?:desde que|mas somente|mas apenas|mas so com|se tiver|caso tenha|a menos que)\b/.test(text)) return { kind: 'unrecognized' };
  if (/\b(?:quero|gostaria de)\s+(?:entender|saber|ver|conhecer|tirar)\b/.test(text)) return { kind: 'unrecognized' };

  const explicitChoice = /\b(?:quero|prefiro|escolho|seleciono|fico com|vou ficar com|vou querer|pode ser|esse|este|essa|esta|aquele|aquela)\b/.test(text);
  const answer = selectionText(explicitChoice ? text.split(/\s+(?:porque|pois|ja que|que eu)\s+/)[0] : text);
  if (allowPosition) {
    const ordinalIndex = ordinals.findIndex((ordinal) => ordinal === answer.replace(/a$/, 'o'));
    const index = /^\d+$/.test(answer) ? Number(answer) - 1 : ordinalIndex;
    const positioned = options[index];
    if (positioned !== undefined) {
      // A number can be both a list position and a product's name: clarify.
      const numericLabels = options.filter((option) => /^\d+$/.test(answer) && normalize(option).split(' ')[0] === answer);
      const candidates = [...new Set([positioned, ...numericLabels])];
      return candidates.length === 1 ? { kind: 'selected', value: positioned, strategy: 'position' } : { kind: 'ambiguous', options: candidates };
    }
  }

  // Only use the product heading, never numbers in prices or bundled benefits.
  const headings = options.map((option) => ({ option, heading: normalize(option.split(/\s*(?:\+|—|–|\|)\s*|\s+-\s+/)[0]) }));
  const labels = headings.filter(({ heading }) => heading.length >= 3
    && (answer === heading || (explicitChoice && ` ${text} `.includes(` ${heading} `))));
  if (labels.length) return resolveCandidates(labels.map(({ option }) => option), 'label');
  // A short answer must cover complete leading words. "50" never matches "500".
  const short = headings.filter(({ heading }) => answer.length >= 3 && (heading === answer || heading.startsWith(`${answer} `)));
  return resolveCandidates(short.map(({ option }) => option), 'short_answer');
}
