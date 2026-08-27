import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NodeRuntimeInput } from '@/services/workflow-runtime';

const mocks = vi.hoisted(() => ({
  runSgpWorkspaceTool: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { query: vi.fn() } }));
vi.mock('@/lib/realtime/chat-broadcast', () => ({ broadcastHydratedChatUpdate: vi.fn() }));
vi.mock('@/services/chat-distribution/team-availability', () => ({ evaluateTeamBusinessHours: vi.fn() }));
vi.mock('@/services/agent-tools/sgp-tools', () => ({ runSgpWorkspaceTool: mocks.runSgpWorkspaceTool }));

import { executeNexusPlatformAction } from '@/modules/nexus/services/platform-actions';

function runtimeInput(
  variables: Record<string, unknown>,
  input: Record<string, unknown> = {},
  nodeType = 'dialogy.sgp_second_copy',
) {
  return {
    workflow: { workspaceId: 'workspace-1' },
    node: {
      id: 'velpro_sgp_second_copy',
      type: nodeType,
      config: { cpfCnpj: '{{cpf}}', outputKey: 'sgp' },
    },
    execution: {
      executionId: 'execution-1',
      conversationId: 'chat-1',
      variables,
      input: {},
      context: {},
      nodeResults: {},
    },
    input,
    attachments: {},
    signal: new AbortController().signal,
    emit: vi.fn(),
  } as unknown as NodeRuntimeInput;
}

