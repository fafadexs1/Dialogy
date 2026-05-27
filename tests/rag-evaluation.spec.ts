import { describe, expect, it } from 'vitest';

import { buildRagLabCases, summarizeRagLabResults, type RagLabCaseResult } from '@/services/rag/evaluation';

describe('RAG evaluation laboratory', () => {
  it('builds only cases supported by the published knowledge documents', () => {
    const cases = buildRagLabCases([
      { id: 'los', name: 'Fibra optica - LOS LOSS luz vermelha', content: 'Diagnostico LOS.' },
      { id: 'plans', name: 'Fluxo comercial para novos clientes', content: 'Planos.' },
    ]);

    expect(cases.map((item) => item.id)).toContain('technical_los_red');
    expect(cases.map((item) => item.id)).toContain('commercial_plans');
    expect(cases.map((item) => item.id)).not.toContain('technical_router_reboot');
  });

  it('summarizes Top-K accuracy and collection leaks', () => {
    const results: RagLabCaseResult[] = [
      {
        id: 'one',
        title: 'Caso 1',
        profile: 'tecnico',
        customerMessage: 'LOS vermelho',
        expectedIntent: 'troubleshooting',
        actualIntent: 'troubleshooting',
        expectedDocumentId: 'los',
        expectedDocumentName: 'LOS',
        activeSubAgent: 'Tecnico',
        allowedCollectionIds: ['tecnico'],
        knowledgeCoverage: 'high',
        selectedDocuments: [{ id: 'los', name: 'LOS', score: 200, source: 'static' }],
        top1Passed: true,
        top3Passed: true,
        intentPassed: true,
        collectionLeakDetected: false,
        passed: true,
      },
      {
        id: 'two',
        title: 'Caso 2',
        profile: 'tecnico',
        customerMessage: 'senha wifi',
        expectedIntent: 'change_request',
        actualIntent: 'support_request',
        expectedDocumentId: 'wifi',
        expectedDocumentName: 'Wi-Fi',
        activeSubAgent: 'Tecnico',
        allowedCollectionIds: ['tecnico'],
        knowledgeCoverage: 'medium',
        selectedDocuments: [{ id: 'other', name: 'Outro', score: 80, source: 'vector' }],
        top1Passed: false,
        top3Passed: false,
        intentPassed: false,
        collectionLeakDetected: true,
        passed: false,
      },
    ];

    const report = summarizeRagLabResults(results);

    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.top1Accuracy).toBe(0.5);
    expect(report.top3Accuracy).toBe(0.5);
    expect(report.intentAccuracy).toBe(0.5);
    expect(report.collectionLeaks).toBe(1);
  });
});
