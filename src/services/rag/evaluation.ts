import type { KnowledgeBaseDocument } from '@/lib/types';
import type { KnowledgeCoverage, UniversalAutopilotIntent } from '@/services/autopilot/intent-types';

export type RagLabCase = {
  id: string;
  title: string;
  profile: 'tecnico' | 'comercial' | 'geral';
  customerMessage: string;
  expectedIntent: UniversalAutopilotIntent;
  expectedDocumentId: string;
  expectedDocumentName: string;
};

export type RagLabCaseResult = {
  id: string;
  title: string;
  profile: RagLabCase['profile'];
  customerMessage: string;
  expectedIntent: UniversalAutopilotIntent;
  actualIntent: UniversalAutopilotIntent;
  expectedDocumentId: string;
  expectedDocumentName: string;
  activeSubAgent: string | null;
  allowedCollectionIds: string[] | null;
  knowledgeCoverage: KnowledgeCoverage;
  selectedDocuments: Array<{ id: string; name: string; score: number; source: 'vector' | 'static' }>;
  top1Passed: boolean;
  top3Passed: boolean;
  intentPassed: boolean;
  collectionLeakDetected: boolean;
  passed: boolean;
};

export type RagLabReport = {
  generatedAt: string;
  total: number;
  passed: number;
  top1Accuracy: number;
  top3Accuracy: number;
  intentAccuracy: number;
  collectionLeaks: number;
  cases: RagLabCaseResult[];
};

type CaseTemplate = {
  id: string;
  title: string;
  profile: RagLabCase['profile'];
  customerMessage: string;
  expectedIntent: UniversalAutopilotIntent;
  documentTerms: string[];
};

const CASE_TEMPLATES: CaseTemplate[] = [
  {
    id: 'technical_no_connection',
    title: 'Sem conexao',
    profile: 'tecnico',
    customerMessage: 'Estou sem conexao e minha internet nao voltou.',
    expectedIntent: 'troubleshooting',
    documentTerms: ['diagnostico tecnico'],
  },
  {
    id: 'technical_slow_connection',
    title: 'Lentidao no Wi-Fi',
    profile: 'tecnico',
    customerMessage: 'Minha internet esta muito lenta no Wi-Fi em todos os aparelhos.',
    expectedIntent: 'troubleshooting',
    documentTerms: ['diagnostico tecnico'],
  },
  {
    id: 'technical_los_red',
    title: 'LOS vermelho',
    profile: 'tecnico',
    customerMessage: 'A luz LOS do aparelho esta vermelha e estou sem sinal.',
    expectedIntent: 'troubleshooting',
    documentTerms: ['fibra optica', 'los loss'],
  },
  {
    id: 'technical_router_reboot',
    title: 'Reiniciar roteador',
    profile: 'tecnico',
    customerMessage: 'Voce consegue reiniciar meu roteador para testar a conexao?',
    expectedIntent: 'troubleshooting',
    documentTerms: ['roteador e wi-fi', 'roteador e wifi'],
  },
  {
    id: 'technical_wifi_password',
    title: 'Troca de senha Wi-Fi',
    profile: 'tecnico',
    customerMessage: 'Quero trocar o nome e a senha do meu Wi-Fi.',
    expectedIntent: 'change_request',
    documentTerms: ['roteador e wi-fi', 'roteador e wifi'],
  },
  {
    id: 'technical_billing_block',
    title: 'Pendencia financeira no suporte',
    profile: 'tecnico',
    customerMessage: 'Minha internet foi bloqueada por falta de pagamento, como resolvo?',
    expectedIntent: 'billing_or_payment',
    documentTerms: ['financeiro dentro do suporte'],
  },
  {
    id: 'commercial_plans',
    title: 'Planos de internet',
    profile: 'comercial',
    customerMessage: 'Quais planos de internet voces oferecem?',
    expectedIntent: 'catalog_request',
    documentTerms: ['catalogo oficial de planos', 'fluxo comercial'],
  },
  {
    id: 'commercial_registration_data',
    title: 'Dados para contratar',
    profile: 'comercial',
    customerMessage: 'Quero contratar. Quais dados preciso enviar?',
    expectedIntent: 'purchase_inquiry',
    documentTerms: ['dados obrigatorios'],
  },
  {
    id: 'commercial_wifi6',
    title: 'Informacao sobre Wi-Fi 6',
    profile: 'comercial',
    customerMessage: 'O que e Wi-Fi 6 e quais vantagens ele tem?',
    expectedIntent: 'support_request',
    documentTerms: ['wi-fi 6', 'wifi 6'],
  },
  {
    id: 'general_phone',
    title: 'Telefone da central',
    profile: 'geral',
    customerMessage: 'Qual e o numero da central de atendimento?',
    expectedIntent: 'unknown',
    documentTerms: ['numero da central'],
  },
];

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function ratio(matches: number, total: number) {
  return total > 0 ? Number((matches / total).toFixed(4)) : 0;
}

export function buildRagLabCases(documents: KnowledgeBaseDocument[]): RagLabCase[] {
  return CASE_TEMPLATES.flatMap((template) => {
    const document = documents.find((item) => {
      const name = normalize(item.name || '');
      return template.documentTerms.some((term) => name.includes(normalize(term)));
    });
    if (!document) return [];

    return [{
      id: template.id,
      title: template.title,
      profile: template.profile,
      customerMessage: template.customerMessage,
      expectedIntent: template.expectedIntent,
      expectedDocumentId: document.id,
      expectedDocumentName: document.name,
    }];
  });
}

export function summarizeRagLabResults(cases: RagLabCaseResult[]): RagLabReport {
  return {
    generatedAt: new Date().toISOString(),
    total: cases.length,
    passed: cases.filter((item) => item.passed).length,
    top1Accuracy: ratio(cases.filter((item) => item.top1Passed).length, cases.length),
    top3Accuracy: ratio(cases.filter((item) => item.top3Passed).length, cases.length),
    intentAccuracy: ratio(cases.filter((item) => item.intentPassed).length, cases.length),
    collectionLeaks: cases.filter((item) => item.collectionLeakDetected).length,
    cases,
  };
}
