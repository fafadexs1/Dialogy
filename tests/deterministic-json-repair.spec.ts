import { describe, expect, it } from 'vitest';
import { deterministicJsonRepair, parseLmStudioStructuredText } from '@/services/ai/lm-studio';
import { ProcedureStepSchema } from '@/services/agent-studio/types';

describe('Deterministic JSON Repair & Schema Resilience', () => {
  it('repairs trailing commas without AI calls', () => {
    const malformed = '{\n  "thought": "analisando",\n  "response": "Olá!",\n}';
    expect(parseLmStudioStructuredText(malformed)).toEqual({
      thought: 'analisando',
      response: 'Olá!',
    });
  });

  it('repairs unquoted keys and single quotes without AI calls', () => {
    const malformed = "{\n  thought: 'analisando',\n  response: 'Olá mundo',\n  status: 'active'\n}";
    expect(parseLmStudioStructuredText(malformed)).toEqual({
      thought: 'analisando',
      response: 'Olá mundo',
      status: 'active',
    });
  });

  it('repairs markdown fenced json with comments', () => {
    const malformed = "```json\n{\n  // nota interna\n  \"thought\": \"ok\",\n  /* bloco */\n  \"response\": \"Tudo certo\"\n}\n```";
    expect(parseLmStudioStructuredText(malformed)).toEqual({
      thought: 'ok',
      response: 'Tudo certo',
    });
  });

  it('repairs truncated json with missing closing braces', () => {
    const malformed = '{\n  "thought": "analisando",\n  "response": "Olá",\n  "actions": [\n    {"type": "tag"';
    const result = parseLmStudioStructuredText(malformed);
    expect(result).toMatchObject({
      thought: 'analisando',
      response: 'Olá',
      actions: [{ type: 'tag' }],
    });
  });

  it('allows any string as nativeActionType in ProcedureStepSchema so it never throws on unknown action types', () => {
    const step = {
      id: 'step_1',
      order: 1,
      type: 'native_action',
      title: 'Ação customizada',
      nativeActionType: 'sgp_fetch_contracts',
    };

    const parsed = ProcedureStepSchema.safeParse(step);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nativeActionType).toBe('sgp_fetch_contracts');
    }
  });

  it('allows future/unknown nativeActionType strings without crashing', () => {
    const step = {
      id: 'step_2',
      order: 2,
      type: 'native_action',
      title: 'Ação futura',
      nativeActionType: 'future_custom_action_123',
    };

    const parsed = ProcedureStepSchema.safeParse(step);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nativeActionType).toBe('future_custom_action_123');
    }
  });
});
