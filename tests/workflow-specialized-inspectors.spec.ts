import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  guidedDurationToMs,
  guidedFieldsToSchema,
  guidedRecordEntriesToRecord,
  hasSpecializedWorkflowInspector,
  NativeSpecializedNodeInspector,
  schemaToGuidedFields,
  SPECIALIZED_WORKFLOW_INSPECTOR_TYPES,
  splitRecordForGuidedEditing,
  timeoutMsToGuidedDuration,
} from '@/components/workflow/native-specialized-inspectors';
import {
  createWorkflowNode,
  listStableWorkflowNodeManifests,
} from '@/services/workflow-runtime/catalog';

describe('native specialized inspectors', () => {
  it('covers every stable node that does not use the dedicated AI agent editor', () => {
    const expected = listStableWorkflowNodeManifests()
      .map((manifest) => manifest.type)
      .filter((type) => !['ai.agent', 'ai.published_agent', 'ai.studio_agent', 'integration.studio_procedure', 'tool.studio_agent', 'tool.studio_procedure'].includes(type))
      .sort();

    expect([...SPECIALIZED_WORKFLOW_INSPECTOR_TYPES].sort()).toEqual(expected);
  });

  it('only advertises stable workflow node types', () => {
    const stable = new Set(listStableWorkflowNodeManifests().map((manifest) => manifest.type));
    for (const type of SPECIALIZED_WORKFLOW_INSPECTOR_TYPES) {
      expect(stable.has(type), type).toBe(true);
      expect(hasSpecializedWorkflowInspector(type)).toBe(true);
    }
    expect(hasSpecializedWorkflowInspector('ai.supervisor')).toBe(false);
  });

  it('routes every advertised type to a concrete guided inspector', () => {
    for (const type of SPECIALIZED_WORKFLOW_INSPECTOR_TYPES) {
      const node = createWorkflowNode(type, {
        id: `node-${type}`,
        position: { x: 0, y: 0 },
      });
      const inspector = NativeSpecializedNodeInspector({
        node,
        onUpdate: () => undefined,
      });
      expect(inspector, type).not.toBeNull();
    }

    const hiddenNode = createWorkflowNode('ai.supervisor', {
      id: 'hidden-supervisor',
      position: { x: 0, y: 0 },
    });
    expect(NativeSpecializedNodeInspector({ node: hiddenNode, onUpdate: () => undefined })).toBeNull();
  });

  it('round-trips primitive records while preserving advanced values', () => {
    const source = {
      customer_name: '{{current.name}}',
      attempts: 2,
      active: true,
      advanced: { keep: 'unchanged' },
    };
    const split = splitRecordForGuidedEditing(source);

    expect(split.entries).toEqual([
      { key: 'customer_name', value: '{{current.name}}', kind: 'text' },
      { key: 'attempts', value: '2', kind: 'number' },
      { key: 'active', value: 'true', kind: 'boolean' },
    ]);
    expect(guidedRecordEntriesToRecord(split.entries, split.preserved)).toEqual(source);
  });

  it('edits schemas through fields without discarding advanced constraints', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: 'string', description: 'E-mail do cliente', format: 'email' },
      },
      required: ['email'],
    };
    const fields = schemaToGuidedFields(schema);
    expect(fields).toEqual([{ name: 'email', type: 'string', description: 'E-mail do cliente', required: true }]);

    const updated = guidedFieldsToSchema([
      ...fields,
      { name: 'score', type: 'number', description: 'Confiança', required: false },
    ], schema);
    expect(updated).toMatchObject({
      additionalProperties: false,
      required: ['email'],
      properties: {
        email: { type: 'string', description: 'E-mail do cliente', format: 'email' },
        score: { type: 'number', description: 'Confiança' },
      },
    });
  });

  it('converts wait durations using friendly units', () => {
    expect(timeoutMsToGuidedDuration(7_200_000)).toEqual({ value: 2, unit: 'hours' });
    expect(guidedDurationToMs(3, 'days')).toBe(259_200_000);
  });

  it('renders native workspace choices instead of raw Dialogy UUID fields', () => {
    const team = createWorkflowNode('dialogy.team_availability', {
      id: 'availability',
      position: { x: 0, y: 0 },
      config: { teamId: 'team-commercial' },
    });
    const close = createWorkflowNode('output.close_conversation', {
      id: 'close',
      position: { x: 0, y: 0 },
      config: { reasonTagId: 'tag-close' },
    });
    const trigger = createWorkflowNode('trigger.received_message', {
      id: 'trigger',
      position: { x: 0, y: 0 },
      config: { platforms: ['whatsapp'], instanceNames: ['zap1'], startPolicy: 'unassigned_only' },
    });
    const common = {
      onUpdate: () => undefined,
      teamOptions: [{ id: 'team-commercial', label: 'Comercial' }],
      tagOptions: [
        { id: 'tag-commercial', label: 'Comercial', isCloseReason: false },
        { id: 'tag-close', label: 'Sistema', isCloseReason: true },
      ],
      instanceOptions: [{ id: 'zap1', label: 'zap1' }],
    };

    const teamMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: team, ...common }) as ReactElement);
    const closeMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: close, ...common }) as ReactElement);
    const triggerMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: trigger, ...common }) as ReactElement);

    expect(teamMarkup).toContain('Comercial');
    expect(teamMarkup).not.toContain('UUID');
    expect(closeMarkup).toContain('Sistema');
    expect(closeMarkup).not.toContain('tag-commercial');
    expect(triggerMarkup).toContain('WhatsApp');
    expect(triggerMarkup).toContain('zap1');
    expect(triggerMarkup).toContain('Somente atendimento sem responsável');
  });

  it('selects published subflows and maps their input without raw workflow ids', () => {
    const subflow = createWorkflowNode('logic.subflow', {
      id: 'subflow-node',
      position: { x: 0, y: 0 },
      config: {
        workflowId: 'workflow-cadastro',
        inputMapping: { cpf: '{{variables.cpf}}' },
        inputSchema: {},
        outputSchema: {},
      },
    });

    const markup = renderToStaticMarkup(NativeSpecializedNodeInspector({
      node: subflow,
      onUpdate: () => undefined,
      workflowOptions: [{ id: 'workflow-cadastro', label: 'Consultar cadastro', description: 'Publicado · v3' }],
    }) as ReactElement);

    expect(markup).toContain('Consultar cadastro');
    expect(markup).toContain('Publicado · v3');
    expect(markup).toContain('Campo no subfluxo');
    expect(markup).toContain('{{variables.cpf}}');
    expect(markup).not.toContain('ID do workflow');
  });

  it('keeps message triggers and option fallbacks simple by default', () => {
    const trigger = createWorkflowNode('trigger.received_message', {
      id: 'trigger-friendly',
      position: { x: 0, y: 0 },
      config: { matchMode: 'any_keyword', keywords: ['boleto', 'quero assinar internet'] },
    });
    const options = createWorkflowNode('interaction.options', {
      id: 'options-friendly',
      position: { x: 0, y: 0 },
      config: {
        prompt: 'Escolha:',
        options: [{ id: 'one', value: 'Primeira', label: 'Primeira' }],
        customFallbackRoutes: false,
      },
    });
    const common = { onUpdate: () => undefined };
    const triggerMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: trigger, editorMode: 'essential', ...common }) as ReactElement);
    const simpleOptionsMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: options, editorMode: 'essential', ...common }) as ReactElement);
    const advancedOptionsMarkup = renderToStaticMarkup(NativeSpecializedNodeInspector({ node: options, editorMode: 'advanced', ...common }) as ReactElement);

    expect(triggerMarkup).toContain('Qualquer mensagem recebida');
    expect(triggerMarkup).toContain('Palavras ou frases de gatilho');
    expect(triggerMarkup).toContain('quero assinar internet');
    expect(triggerMarkup).toContain('Gatilhos específicos são avaliados antes');
    expect(simpleOptionsMarkup).toContain('apresenta este menu novamente automaticamente');
    expect(simpleOptionsMarkup).not.toContain('Controlar resposta não reconhecida manualmente');
    expect(advancedOptionsMarkup).toContain('Controlar resposta não reconhecida manualmente');
  });
});
