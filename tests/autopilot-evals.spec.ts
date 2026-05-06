import { describe, expect, it } from 'vitest';

import { runOfflineAutopilotEvals } from '@/services/autopilot/eval-runner';

describe('autopilot offline eval suite', () => {
  it('passes deterministic regression cases across intent, RAG, workflow, planner and validator', () => {
    const report = runOfflineAutopilotEvals();

    expect(report.summary.total).toBeGreaterThanOrEqual(20);
    expect(report.failures).toEqual([]);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.intentAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.ragPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.workflowPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.toolPlannerPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.validatorPassRate).toBeGreaterThanOrEqual(0.95);
    expect(report.summary.unexpectedFallbackRate).toBe(0);
  });

  it('exposes operational quality metrics for dashboards', () => {
    const report = runOfflineAutopilotEvals();

    expect(report.summary.intentCounts.billing_or_payment).toBeGreaterThanOrEqual(3);
    expect(report.summary.validatorDecisionCounts.approve).toBeGreaterThan(0);
    expect(report.summary.validatorInterventionRate).toBeGreaterThan(0);
    expect(report.summary.toolPlannerRejectionRate).toBeGreaterThan(0);
    expect(report.summary.fallbackRate).toBeGreaterThan(0);
    expect(report.summary.ragStrategyCounts.static_documents).toBeGreaterThan(0);
  });
});
