import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';
import {
  applyCausalPatternToDraft,
  applySafeCausalPatternAutoTuneToDraft,
  buildCausalPatternDraftApplicationPlan,
  buildCausalPatternLearningDocument,
  buildSwitchPatternDraftGraphPatch,
  isCausalPatternSafeAutoTuneEligible,
  markDraftCausalPatternApplicationsDiscarded,
  markDraftCausalPatternApplicationsPublished,
  revertCausalPatternDraftApplication,
  previewCausalPatternDraftApplication,
} from '@/services/autopilot/causal-pattern-apply';

vi.mock('@/lib/db', () => ({
  db: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

function createClientMock() {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

const approvedPattern = {
  id: 'pattern-1',
  pattern_type: 'confusing_step',
  procedure_id: 'proc-wifi',
  step_id: 'collect-router-context',
  tool_name: null,
  insight: 'A etapa collect-router-context parece confusa.',
  evidence_json: { sampleSize: 5, averageTurnsOnStep: 3 },
  suggested_fix_json: {
    action: 'clarify_prompt_or_split_step',
    reason: 'Muitos turnos na etapa.',
  },
  impact_json: { affectedConversations: 5 },
  confidence: 0.82,
  status: 'approved',
};

const configRow = {
  name: 'Agente',
  gemini_api_key: null,
  ai_model: 'gemini-2.5-flash',
  transcription_model: null,
  knowledge_base: null,
  knowledge_base_documents: JSON.stringify([{ id: 'doc-existing', name: 'FAQ', content: 'Base atual.' }]),
  knowledge_collections: JSON.stringify([{ id: 'general', name: 'Geral', isDefault: true }]),
  is_active: true,
  is_private: false,
  default_fallback_reply: null,
  escalation_policy: null,
  closing_policy: null,
  enabled_tool_names: JSON.stringify([]),
  flow_graph: null,
};

const switchPattern = {
  id: 'pattern-switch-1',
  pattern_type: 'switch_route_low_confidence',
  procedure_id: null,
  step_id: 'switch-wifi',
  switch_node_id: 'switch-wifi',
  switch_route_id: 'lentidao_wifi',
  tool_name: null,
  insight: 'A rota lentidao_wifi esta com confianca media baixa.',
  evidence_json: {
    sampleSize: 5,
    averageConfidence: 0.52,
    exampleMessages: ['Meu wifi fica oscilando no quarto'],
  },
  suggested_fix_json: {
    action: 'rewrite_route_description_and_examples',
    reason: 'Exemplos insuficientes para diferenciar lentidao de sem conexao.',
  },
  impact_json: { affectedConversations: 5 },
  confidence: 0.83,
  status: 'approved',
};

const switchFlowGraph = {
  version: 1 as const,
  nodes: [
    {
      id: 'switch-wifi',
      kind: 'switch' as const,
      title: 'Tipo de Wi-Fi',
      subtitle: 'Roteia problemas de Wi-Fi',
      position: { x: 0, y: 0 },
      config: {
        instructions: 'Classifique o pedido do cliente sobre Wi-Fi.',
        confidenceThreshold: 0.75,
        fallbackRouteId: 'outro',
        routes: [
          {
            id: 'lentidao_wifi',
            label: 'Lentidao Wi-Fi',
            description: 'Cliente relata internet lenta.',
            examples: ['Meu Wi-Fi esta lento'],
            targetNodeId: 'diagnosticar-lentidao',
          },
          {
            id: 'outro',
            label: 'Outro',
            description: 'Nao ficou claro.',
            targetNodeId: 'perguntar-melhor',
          },
        ],
      },
    },
  ],
  edges: [],
};

const configRowWithSwitchGraph = {
  ...configRow,
  flow_graph: JSON.stringify(switchFlowGraph),
};

const baseDraftSnapshot = {
  name: 'Agente',
  gemini_api_key: null,
  ai_model: 'gemini-2.5-flash',
  transcription_model: null,
  knowledge_base: null,
  knowledge_base_documents: [{ id: 'doc-existing', name: 'FAQ', content: 'Base atual.' }],
  knowledge_collections: [{ id: 'general', name: 'Geral', isDefault: true }],
  is_active: true,
  is_private: false,
  default_fallback_reply: null,
  escalation_policy: null,
  closing_policy: null,
  enabled_tool_names: [],
  flow_graph: null,
};

function createRevertQueryMock(input: {
  config?: any;
  patternStatus?: string;
  application?: any;
  draftSnapshot?: any;
  updatedAt?: string;
}) {
  return vi.fn(async (query: string, params?: any[]) => {
    const sql = String(query);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('SELECT * FROM autopilot_configs')) return { rows: [input.config ?? configRow] };
    if (sql.includes('SELECT id, status') && sql.includes('FROM agent_causal_patterns')) {
      return { rows: [{ id: 'pattern-1', status: input.patternStatus ?? 'applied' }] };
    }
    if (sql.includes('FROM agent_causal_pattern_applications') && sql.includes("status = 'drafted'")) {
      return { rows: input.application ? [input.application] : [] };
    }
    if (sql.includes('SELECT snapshot FROM autopilot_config_drafts')) {
      return input.draftSnapshot ? { rows: [{ snapshot: input.draftSnapshot }] } : { rows: [] };
    }
    if (sql.includes('UPDATE autopilot_config_drafts')) {
      return { rows: [{ updated_at: input.updatedAt || '2026-06-15T20:30:00.000Z' }] };
    }
    if (sql.includes('UPDATE agent_causal_pattern_applications')) return { rowCount: 1, rows: [{ id: params?.[0] }] };
    if (sql.includes('UPDATE agent_causal_patterns')) return { rowCount: 1, rows: [{ id: params?.[0] }] };
    return { rows: [] };
  });
}

describe('autopilot causal pattern apply', () => {
  beforeEach(() => {
    vi.mocked(db.connect).mockReset();
    vi.mocked(db.query).mockReset();
  });

  it('builds an active operational learning document from an approved pattern', () => {
    const document = buildCausalPatternLearningDocument({
      pattern: approvedPattern,
      collections: [{ id: 'general', name: 'Geral' }],
      appliedAt: '2026-06-15T20:00:00.000Z',
    });

    expect(document).toMatchObject({
      id: 'autopilot-learning-pattern-1',
      status: 'active',
      contextRole: 'policy',
      category: 'agent_learning_policy',
      source: 'agent_causal_pattern',
      collectionIds: ['general'],
    });
    expect(document.content).toContain('collect-router-context');
    expect(document.canonicalAnswer).toContain('clarify_prompt_or_split_step');
  });

  it('builds an auditable graph patch for an approved switch route pattern', () => {
    const patch = buildSwitchPatternDraftGraphPatch(switchFlowGraph, switchPattern);

    expect(patch).toBeTruthy();
    expect(patch?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'update_switch_instructions',
        switchNodeId: 'switch-wifi',
      }),
      expect.objectContaining({
        type: 'update_switch_route_description',
        switchNodeId: 'switch-wifi',
        routeId: 'lentidao_wifi',
      }),
      expect.objectContaining({
        type: 'update_switch_route_examples',
        switchNodeId: 'switch-wifi',
        routeId: 'lentidao_wifi',
      }),
    ]));

    const switchNode = patch?.graph.nodes[0];
    const route = switchNode?.config?.routes?.find((item) => item.id === 'lentidao_wifi');
    expect(switchNode?.config?.instructions).toContain('Aprendizado aprovado');
    expect(route?.description).toContain('sinais claros');
    expect(route?.examples).toContain('Meu wifi fica oscilando no quarto');
  });

  it('previews the same switch graph patch without writing a draft', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [configRowWithSwitchGraph] } as any)
      .mockResolvedValueOnce({ rows: [switchPattern] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await previewCausalPatternDraftApplication({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-switch-1',
    });

    expect(result.preview).toMatchObject({
      applicationType: 'draft_switch_graph_patch',
      operation: 'upsert_knowledge_document_and_patch_switch_graph',
      patternId: 'pattern-switch-1',
      documentId: 'autopilot-learning-pattern-switch-1',
    });
    expect(result.preview?.graphPatchOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'update_switch_instructions' }),
      expect.objectContaining({ type: 'update_switch_route_description' }),
    ]));
    expect(db.connect).not.toHaveBeenCalled();
    expect(vi.mocked(db.query).mock.calls.some(([query]) => (
      String(query).includes('INSERT INTO autopilot_config_drafts')
    ))).toBe(false);
  });

  it('applies an approved pattern into the autopilot draft snapshot', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [approvedPattern] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: '2026-06-15T20:10:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'application-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'pattern-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applyCausalPatternToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      success: true,
      documentId: 'autopilot-learning-pattern-1',
      applicationId: 'application-1',
    });

    const draftCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO autopilot_config_drafts')
    ));
    expect(draftCall).toBeTruthy();
    const savedSnapshot = JSON.parse(String(draftCall?.[1]?.[3]));
    expect(savedSnapshot.knowledge_base_documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'doc-existing',
      }),
      expect.objectContaining({
        id: 'autopilot-learning-pattern-1',
        status: 'active',
        contextRole: 'policy',
      }),
    ]));

    const applicationCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_pattern_applications')
    ));
    expect(applicationCall?.[1]).toEqual(expect.arrayContaining([
      'workspace-1',
      'config-1',
      'pattern-1',
      'user-1',
      'draft_knowledge_policy',
    ]));
  });

  it('applies approved switch patterns as a graph patch plus learning document', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRowWithSwitchGraph] })
      .mockResolvedValueOnce({ rows: [switchPattern] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: '2026-06-15T20:10:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'application-switch-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'pattern-switch-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applyCausalPatternToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-switch-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      success: true,
      documentId: 'autopilot-learning-pattern-switch-1',
      applicationId: 'application-switch-1',
    });

    const draftCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO autopilot_config_drafts')
    ));
    const savedSnapshot = JSON.parse(String(draftCall?.[1]?.[3]));
    const savedSwitchNode = savedSnapshot.flow_graph.nodes[0];
    const savedRoute = savedSwitchNode.config.routes.find((item: any) => item.id === 'lentidao_wifi');
    expect(savedSwitchNode.config.instructions).toContain('baixa confianca media');
    expect(savedRoute.description).toContain('sinais claros');
    expect(savedRoute.examples).toContain('Meu wifi fica oscilando no quarto');

    const applicationCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_pattern_applications')
    ));
    expect(applicationCall?.[1]).toEqual(expect.arrayContaining([
      'workspace-1',
      'config-1',
      'pattern-switch-1',
      'user-1',
      'draft_switch_graph_patch',
    ]));
    const patchJson = JSON.parse(String(applicationCall?.[1]?.[7]));
    expect(patchJson.operation).toBe('upsert_knowledge_document_and_patch_switch_graph');
    expect(patchJson.graphPatch.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'update_switch_route_description' }),
    ]));
  });

  it('refuses to mark a switch pattern as applied when the graph cannot be patched', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [switchPattern] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applyCausalPatternToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-switch-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Switch');
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes('INSERT INTO agent_causal_pattern_applications')
    ))).toBe(false);
  });

  it('can apply a switch pattern as knowledge-only when graph patching is disabled', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [switchPattern] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: '2026-06-15T20:10:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'application-knowledge-only' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'pattern-switch-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applyCausalPatternToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-switch-1',
      userId: 'user-1',
      includeGraphPatch: false,
    });

    expect(result).toMatchObject({
      success: true,
      documentId: 'autopilot-learning-pattern-switch-1',
    });
    const draftCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO autopilot_config_drafts')
    ));
    const savedSnapshot = JSON.parse(String(draftCall?.[1]?.[3]));
    expect(savedSnapshot.flow_graph).toBeNull();

    const applicationCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_pattern_applications')
    ));
    expect(applicationCall?.[1]).toEqual(expect.arrayContaining([
      'draft_knowledge_policy',
    ]));
    const patchJson = JSON.parse(String(applicationCall?.[1]?.[7]));
    expect(patchJson.graphPatchIncluded).toBe(false);
    expect(patchJson.graphPatchSkipped).toBe(true);
  });

  it('classifies only approved high-confidence low-risk patterns as safe auto-tune eligible', () => {
    expect(isCausalPatternSafeAutoTuneEligible(approvedPattern)).toBe(true);
    expect(isCausalPatternSafeAutoTuneEligible(switchPattern)).toBe(true);
    expect(isCausalPatternSafeAutoTuneEligible({
      ...approvedPattern,
      status: 'pending',
    })).toBe(false);
    expect(isCausalPatternSafeAutoTuneEligible({
      ...approvedPattern,
      confidence: 0.7,
    })).toBe(false);
    expect(isCausalPatternSafeAutoTuneEligible({
      ...approvedPattern,
      pattern_type: 'tool_failure_hotspot',
      tool_name: 'reboot_router',
    })).toBe(false);
  });

  it('applies safe auto-tune patterns as knowledge-only draft updates', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [
        switchPattern,
        {
          ...approvedPattern,
          id: 'pattern-low-confidence',
          confidence: 0.6,
        },
      ],
    } as any);
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [switchPattern] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ updated_at: '2026-06-15T20:10:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'application-auto-tune' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'pattern-switch-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applySafeCausalPatternAutoTuneToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      success: true,
      appliedCount: 1,
      skippedCount: 1,
      appliedPatternIds: ['pattern-switch-1'],
    });
    const applicationCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('INSERT INTO agent_causal_pattern_applications')
    ));
    expect(applicationCall?.[1]).toEqual(expect.arrayContaining([
      'draft_knowledge_policy',
    ]));
    const patchJson = JSON.parse(String(applicationCall?.[1]?.[7]));
    expect(patchJson.graphPatchIncluded).toBe(false);
    const patternUpdateCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('UPDATE agent_causal_patterns')
    ));
    const reviewMetadata = JSON.parse(String(patternUpdateCall?.[1]?.[3]));
    expect(reviewMetadata).toMatchObject({
      decision: 'safe_auto_tune_applied',
      applicationSource: 'safe_auto_tune',
    });
  });

  it('reverts a drafted knowledge-only application back to the previous snapshot', async () => {
    const applicationPlan = buildCausalPatternDraftApplicationPlan({
      currentSnapshot: baseDraftSnapshot,
      pattern: approvedPattern,
      appliedAt: '2026-06-15T20:00:00.000Z',
    });
    expect(applicationPlan.plan).toBeTruthy();
    const plan = applicationPlan.plan!;
    const client = createClientMock();
    client.query = createRevertQueryMock({
      application: {
        id: 'application-1',
        application_type: 'draft_knowledge_policy',
        status: 'drafted',
        before_snapshot_hash: plan.beforeSnapshotHash,
        after_snapshot_hash: plan.afterSnapshotHash,
        patch_json: plan.patchJson,
      },
      draftSnapshot: plan.nextSnapshot,
    });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await revertCausalPatternDraftApplication({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      success: true,
      applicationId: 'application-1',
    });
    const draftCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('UPDATE autopilot_config_drafts')
    ));
    const savedSnapshot = JSON.parse(String(draftCall?.[1]?.[3]));
    expect(savedSnapshot.knowledge_base_documents).toEqual([
      expect.objectContaining({ id: 'doc-existing' }),
    ]);
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes("status = 'reverted'")
    ))).toBe(true);
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes("SET status = 'approved'")
    ))).toBe(true);
  });

  it('reverts switch graph patches plus their learning document', async () => {
    const switchSnapshot = {
      ...baseDraftSnapshot,
      flow_graph: switchFlowGraph,
    };
    const applicationPlan = buildCausalPatternDraftApplicationPlan({
      currentSnapshot: switchSnapshot,
      pattern: switchPattern,
      appliedAt: '2026-06-15T20:00:00.000Z',
    });
    expect(applicationPlan.plan).toBeTruthy();
    const plan = applicationPlan.plan!;
    const client = createClientMock();
    client.query = createRevertQueryMock({
      config: configRowWithSwitchGraph,
      application: {
        id: 'application-switch-1',
        application_type: 'draft_switch_graph_patch',
        status: 'drafted',
        before_snapshot_hash: plan.beforeSnapshotHash,
        after_snapshot_hash: plan.afterSnapshotHash,
        patch_json: plan.patchJson,
      },
      draftSnapshot: plan.nextSnapshot,
    });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await revertCausalPatternDraftApplication({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-switch-1',
      userId: 'user-1',
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    const draftCall = client.query.mock.calls.find(([query]) => (
      String(query).includes('UPDATE autopilot_config_drafts')
    ));
    const savedSnapshot = JSON.parse(String(draftCall?.[1]?.[3]));
    expect(savedSnapshot.knowledge_base_documents).toEqual([
      expect.objectContaining({ id: 'doc-existing' }),
    ]);
    expect(savedSnapshot.flow_graph).toEqual(switchFlowGraph);
  });

  it('marks the application as conflicted when the draft changed after applying', async () => {
    const applicationPlan = buildCausalPatternDraftApplicationPlan({
      currentSnapshot: baseDraftSnapshot,
      pattern: approvedPattern,
      appliedAt: '2026-06-15T20:00:00.000Z',
    });
    expect(applicationPlan.plan).toBeTruthy();
    const plan = applicationPlan.plan!;
    const client = createClientMock();
    client.query = createRevertQueryMock({
      application: {
        id: 'application-1',
        application_type: 'draft_knowledge_policy',
        status: 'drafted',
        before_snapshot_hash: plan.beforeSnapshotHash,
        after_snapshot_hash: plan.afterSnapshotHash,
        patch_json: plan.patchJson,
      },
      draftSnapshot: {
        ...plan.nextSnapshot,
        knowledge_base_documents: [
          ...(plan.nextSnapshot.knowledge_base_documents || []),
          { id: 'manual-doc', name: 'Manual', content: 'Edicao humana depois da aplicacao.' },
        ],
      },
    });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await revertCausalPatternDraftApplication({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('rascunho mudou');
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes("status = 'conflicted'")
    ))).toBe(true);
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes('UPDATE autopilot_config_drafts')
    ))).toBe(false);
  });

  it('marks drafted causal pattern applications as published with version metadata', async () => {
    const client = createClientMock();
    client.query.mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const result = await markDraftCausalPatternApplicationsPublished(client, {
      workspaceId: 'workspace-1',
      configId: 'config-1',
      userId: 'user-1',
      versionNumber: 7,
    });

    expect(result).toEqual({ publishedCount: 2 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'published'"),
      expect.arrayContaining(['workspace-1', 'config-1']),
    );
    const params = client.query.mock.calls[0][1];
    const publicationPatch = JSON.parse(String(params?.[2]));
    expect(publicationPatch.publication).toMatchObject({
      publishedByUserId: 'user-1',
      versionNumber: 7,
    });
  });

  it('marks drafted applications as reverted when the draft is discarded', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { pattern_id: 'pattern-1' },
          { pattern_id: 'pattern-2' },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });

    const result = await markDraftCausalPatternApplicationsDiscarded(client, {
      workspaceId: 'workspace-1',
      configId: 'config-1',
      userId: 'user-1',
      reason: 'draft_discarded',
    });

    expect(result).toEqual({ revertedCount: 2 });
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("SET status = 'reverted'"),
      expect.arrayContaining(['workspace-1', 'config-1']),
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("SET status = 'approved'"),
      expect.arrayContaining(['workspace-1', ['pattern-1', 'pattern-2']]),
    );
    const applicationPatch = JSON.parse(String(client.query.mock.calls[0][1]?.[2]));
    expect(applicationPatch.rollback).toMatchObject({
      revertedByUserId: 'user-1',
      reason: 'draft_discarded',
    });
  });

  it('refuses to apply a pattern that was not approved', async () => {
    const client = createClientMock();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [configRow] })
      .mockResolvedValueOnce({ rows: [{ ...approvedPattern, status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(db.connect).mockResolvedValueOnce(client as any);

    const result = await applyCausalPatternToDraft({
      workspaceId: 'workspace-1',
      configId: 'config-1',
      patternId: 'pattern-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('aprovada');
    expect(client.query.mock.calls.some(([query]) => (
      String(query).includes('INSERT INTO autopilot_config_drafts')
    ))).toBe(false);
  });
});
