/**
 * Procedure Matcher
 *
 * Finds the best compiled ProcedureGraph for a given customer message
 * based on intent overlap, keyword scoring, and document relevance.
 */

import type { ProcedureGraph } from './procedure-types';
import type { UniversalAutopilotIntent } from './intent-types';

export type ProcedureMatchResult = {
  graph: ProcedureGraph;
  score: number;
  matchReason: string;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countKeywordHits(message: string, keywords: string[]): number {
  const normalizedMsg = normalizeText(message);
  const msgWords = normalizedMsg.split(/\s+/).filter(w => w.length >= 3);

  let hits = 0;
  for (const kw of keywords) {
    const normalizedKw = normalizeText(kw);
    // Exact substring check
    if (normalizedMsg.includes(normalizedKw)) {
      hits++;
      continue;
    }

    // Fuzzy prefix check
    const kwWords = normalizedKw.split(/\s+/).filter(w => w.length >= 3);
    let matched = false;
    for (const msgWord of msgWords) {
      for (const kwWord of kwWords) {
        if (
          msgWord.startsWith(kwWord.slice(0, 5)) ||
          kwWord.startsWith(msgWord.slice(0, 5))
        ) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) {
      hits++;
    }
  }
  return hits;
}

function hasRequiredDomainEvidence(documentName: string, customerMessage: string): boolean {
  const normalizedName = normalizeText(documentName);
  const normalizedMessage = normalizeText(customerMessage);

  if (/\b(los|loss|luz vermelha|fibra optica)\b/.test(normalizedName)) {
    const hasExplicitOpticalAlarm =
      /\b(los|loss)\b/.test(normalizedMessage) ||
      /\bluz(?:es)?\b.{0,30}\bvermelh\w*\b/.test(normalizedMessage) ||
      /\b(onu|ont|pon|fibra|modem)\b.{0,40}\b(vermelh\w*|sem sinal|apagad\w*)\b/.test(normalizedMessage) ||
      /\b(vermelh\w*|sem sinal)\b.{0,40}\b(onu|ont|pon|fibra)\b/.test(normalizedMessage);
    if (!hasExplicitOpticalAlarm) return false;
  }
  if (/\b(financeiro|pagamento|boleto|fatura|pix|cobranca)\b/.test(normalizedName)) {
    return /\b(financeiro|pagamento|pagar|boleto|fatura|pix|cobranca|vencimento|negociacao|promessa)\b/.test(normalizedMessage);
  }
  if (/\b(cancelamento|cancelar)\b/.test(normalizedName)) {
    return /\b(cancelar|cancelamento|desistir|encerrar contrato)\b/.test(normalizedMessage);
  }
  if (/\b(transferencia|transferir|humano|atendente)\b/.test(normalizedName)) {
    return /\b(transferir|transferencia|humano|atendente|falar com alguem|pessoa)\b/.test(normalizedMessage);
  }
  return true;
}

function graphSearchText(graph: ProcedureGraph): string {
  return normalizeText([
    graph.documentName,
    ...(graph.triggerKeywords || []),
    ...graph.steps.flatMap((step) => [
      step.label,
      step.toolName || '',
      step.semanticIntent || '',
      step.promptTemplate || '',
      step.responseTemplate || '',
      step.decisionPrompt || '',
      ...(step.branches || []).map((branch) => branch.condition),
    ]),
  ].join(' '));
}

function isExcludedByProcedureTrigger(graph: ProcedureGraph, customerMessage: string): boolean {
  const exclusions = Array.isArray(graph.metadata?.triggerExclusions)
    ? graph.metadata.triggerExclusions.map(String)
    : [];
  const normalizedMessage = normalizeText(customerMessage);
  return exclusions.some((exclusion) => {
    const normalizedExclusion = normalizeText(exclusion);
    if (!normalizedExclusion) return false;
    if (normalizedMessage.includes(normalizedExclusion) || normalizedExclusion.includes(normalizedMessage)) return true;
    const terms = normalizedExclusion.split(/\s+/).filter((term) => term.length >= 4);
    return terms.length >= 2 && terms.filter((term) => normalizedMessage.includes(term)).length >= Math.ceil(terms.length * 0.7);
  });
}

function graphPriority(graph: ProcedureGraph): number {
  const priority = Number(graph.metadata?.priority || 0);
  return Number.isFinite(priority) ? priority : 0;
}

function isCloseRequest(normalizedMessage: string): boolean {
  if (/\b(nao|não)\s+(recuperei|resolveu|funcionou|finalizou|terminou)\b/.test(normalizedMessage)) {
    return false;
  }
  if (/\b(quero|preciso|me passa|consultar|ver|verificar|senha|usuario|ssid|wifi|wi fi|credenciais|problema|pendencia)\b/.test(normalizedMessage)) {
    return false;
  }
  return /\b(encerrar|finalizar|fechar atendimento|pode fechar|pode encerrar|nada mais|nao preciso de mais nada|não preciso de mais nada|obrigado|obrigada|valeu|tchau)\b/.test(normalizedMessage);
}

function isCloseProcedure(graph: ProcedureGraph, searchText: string): boolean {
  return /\b(encerramento|encerrar atendimento|finalizacao|finalizar atendimento|close_chat)\b/.test(searchText)
    || graph.steps.some((step) => step.toolName === 'close_chat');
}

type CustomerProcedureNeed =
  | 'wifi_credentials_lookup'
  | 'wifi_credentials_change'
  | 'wifi_channel_diagnostics'
  | 'router_reboot'
  | null;

function inferCustomerProcedureNeed(customerMessage: string): CustomerProcedureNeed {
  const text = normalizeText(customerMessage);
  const mentionsWifi = /\b(wi[\s-]?fi|wifi|ssid|senha|usuario|credencia|nome da rede|rede sem fio)\w*/.test(text);
  const wantsChange = /\b(trocar|mudar|alterar|atualizar|definir|configurar|nova|novo)\w*/.test(text);
  const wantsLookup = /\b(ver|verificar|consultar|saber|mostrar|recuperar|esqueci|qual|quais|usuario|senha|ssid|nome da rede|credencia)\w*/.test(text);
  const wantsDiagnostics = /\b(canal|canais|redes ao redor|vizin|interferencia|lento|lentidao|oscila|queda|sinal fraco|analisar)\w*/.test(text);
  const wantsReboot = /\b(reiniciar|reinicie|reboot|resetar|desligar e ligar)\w*/.test(text);

  if (mentionsWifi && wantsChange) return 'wifi_credentials_change';
  if (mentionsWifi && wantsDiagnostics) return 'wifi_channel_diagnostics';
  if (wantsReboot) return 'router_reboot';
  if (mentionsWifi && wantsLookup) return 'wifi_credentials_lookup';
  return null;
}

function graphSupportsCustomerNeed(graphText: string, need: CustomerProcedureNeed): boolean {
  switch (need) {
    case 'wifi_credentials_lookup':
      return /\b(get_wifi_view|refresh_wifi_summary|wifi_credentials_lookup|consultar wi fi|consultar wifi|senha|usuario|ssid|credencia|nome da rede)\b/.test(graphText);
    case 'wifi_credentials_change':
      return /\b(change_wifi_credentials|wifi_credentials_change|trocar|mudar|alterar)\b/.test(graphText)
        && /\b(wifi|wi fi|ssid|senha|nome da rede|credencia)\b/.test(graphText);
    case 'wifi_channel_diagnostics':
      return /\b(scan_wifi_neighbors|get_wifi_scan_cached|wifi_channel_diagnostics|canal|canais|redes ao redor|vizin|interferencia|lentidao|lento)\b/.test(graphText);
    case 'router_reboot':
      return /\b(reboot_router|router_reboot|reiniciar|reboot|resetar)\b/.test(graphText);
    default:
      return false;
  }
}

/**
 * Given the resolved intent, the customer message, and the list of compiled
 * procedures, return the best match (if any).
 *
 * Scoring:
 *   +3 per intent match
 *   +1 per keyword hit
 *   +2 per title word hit
 *   Minimum score of 2 to be considered a match
 */
export function matchProcedure(input: {
  intent: UniversalAutopilotIntent;
  customerMessage: string;
  compiledProcedures: ProcedureGraph[];
}): ProcedureMatchResult | null {
  const { intent, customerMessage, compiledProcedures } = input;
  const normalizedMessage = normalizeText(customerMessage);
  const customerNeed = inferCustomerProcedureNeed(customerMessage);

  if (!compiledProcedures || compiledProcedures.length === 0) return null;

  const scored: ProcedureMatchResult[] = [];

  for (const graph of compiledProcedures) {
    if (isExcludedByProcedureTrigger(graph, customerMessage)) {
      continue;
    }
    if (!hasRequiredDomainEvidence(graph.documentName, customerMessage)) {
      continue;
    }
    const searchText = graphSearchText(graph);
    if (isCloseProcedure(graph, searchText) && !isCloseRequest(normalizedMessage)) {
      continue;
    }
    const isSectionAwareWifiProcedure = (
      graph.metadata?.sectionAware === true &&
      /\b(get_wifi_view|scan_wifi_neighbors|get_wifi_scan_cached|change_wifi_credentials|reboot_router)\b/.test(searchText)
    );
    if (
      isSectionAwareWifiProcedure &&
      (!customerNeed || !graphSupportsCustomerNeed(searchText, customerNeed))
    ) {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];

    // Intent overlap
    const intentMatch = graph.triggerIntents.includes(intent);
    if (intentMatch) {
      if (intent !== 'unknown') {
        score += 3;
        reasons.push(`intent "${intent}" match`);
      }
    }

    // Keyword hits
    const keywordHits = countKeywordHits(customerMessage, graph.triggerKeywords);
    if (keywordHits > 0) {
      score += keywordHits;
      reasons.push(`${keywordHits} keyword hit(s)`);
    }

    // Document name fuzzy match against message
    const docNameHit = normalizeText(customerMessage).includes(
      normalizeText(graph.documentName).slice(0, 20),
    );
    if (docNameHit) {
      score += 2;
      reasons.push('document name in message');
    }

    // NEW: Title word hits to boost specialized procedures
    const docWords = normalizeText(graph.documentName)
      .split(/[\s\-/,.:;!?()]+/)
      .filter((w) => w.length >= 4 && w !== 'para' && w !== 'como' && w !== 'suporte' && w !== 'atendimento' && w !== 'tecnico');

    const msgWords = normalizeText(customerMessage)
      .split(/[\s\-/,.:;!?()]+/)
      .filter((word) => word.length >= 3);

    let titleWordHits = 0;
    for (const dw of docWords) {
      for (const mw of msgWords) {
        if (mw.startsWith(dw.slice(0, 5)) || dw.startsWith(mw.slice(0, 5))) {
          titleWordHits++;
          break;
        }
      }
    }
    if (titleWordHits > 0) {
      score += titleWordHits * 2;
      reasons.push(`${titleWordHits} title word hit(s)`);
    }

    if (customerNeed && graphSupportsCustomerNeed(searchText, customerNeed)) {
      score += 8;
      reasons.push(`supports ${customerNeed}`);
    }

    const isVisualFlow = graph.metadata?.source === 'visual_flow';
    const hasExplicitIntentMatch = intentMatch && intent !== 'unknown';
    const hasExplicitNeedMatch = Boolean(
      customerNeed && graphSupportsCustomerNeed(searchText, customerNeed),
    );
    if (
      isVisualFlow &&
      !hasExplicitIntentMatch &&
      !hasExplicitNeedMatch &&
      score < 6
    ) {
      continue;
    }

    if (score >= 2) {
      scored.push({
        graph,
        score,
        matchReason: reasons.join(', '),
      });
    }
  }

  if (scored.length === 0) return null;

  // Sort by score descending, then by fewer steps (simpler procedure wins ties)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (graphPriority(b.graph) !== graphPriority(a.graph)) return graphPriority(b.graph) - graphPriority(a.graph);
    return a.graph.steps.length - b.graph.steps.length;
  });

  return scored[0];
}
