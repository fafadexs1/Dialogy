import { describe, expect, it } from 'vitest';

import {
  filterSupportContractsToValidatedClients,
  getValidatedSgpContractIds,
  scopeSgpClientsToContract,
} from '@/services/agent-tools/sgp-tools';

describe('SGP support contract ownership boundary', () => {
  const clients = [{
    contratos: [
      { contrato: 101 },
      { id: '202' },
    ],
  }];

  it('derives contract ids only from the CPF-scoped URA response', () => {
    expect([...getValidatedSgpContractIds(clients)]).toEqual(['101', '202']);
  });

  it('drops support rows for contracts absent from the validated customer', () => {
    const supportRows = [
      { contrato_id: '101', servico_onu_serial: 'SERIAL-VALIDO' },
      { contrato_id: '999', servico_onu_serial: 'SERIAL-OUTRO-TITULAR' },
    ];

    expect(filterSupportContractsToValidatedClients(clients, supportRows)).toEqual([
      supportRows[0],
    ]);
  });

  it('never synthesizes ownership when the URA response has no contracts', () => {
    expect(filterSupportContractsToValidatedClients(
      [{ contratos: [] }],
      [{ contrato_id: '999' }],
    )).toEqual([]);
  });

  it('returns only the explicitly requested contract while preserving customer data', () => {
    const scoped = scopeSgpClientsToContract([{
      nome: 'Cliente Teste',
      contratos: [{ contrato: 101 }, { id: '202' }],
    }], '202');

    expect(scoped).toEqual([{
      nome: 'Cliente Teste',
      contratos: [{ id: '202' }],
    }]);
    expect(scopeSgpClientsToContract(clients, '999')).toEqual([]);
  });
});
