import { describe, expect, it } from 'vitest';

import {
  InMemoryWorkflowPersistence,
  WorkflowExecutor,
  createDefaultNodeHandlerRegistry,
  matchWorkflowOptionByHeuristics,
} from '@/services/workflow-runtime';
import { connect, workflowDefinition, workflowNode } from './workflow-runtime-fixtures';

function runtime() {
  const persistence = new InMemoryWorkflowPersistence();
  const deliveries: Array<Record<string, unknown>> = [];
  const handlers = createDefaultNodeHandlerRegistry({
    sendResponse: async (message) => {
      deliveries.push({ kind: 'text', message });
      return { success: true, delivered: true };
    },
    sendMedia: async (media) => {
      deliveries.push({ kind: 'media', ...media });
      return { success: true, delivered: true };
    },
  });
  return { persistence, deliveries, executor: new WorkflowExecutor(persistence, handlers) };
}

function errorPath() {
  const handler = workflowNode('error.handler', 'error', { mode: 'fail' });
  const end = workflowNode('output.end', 'error-end');
  return { handler, end, connection: connect(handler, 'failed', end, 'main') };
}

describe('Nexus operational blocks', () => {
  it('preserves typed legacy condition semantics for numbers, booleans and Brazilian dates', async () => {
    const scenarios = [
      { left: '10.5', right: '9.9', dataType: 'number', operator: 'greater_than' },
      { left: 'true', right: '', dataType: 'boolean', operator: 'is_true' },
      { left: '26/08/2026', right: '25/08/2026', dataType: 'date', operator: 'date_after' },
      { left: 'Oferta Especial', right: 'oferta', dataType: 'string', operator: 'starts_with' },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const trigger = workflowNode('trigger.manual', `trigger-${index}`);
      const condition = workflowNode('logic.if', `condition-${index}`, scenario);
      const matchedEnd = workflowNode('output.end', `matched-${index}`);
      const unmatchedEnd = workflowNode('output.end', `unmatched-${index}`);
      const workflow = workflowDefinition(
        [trigger, condition, matchedEnd, unmatchedEnd],
        [
          connect(trigger, 'started', condition, 'main'),
          connect(condition, 'true', matchedEnd, 'main'),
          connect(condition, 'false', unmatchedEnd, 'main'),
        ],
        { id: `typed-condition-${index}` },
      );
      const { executor } = runtime();
      const execution = await executor.start({ workflow, input: {} });
      expect(execution.previousNodeId).toBe(matchedEnd.id);
    }
  });

  it('executes the exact phrase output selected by an imported trigger', async () => {
    const trigger = workflowNode('trigger.received_message', 'trigger', { defaultOutput: 'fallback' });
    trigger.outputPorts = [
      { id: 'fallback', label: 'Qualquer mensagem', direction: 'output', connectionType: 'main', required: false, multiple: false },
      { id: 'plano_site', label: '600 MEGA + Site', direction: 'output', connectionType: 'main', required: false, multiple: false },
    ];
    const fallbackEnd = workflowNode('output.end', 'fallback-end');
    const siteEnd = workflowNode('output.end', 'site-end');
    const workflow = workflowDefinition(
      [trigger, fallbackEnd, siteEnd],
      [
        connect(trigger, 'fallback', fallbackEnd, 'main'),
        connect(trigger, 'plano_site', siteEnd, 'main'),
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: { message: '600 MEGA + Site' }, context: { triggerOutput: 'plano_site' } });
    expect(execution.status).toBe('completed');
    expect(execution.previousNodeId).toBe('site-end');
    expect(execution.nodeResults.trigger?.selectedOutput).toBe('plano_site');
  });

  it('starts a multi-trigger workflow from the explicitly requested trigger', async () => {
    const messageTrigger = workflowNode('trigger.received_message', 'message-trigger');
    const manualTrigger = workflowNode('trigger.manual', 'manual-trigger');
    const messageEnd = workflowNode('output.end', 'message-end');
    const manualEnd = workflowNode('output.end', 'manual-end');
    const workflow = workflowDefinition(
      [messageTrigger, manualTrigger, messageEnd, manualEnd],
      [
        connect(messageTrigger, 'message', messageEnd, 'main'),
        connect(manualTrigger, 'started', manualEnd, 'main'),
      ],
      { metadata: { allowMultipleTriggers: true } },
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, triggerNodeId: manualTrigger.id, input: {} });
    expect(execution.status).toBe('completed');
    expect(execution.previousNodeId).toBe(manualEnd.id);
    expect(execution.executionPath[0]?.nodeId).toBe(manualTrigger.id);
  });

  it('executes imported JSONata transformations and persists scalar results', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const transform = workflowNode('data.transform', 'transform', {
      mode: 'jsonata',
      source: '{{input.payload}}',
      expression: '$sum(orders.price)',
      outputKey: 'total',
      evaluationTimeoutMs: 250,
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, transform, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', transform, 'main'),
        connect(transform, 'success', end, 'main'),
        connect(transform, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: { payload: { orders: [{ price: 4 }, { price: 7 }] } } });
    expect(execution.status).toBe('completed');
    expect(execution.variables.total).toBe(11);
    expect(execution.nodeResults.transform?.output).toEqual({ value: 11 });
  });

  it('executes isolated synchronous JavaScript and saves its result', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const code = workflowNode('data.code', 'code', {
      language: 'javascript',
      source: 'return { total: Number(input.a) + Number(input.b) };',
      outputKey: 'calculation',
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, code, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', code, 'main'),
        connect(code, 'success', end, 'main'),
        connect(code, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: { a: 2, b: 3 } });
    expect(execution.status).toBe('completed');
    expect(execution.variables.calculation).toEqual({ total: 5 });
  });

  it('enforces the declared total timeout of a controlled loop', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const loop = workflowNode('logic.loop', 'loop', {
      maxIterations: 100,
      exitCondition: 'false',
      totalTimeoutMs: 1_000,
    });
    const iterateEnd = workflowNode('output.end', 'iterate-end');
    const doneEnd = workflowNode('output.end', 'done-end');
    const limitEnd = workflowNode('output.end', 'limit-end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, loop, iterateEnd, doneEnd, limitEnd, errors.handler, errors.end],
      [
        connect(trigger, 'started', loop, 'main'),
        connect(loop, 'iterate', iterateEnd, 'main'),
        connect(loop, 'done', doneEnd, 'main'),
        connect(loop, 'limit_reached', limitEnd, 'main'),
        connect(loop, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({
      workflow,
      input: {},
      variables: { __loops: { loop: { count: 2, startedAt: new Date(Date.now() - 10_000).toISOString() } } },
    });
    expect(execution.status).toBe('completed');
    expect(execution.executionPath.map((step) => step.nodeId)).toContain('limit-end');
    expect(execution.nodeResults.loop?.output).toMatchObject({ reason: 'total_timeout', iterations: 2 });
  });

  it('blocks string code generation inside the JavaScript sandbox', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const code = workflowNode('data.code', 'code', {
      language: 'javascript',
      source: 'return Function("return process")();',
      outputKey: 'result',
      customErrorRoute: true,
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, code, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', code, 'main'),
        connect(code, 'success', end, 'main'),
        connect(code, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.nodeResults.code?.status).toBe('error');
    expect(execution.executionPath.map((step) => step.nodeId)).toContain('error');
  });

  it('continues an imported legacy step after failure and stores the error in its output variable', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const code = workflowNode('data.code', 'legacy-code', {
      language: 'javascript',
      source: 'throw new Error("falha legada");',
      outputKey: 'legacy.result',
      continueOnError: true,
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, code, end],
      [
        connect(trigger, 'started', code, 'main'),
        connect(code, 'success', end, 'main'),
      ],
    );
    const { executor } = runtime();
    const execution = await executor.start({ workflow, input: {} });

    expect(execution.status).toBe('completed');
    expect(execution.previousNodeId).toBe(end.id);
    expect(execution.variables.legacy).toMatchObject({
      result: { error: expect.stringContaining('falha legada'), code: 'NODE_EXECUTION_FAILED' },
    });
    expect(execution.nodeResults[code.id]).toMatchObject({
      status: 'route',
      selectedOutput: 'success',
      output: { continuedAfterError: true },
      error: { code: 'NODE_EXECUTION_FAILED' },
    });
  });

  it('waits for a typed answer, stores it and resumes the flow', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const input = workflowNode('interaction.input', 'ask', {
      prompt: 'Qual seu e-mail?',
      outputKey: 'email',
      validation: 'email',
      timeoutMs: 86_400_000,
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, input, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', input, 'main'),
        connect(input, 'resumed', end, 'main'),
        connect(input, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor, deliveries } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    expect(waiting.status).toBe('waiting');
    expect(deliveries[0]).toMatchObject({ kind: 'text', message: 'Qual seu e-mail?' });
    const completed = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'cliente@example.com' } });
    expect(completed.status).toBe('completed');
    expect(completed.variables.email).toBe('cliente@example.com');
  });

  it('routes an option response through its dedicated output', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const choice = workflowNode('interaction.options', 'choice', {
      prompt: 'Escolha:',
      outputKey: 'plan',
      options: [{ id: 'pro', value: 'Plano Pro', label: 'Mais recursos' }],
      timeoutMs: 86_400_000,
    });
    choice.outputPorts.unshift({ id: 'pro', label: 'Plano Pro', direction: 'output', connectionType: 'main', required: true, multiple: false });
    const proEnd = workflowNode('output.end', 'pro-end');
    const defaultEnd = workflowNode('output.end', 'default-end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, choice, proEnd, defaultEnd, errors.handler, errors.end],
      [
        connect(trigger, 'started', choice, 'main'),
        connect(choice, 'pro', proEnd, 'main'),
        connect(choice, 'default', defaultEnd, 'main'),
        connect(choice, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const completed = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: '1' } });
    expect(completed.previousNodeId).toBe('pro-end');
    expect(completed.variables.plan).toBe('Plano Pro');
  });

  it('repeats an options interaction automatically when the answer is not recognized', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const choice = workflowNode('interaction.options', 'choice', {
      prompt: 'Escolha:',
      outputKey: 'plan',
      options: [{ id: 'pro', value: 'Plano Pro', label: 'Mais recursos' }],
      timeoutMs: 86_400_000,
      customFallbackRoutes: false,
      invalidOptionMessage: 'Opção inválida. Tente novamente.',
    });
    choice.outputPorts.unshift({ id: 'pro', label: 'Plano Pro', direction: 'output', connectionType: 'main', required: true, multiple: false });
    const proEnd = workflowNode('output.end', 'pro-end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, choice, proEnd, errors.handler, errors.end],
      [
        connect(trigger, 'started', choice, 'main'),
        connect(choice, 'pro', proEnd, 'main'),
        connect(choice, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor, deliveries } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const repeated = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'algo diferente' } });

    expect(repeated.status).toBe('waiting');
    expect(repeated.currentNodeId).toBe('choice');
    expect(repeated.variables.plan).toBeUndefined();
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toMatchObject({
      kind: 'text',
      message: expect.stringContaining('Opção inválida. Tente novamente.'),
    });

    const completed = await executor.resume({ resumeToken: repeated.resumeToken!, input: { value: '1' } });
    expect(completed.status).toBe('completed');
    expect(completed.variables.plan).toBe('Plano Pro');
  });

  it('repeats validated interactions automatically while the custom error path is disabled', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const question = workflowNode('interaction.input', 'email-question', {
      prompt: 'Qual é o seu e-mail?',
      outputKey: 'email',
      validation: 'email',
      invalidInputMessage: 'Esse e-mail não é válido. Tente novamente.',
      timeoutMs: 86_400_000,
      customErrorRoute: false,
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, question, end],
      [
        connect(trigger, 'started', question, 'main'),
        connect(question, 'resumed', end, 'main'),
      ],
    );
    const { executor, deliveries } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const repeated = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'email inválido' } });

    expect(repeated.status).toBe('waiting');
    expect(repeated.currentNodeId).toBe(question.id);
    expect(repeated.variables.email).toBeUndefined();
    expect(repeated.resumeToken).not.toBe(waiting.resumeToken);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toMatchObject({
      kind: 'text',
      message: expect.stringContaining('Esse e-mail não é válido. Tente novamente.'),
    });

    const completed = await executor.resume({ resumeToken: repeated.resumeToken!, input: { value: 'cliente@velpro.com.br' } });
    expect(completed.status).toBe('completed');
    expect(completed.variables.email).toBe('cliente@velpro.com.br');
  });

  it('uses the explicit error route when an advanced user enables it on an interaction', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const question = workflowNode('interaction.input', 'email-question', {
      prompt: 'Qual é o seu e-mail?',
      outputKey: 'email',
      validation: 'email',
      timeoutMs: 86_400_000,
      customErrorRoute: true,
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, question, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', question, 'main'),
        connect(question, 'resumed', end, 'main'),
        connect(question, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor, deliveries } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const completed = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'email inválido' } });

    expect(completed.status).toBe('completed');
    expect(completed.previousNodeId).toBe(errors.end.id);
    expect(completed.context.__interactionError).toBe('O e-mail informado é inválido.');
    expect(completed.variables.email).toBeUndefined();
    expect(deliveries).toHaveLength(1);
  });

  it('extracts the configured value from a legacy API response before saving it', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const question = workflowNode('interaction.input', 'callback-question', {
      prompt: 'Aguardando retorno do provedor',
      outputKey: 'provider.email',
      validation: 'email',
      legacyApiResponseAsInput: true,
      legacyApiResponsePathForValue: 'data.customer.email',
      timeoutMs: 86_400_000,
    });
    const end = workflowNode('output.end', 'end');
    const workflow = workflowDefinition(
      [trigger, question, end],
      [
        connect(trigger, 'started', question, 'main'),
        connect(question, 'resumed', end, 'main'),
      ],
    );
    const { executor } = runtime();
    const waiting = await executor.start({ workflow, input: {} });
    const completed = await executor.resume({
      resumeToken: waiting.resumeToken!,
      input: { value: { data: { customer: { email: 'api@velpro.com.br' } } } },
    });

    expect(completed.status).toBe('completed');
    expect(completed.variables.provider).toEqual({ email: 'api@velpro.com.br' });
  });

  it('recognizes legacy option variations without invoking a model', () => {
    const options = [
      { id: 'invoice', value: '2ª via da fatura', label: 'Segunda via' },
      { id: 'support', value: 'Suporte técnico', label: 'Problemas de internet' },
    ];
    expect(matchWorkflowOptionByHeuristics(options, '#1')).toMatchObject({ id: 'invoice', strategy: 'number' });
    expect(matchWorkflowOptionByHeuristics(options, 'opção 2')).toMatchObject({ id: 'support', strategy: 'number' });
    expect(matchWorkflowOptionByHeuristics(options, 'segunda vía')).toMatchObject({ id: 'invoice', strategy: 'exact' });
    expect(matchWorkflowOptionByHeuristics(options, 'preciso de suporte técnico agora')).toMatchObject({ id: 'support', strategy: 'contains' });
  });

  it('uses the native Dialogy classifier only after deterministic option matching fails', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const choice = workflowNode('interaction.options', 'choice', {
      prompt: 'Qual plano combina mais com você?',
      outputKey: 'plan',
      options: [
        { id: 'basic', value: 'Plano Básico', label: 'Uso leve' },
        { id: 'pro', value: 'Plano Pro', label: 'Jogos e muitos dispositivos' },
      ],
      timeoutMs: 86_400_000,
      customFallbackRoutes: false,
      intelligentMatching: true,
      intelligentMinimumConfidence: 0.7,
    });
    choice.outputPorts.unshift(
      { id: 'basic', label: 'Plano Básico', direction: 'output', connectionType: 'main', required: true, multiple: false },
      { id: 'pro', label: 'Plano Pro', direction: 'output', connectionType: 'main', required: true, multiple: false },
    );
    const basicEnd = workflowNode('output.end', 'basic-end');
    const proEnd = workflowNode('output.end', 'pro-end');
    const workflow = workflowDefinition(
      [trigger, choice, basicEnd, proEnd],
      [
        connect(trigger, 'started', choice, 'main'),
        connect(choice, 'basic', basicEnd, 'main'),
        connect(choice, 'pro', proEnd, 'main'),
      ],
    );
    const classifications: string[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({ sendResponse: async () => ({ success: true }) }),
      {
        classifyInteractionOption: async (input) => {
          classifications.push(input.message);
          expect(input.options.map((option) => option.id)).toEqual(['basic', 'pro']);
          return { optionId: 'pro', confidence: 0.92, model: 'dialogy/default', modelCalls: 1 };
        },
      },
    );
    const waiting = await executor.start({ workflow, input: {} });
    const completed = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: 'quero jogar sem travar em vários aparelhos' } });
    expect(completed.status).toBe('completed');
    expect(completed.previousNodeId).toBe('pro-end');
    expect(completed.variables.plan).toBe('Plano Pro');
    expect(completed.totalModelCalls).toBe(1);
    expect(completed.context.__interactionClassification).toMatchObject({ optionId: 'pro', confidence: 0.92 });
    expect(classifications).toEqual(['quero jogar sem travar em vários aparelhos']);
  });

  it('delivers media and returns a redirect as a terminal output', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const media = workflowNode('output.media', 'media', { mediaType: 'image', url: 'https://example.com/image.png', caption: 'Imagem' });
    const redirect = workflowNode('output.redirect', 'redirect', { url: 'https://example.com/{{input.slug}}' });
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, media, redirect, errors.handler, errors.end],
      [
        connect(trigger, 'started', media, 'main'),
        connect(media, 'success', redirect, 'main'),
        connect(media, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const { executor, deliveries } = runtime();
    const execution = await executor.start({ workflow, input: { slug: 'ok' } });
    expect(deliveries[0]).toMatchObject({ kind: 'media', type: 'image' });
    expect(execution.nodeResults.redirect?.output?.redirectUrl).toBe('https://example.com/ok');
  });

  it('resumes a durable multi-stage Dialogy block by executing the same node again', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const sgp = workflowNode('dialogy.sgp_contract_status', 'sgp', {
      outputKey: 'contractStatus',
      timeoutMs: 86_400_000,
      permissionScope: 'sgp:read',
    });
    const activeEnd = workflowNode('output.end', 'active-end');
    const suspendedEnd = workflowNode('output.end', 'suspended-end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, sgp, activeEnd, suspendedEnd, errors.handler, errors.end],
      [
        connect(trigger, 'started', sgp, 'main'),
        connect(sgp, 'active', activeEnd, 'main'),
        connect(sgp, 'suspended', suspendedEnd, 'main'),
        connect(sgp, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const persistence = new InMemoryWorkflowPersistence();
    const handlers = createDefaultNodeHandlerRegistry({
      executePlatformAction: async (runtimeInput) => {
        const resume = runtimeInput.input.resume as Record<string, unknown> | undefined;
        if (!resume) {
          return {
            status: 'waiting',
            waitingReason: 'time',
            resumeToken: 'resume-sgp-test',
            output: {
              resumeMode: 'reexecute',
              expirationOutput: 'error',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
            statePatch: { __journey: { stage: 'contract' } },
          };
        }
        expect(runtimeInput.execution.variables.__journey).toEqual({ stage: 'contract' });
        expect(resume.value).toBe('1');
        return {
          status: 'route',
          selectedOutput: 'active',
          output: { status: 'ativo' },
          statePatch: { contractStatus: 'ativo' },
        };
      },
    });
    const executor = new WorkflowExecutor(persistence, handlers);
    const waiting = await executor.start({ workflow, input: {} });
    expect(waiting.status).toBe('waiting');
    const completed = await executor.resume({ resumeToken: waiting.resumeToken!, input: { value: '1' } });
    expect(completed.status).toBe('completed');
    expect(completed.variables.contractStatus).toBe('ativo');
    expect(completed.executionPath.filter((step) => step.nodeId === 'sgp')).toHaveLength(2);
    expect(completed.executionPath.at(-1)?.nodeId).toBe('active-end');
  });

  it('activates the channel typing indicator while a time wait is running', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const typing = workflowNode('logic.wait', 'typing', {
      mode: 'time',
      timeoutMs: 60_000,
      resumeEvent: '',
      showTyping: true,
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, typing, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', typing, 'main'),
        connect(typing, 'expired', end, 'main'),
        connect(typing, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const durations: number[] = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        sendTyping: async (durationMs) => {
          durations.push(durationMs);
          return { success: true, supported: true };
        },
      }),
    );
    const waiting = await executor.start({ workflow, input: {} });
    expect(waiting.status).toBe('waiting');
    expect(durations).toEqual([60_000]);
    expect(waiting.nodeResults.typing?.output?.typing).toMatchObject({ supported: true });
    await executor.cancel(waiting.executionId, 'Fim do teste.');
  });

  it('keeps an Intelligent Attendant handoff distinct from a human handoff', async () => {
    const trigger = workflowNode('trigger.manual', 'trigger');
    const handoff = workflowNode('output.handoff', 'handoff', {
      destinationType: 'intelligent_agent',
      teamId: '',
      agentId: '',
      systemAgentId: 'intelligent-attendant-1',
      reason: 'Continuar com IA especializada.',
      requireConfirmation: false,
      permissionScope: 'conversation:handoff',
    });
    const end = workflowNode('output.end', 'end');
    const errors = errorPath();
    const workflow = workflowDefinition(
      [trigger, handoff, end, errors.handler, errors.end],
      [
        connect(trigger, 'started', handoff, 'main'),
        connect(handoff, 'completed', end, 'main'),
        connect(handoff, 'error', errors.handler, 'error', 'error'),
        errors.connection,
      ],
    );
    const destinations: Array<Record<string, unknown>> = [];
    const executor = new WorkflowExecutor(
      new InMemoryWorkflowPersistence(),
      createDefaultNodeHandlerRegistry({
        handoff: async (runtimeInput) => {
          destinations.push(runtimeInput.node.config);
          return { success: true, transferred: true };
        },
      }),
    );
    const execution = await executor.start({ workflow, input: {} });
    expect(execution.status).toBe('completed');
    expect(destinations[0]).toMatchObject({
      destinationType: 'intelligent_agent',
      systemAgentId: 'intelligent-attendant-1',
    });
  });
});
