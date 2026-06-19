function normalizeClinicalText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const CLINICAL_SYMPTOM_PATTERNS: RegExp[] = [
  /\b(febre|temperatura|tosse|vomit(?:a|o|ando|ou|ar)?|diarreia|dor|doendo|manchas?|alergia|falta de ar|respira(?:cao|r|ndo)?|chiado|cansaco|prostrad[oa]|sonolent[aeo]?|convuls(?:ao|oes|ionando)?|desmaio|sangramento|desidratad[oa]|nausea|garganta|ouvido|coriza|secrecao|assadura|coceira|ferida|machucad[oa]|queda|batida|trauma)\b/,
  /\b(?:3[8-9]|4[0-2])(?:[,.]\d)?\s*(?:graus?|c|°c?)?\b/,
  /\bmuito\s+(?:ruim|mal|mole|abatid[oa]|prostrad[oa])\b/,
  /\bnao\s+(?:mama|come|bebe|dorme|acorda|responde)\b/,
];

const PEDIATRIC_CONTEXT_PATTERNS: RegExp[] = [
  /\b(bebe|crianca|filh[ao]|menino|menina|recem nascid[oa]|lactente|pediatr(?:a|ia|ico|ica)|mae|pai|pais|responsavel)\b/,
  /\b\d+\s*(?:mes|meses|ano|anos)\b/,
];

const GUIDANCE_REQUEST_PATTERNS: RegExp[] = [
  /\bo que (?:eu )?(?:devo|posso|preciso)\s+fazer\b/,
  /\b(?:devo|posso|preciso)\s+(?:fazer|dar|levar|esperar|observar|marcar|agendar)\b/,
  /\b(?:orientacao|orientar|duvida|ajuda|como proceder|como cuidar|e normal|ate a consulta|antes da consulta)\b/,
  /\b(?:antes|ate)\s+(?:da|do|a|o)?\s*consulta\b/,
];

const COMMERCIAL_ONLY_PATTERNS: RegExp[] = [
  /\b(?:preco|valor|valores|quanto custa|custa quanto|orcamento|forma de pagamento)\b/,
];

const CLINICAL_RED_FLAG_PATTERNS: RegExp[] = [
  /\b(respira(?:ndo|cao)?\s+(?:muito\s+)?rapid[ao]|falta de ar|cansac[oa]\s+para\s+respirar|costel[ao]s?\s+afund|peito\s+afund|furcula\s+afund|gemid[oa]s?\s+ao\s+respirar|labios?\s+(?:rox|azul)|dedos?\s+(?:rox|azul)|cianose)\b/,
  /\b(dificil\s+de\s+acordar|nao\s+acorda|sonolent[aeo]\s+ao\s+extremo|convuls(?:ao|oes|ionando)?|irritabilidade\s+inconsolavel)\b/,
  /\b(vomit(?:a|ou|ando)?\s+tudo|nao\s+consegue\s+(?:mamar|beber|tomar)|recusa\s+(?:liquidos|mamar)|boca\s+seca|olhos?\s+fundos?|sem\s+urinar|nao\s+urina|choro\s+sem\s+lagrimas?)\b/,
  /\b(?:6|7|8|9|10|11|12)\s*(?:h|hora|horas)\b.{0,80}\b(?:sem\s+urinar|nao\s+urina|xixi)\b/,
  /\b(?:sem\s+urinar|nao\s+urina|xixi)\b.{0,80}\b(?:6|7|8|9|10|11|12)\s*(?:h|hora|horas)\b/,
  /\b(manchas?\s+(?:vermelh|arroxead|rox).{0,80}(?:nao\s+somem|nao\s+some|pressionar))\b/,
  /\b(?:bebe|lactente|recem\s+nascid[oa]).{0,80}\b(?:[0-2]\s*mes(?:es)?|menor(?:es)?\s+de\s+3\s+mes(?:es)?)\b.{0,80}\b(?:febre|3[8-9](?:[,.]\d)?|4[0-2](?:[,.]\d)?)\b/,
];

function matchesAnyPattern(normalizedText: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(normalizedText));
}

export function hasClinicalTriageSignal(message: string): boolean {
  const normalized = normalizeClinicalText(message);
  if (!normalized) return false;

  const hasSymptom = matchesAnyPattern(normalized, CLINICAL_SYMPTOM_PATTERNS);
  if (!hasSymptom) return false;

  const hasPediatricContext = matchesAnyPattern(normalized, PEDIATRIC_CONTEXT_PATTERNS);
  const asksForGuidance = matchesAnyPattern(normalized, GUIDANCE_REQUEST_PATTERNS);
  const isCommercialOnly = matchesAnyPattern(normalized, COMMERCIAL_ONLY_PATTERNS) && !asksForGuidance;

  return asksForGuidance || (hasPediatricContext && !isCommercialOnly);
}

export function hasClinicalRedFlagSignal(message: string): boolean {
  const normalized = normalizeClinicalText(message);
  if (!normalized) return false;
  if (!hasClinicalTriageSignal(message)) return false;
  return matchesAnyPattern(normalized, CLINICAL_RED_FLAG_PATTERNS);
}