describe('Nexus SGP platform actions', () => {
  beforeEach(() => {
    mocks.runSgpWorkspaceTool.mockReset();
  });

  it('uses the recovered list row id instead of the truncated invoice title', async () => {
    mocks.runSgpWorkspaceTool.mockResolvedValue({
      status: 'success',
      output: {
        contracts: [{ id: '15532', statusTone: 'active' }],
        invoices: [
          {
            id: '898373',
            contractId: '15532',
            dueDate: '20/08/2026',
            amount: 54.95,
            pixCode: 'pix-898373',
            digitableLine: 'boleto-898373',
            isOpen: true,
          },
          {
            id: '898374',
            contractId: '15532',
            dueDate: '20/09/2026',
            amount: 54.95,
            pixCode: 'pix-898374',
            isOpen: true,
          },
        ],
      },
    });
    const delivery = {
      sendResponse: vi.fn().mockResolvedValue({ success: true }),
      sendOptions: vi.fn().mockResolvedValue({ success: true }),
    };

    const first = await executeNexusPlatformAction(runtimeInput({ cpf: '06646882177' }), delivery);
    const internalState = first.statePatch?.__nexus_sgp_velpro_sgp_second_copy;

    expect(first.status).toBe('waiting');
    expect(delivery.sendOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Qual fatura você deseja pagar?',
        choices: [
          { id: '898373', label: '08/2026 - R$ 54,95', description: 'Vencimento 20/08/2026' },
          { id: '898374', label: '09/2026 - R$ 54,95', description: 'Vencimento 20/09/2026' },
        ],
      }),
      expect.anything(),
    );

    const resumed = await executeNexusPlatformAction(
      runtimeInput(
        { cpf: '06646882177', __nexus_sgp_velpro_sgp_second_copy: internalState },
        {
          resume: {
            selectedOptionId: '898373',
            value: 'Fatura 898373 · vence 20',
          },
        },
      ),
      delivery,
    );

    expect(resumed.status).toBe('waiting');
    expect(delivery.sendOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Como deseja receber a segunda via?' }),
      expect.anything(),
    );
    expect(resumed.statePatch?.__nexus_sgp_velpro_sgp_second_copy).toEqual(
      expect.objectContaining({ stage: 'payment-method', selectedInvoiceId: '898373' }),
    );
    expect(mocks.runSgpWorkspaceTool).toHaveBeenCalledTimes(1);

    const paymentState = resumed.statePatch?.__nexus_sgp_velpro_sgp_second_copy;
    const delivered = await executeNexusPlatformAction(
      runtimeInput(
        { cpf: '06646882177', __nexus_sgp_velpro_sgp_second_copy: paymentState },
        { resume: { selectedOptionId: 'pix' } },
      ),
      delivery,
    );

    expect(delivered.status).toBe('success');
    expect(delivery.sendResponse).toHaveBeenLastCalledWith('pix-898373', expect.anything());

    const boletoDelivered = await executeNexusPlatformAction(
      runtimeInput(
        { cpf: '06646882177', __nexus_sgp_velpro_sgp_second_copy: paymentState },
        { resume: { selectedOptionId: 'boleto' } },
      ),
      delivery,
    );

    expect(boletoDelivered.status).toBe('success');
    expect(delivery.sendResponse).toHaveBeenLastCalledWith('boleto-898373', expect.anything());
  });

  it('shows contract status and connection state like the previous Nexus flow', async () => {
    mocks.runSgpWorkspaceTool.mockResolvedValue({
      status: 'success',
      output: {
        contracts: [
          {
            id: '15532',
            statusTone: 'active',
            statusLabel: 'Ativo',
            connectionStatus: 'online',
            addressLabel: 'Taguatinga - Centro',
          },
          {
            id: '18741',
            statusTone: 'suspended',
            statusLabel: 'Suspenso',
            connectionStatus: 'offline',
            addressLabel: 'Ceilândia - Norte',
          },
        ],
        invoices: [],
      },
    });
    const delivery = {
      sendResponse: vi.fn().mockResolvedValue({ success: true }),
      sendOptions: vi.fn().mockResolvedValue({ success: true }),
    };

    const result = await executeNexusPlatformAction(runtimeInput({ cpf: '06646882177' }), delivery);

    expect(result.status).toBe('waiting');
    expect(delivery.sendOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Por favor, informe o contrato:',
        choices: [
          { id: '15532', label: '15532 (Ativo)', description: 'Online · Taguatinga - Centro' },
          { id: '18741', label: '18741 (Suspenso)', description: 'Offline · Ceilândia - Norte' },
        ],
      }),
      expect.anything(),
    );
  });

  it('keeps the old Nexus contract list and result messages in payment promises', async () => {
    mocks.runSgpWorkspaceTool
      .mockResolvedValueOnce({
        status: 'success',
        output: {
          contracts: [
            {
              id: '15532',
              statusTone: 'active',
              statusLabel: 'Ativo',
              connectionStatus: 'online',
              addressLabel: 'Taguatinga - Centro',
            },
            {
              id: '18741',
              statusTone: 'suspended',
              statusLabel: 'Suspenso',
              connectionStatus: 'offline',
              addressLabel: 'Ceilândia - Norte',
            },
          ],
        },
      })
      .mockResolvedValueOnce({ status: 'success', output: { payload: { status: 1 } } });
    const delivery = {
      sendResponse: vi.fn().mockResolvedValue({ success: true }),
      sendOptions: vi.fn().mockResolvedValue({ success: true }),
    };

    const first = await executeNexusPlatformAction(
      runtimeInput({ cpf: '06646882177' }, {}, 'dialogy.sgp_payment_promise'),
      delivery,
    );
    const internalState = first.statePatch?.__nexus_sgp_velpro_sgp_second_copy;

    expect(delivery.sendOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          { id: '15532', label: '15532 (Ativo)', description: 'Online · Taguatinga - Centro' },
          { id: '18741', label: '18741 (Suspenso)', description: 'Offline · Ceilândia - Norte' },
        ],
      }),
      expect.anything(),
    );

    const resumed = await executeNexusPlatformAction(
      runtimeInput(
        { cpf: '06646882177', __nexus_sgp_velpro_sgp_second_copy: internalState },
        { resume: { selectedOptionId: '15532' } },
        'dialogy.sgp_payment_promise',
      ),
      delivery,
    );

    expect(resumed.status).toBe('route');
    expect(resumed.selectedOutput).toBe('status-1');
    expect(delivery.sendResponse).toHaveBeenCalledWith(
      'A conexão foi liberada provisoriamente. Assim que o pagamento constar, continuará liberada.',
      expect.anything(),
    );
  });

  it('routes exhausted payment-promise allowance to finance without offering a retry', async () => {
    mocks.runSgpWorkspaceTool
      .mockResolvedValueOnce({
        status: 'success',
        output: {
          contracts: [{
            id: '27341',
            statusTone: 'suspended',
            statusLabel: 'Suspenso',
            connectionStatus: 'online',
          }],
        },
      })
      .mockResolvedValueOnce({
        status: 'success',
        output: {
          payload: {
            status: 2,
            liberado: false,
            msg: 'O recurso de promessa de pagamento já atingiu quantidade permitida. Recurso não disponível',
          },
        },
      });
    const delivery = {
      sendResponse: vi.fn().mockResolvedValue({ success: true }),
      sendOptions: vi.fn().mockResolvedValue({ success: true }),
    };

    const result = await executeNexusPlatformAction(
      runtimeInput({ cpf: '02800265108' }, {}, 'dialogy.sgp_payment_promise'),
      delivery,
    );

    expect(result.status).toBe('route');
    expect(result.selectedOutput).toBe('limit-reached');
    expect(result.output).toEqual(expect.objectContaining({
      status: 2,
      limitReached: true,
      reason: 'O recurso de promessa de pagamento já atingiu quantidade permitida. Recurso não disponível',
    }));
    expect(delivery.sendResponse).toHaveBeenCalledWith(
      'O limite de desbloqueios de confiança permitido pelo SGP já foi utilizado. Vou encaminhar seu atendimento ao financeiro.',
      expect.anything(),
    );
    expect(delivery.sendOptions).not.toHaveBeenCalled();
  });
});
