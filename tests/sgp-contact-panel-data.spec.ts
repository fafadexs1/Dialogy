import { describe, expect, it } from 'vitest';

import { buildSGPContactPanelData } from '@/plugins/sgp/contact-panel-data';
import { SGP_UNASSIGNED_INVOICE_GROUP_KEY } from '@/plugins/sgp/types';

describe('buildSGPContactPanelData', () => {
  it('groups invoices by contract, prioritizes critical contracts, and keeps unmatched invoices isolated', () => {
    const data = buildSGPContactPanelData([
      {
        nome: 'Andre Juan',
        cpfcnpj: '123.456.789-00',
        contratos: [
          {
            contrato: '100',
            status: 'Ativo',
            servicos: [
              {
                tipo: 'Fibra',
                plano: { descricao: 'Plano 600 Mega' },
                endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Goiania', uf: 'GO' },
                login: 'andre.100',
                mac: 'AA:BB:CC:DD:EE:FF',
                onu: {
                  serial: 'ONU-100',
                  conexao: {
                    status: 'online',
                    ip: '10.0.0.10',
                    data_conexao: '2026-04-10',
                  },
                },
              },
            ],
          },
          {
            contrato: 'CONTR-200',
            status: 'Suspenso',
            servicos: [
              {
                tipo: 'Fibra',
                plano: { descricao: 'Plano 300 Mega' },
                endereco: { logradouro: 'Rua B', numero: '20', bairro: 'Norte', cidade: 'Goiania', uf: 'GO' },
                login: 'andre.200',
                onu: {
                  serial: 'ONU-200',
                  conexao: {
                    status: 'offline',
                    data_desconexao: '2026-04-01',
                  },
                },
              },
            ],
          },
        ],
        titulos: [
          {
            id: 'inv-overdue-1',
            clienteContrato: '100',
            status: 'aberto',
            valor: '50',
            valorCorrigido: '60',
            diasAtraso: '10',
            dataVencimento: '2020-01-01',
          },
          {
            id: 'inv-overdue-2',
            clienteContrato: '100',
            status: 'aberto',
            valor: '40',
            diasAtraso: '3',
            dataVencimento: '2020-01-03',
          },
          {
            id: 'inv-paid',
            clienteContrato: '100',
            status: 'pago',
            valor: '70',
            dataVencimento: '2020-01-10',
            dataPagamento: '2020-01-15',
          },
          {
            id: 'inv-open',
            clientecontrato_id: '200',
            status: 'aberto',
            valor: '80',
            linhaDigitavel: '34191.79001 01043.510047 91020.150008 4 12370000008000',
            link: 'https://sgp.example.com/boleto/inv-open',
            dataVencimento: '2099-01-01',
          },
          {
            id: 'inv-unassigned',
            clienteContrato: '999',
            status: 'aberto',
            valor: '90',
            diasAtraso: '5',
            dataVencimento: '2020-02-01',
          },
        ],
      },
    ]);

    expect(data).not.toBeNull();
    expect(data?.overdueInvoices).toBe(3);
    expect(data?.openInvoices).toBe(1);

    expect(data?.invoiceGroups.map((group) => group.key)).toEqual([
      '100',
      'CONTR-200',
      SGP_UNASSIGNED_INVOICE_GROUP_KEY,
    ]);

    expect(data?.contracts.map((contract) => contract.id)).toEqual(['100', 'CONTR-200']);

    const primaryGroup = data?.invoiceGroups[0];
    expect(primaryGroup?.summary.overdueInvoices).toBe(2);
    expect(primaryGroup?.summary.historyInvoices).toBe(1);
    expect(primaryGroup?.summary.totalOutstandingAmount).toBe(100);
    expect(primaryGroup?.invoiceSections[0].invoices.map((invoice) => invoice.id)).toEqual([
      'inv-overdue-1',
      'inv-overdue-2',
    ]);

    const secondGroup = data?.invoiceGroups[1];
    expect(secondGroup?.contractId).toBe('CONTR-200');
    expect(secondGroup?.summary.openInvoices).toBe(1);
    expect(secondGroup?.invoiceSections[1].invoices[0]?.id).toBe('inv-open');
    expect(secondGroup?.invoiceSections[1].invoices[0]?.digitableLine).toBe('34191.79001 01043.510047 91020.150008 4 12370000008000');
    expect(secondGroup?.invoiceSections[1].invoices[0]?.paymentLink).toBe('https://sgp.example.com/boleto/inv-open');

    const unassignedGroup = data?.invoiceGroups[2];
    expect(unassignedGroup?.isUnassigned).toBe(true);
    expect(unassignedGroup?.summary.overdueInvoices).toBe(1);
    expect(unassignedGroup?.invoiceSections[0].invoices[0]?.id).toBe('inv-unassigned');
  });

  it('merges support contract data into the matching contract details', () => {
    const data = buildSGPContactPanelData(
      [
        {
          nome: 'Judicleia Marques da Silva',
          cpfcnpj: '006.009.713-25',
          contratos: [
            {
              contrato: '27398',
              status: 'Ativo',
              servicos: [
                {
                  tipo: 'Fibra',
                  plano: { descricao: 'Plano Principal' },
                  endereco: { logradouro: 'Rua Antiga', numero: '10', bairro: 'Centro', cidade: 'Goiania', uf: 'GO' },
                  login: 'judicleia.27398',
                  mac: 'AA:BB:CC:DD:EE:FF',
                },
              ],
            },
          ],
          titulos: [],
        },
      ],
      [
        {
          contrato_id: '27398',
          plano: 'PLANO_550MEGA_LEVE700MEGA_WIFI6',
          rad_ip: '100.65.16.141',
          rad_framedipv6prefix: '2804:3cd0:80::/64',
          rad_delegatedipv6prefix: '2804:3cd0:c6:80f0::/62',
          servico_onu_cto: 'PQM - 10-O2 - 17',
          contrato_endereco_ll: '-16.115829624,-47.9918647332',
          endereco_logradouro: 'QUADRA 02 CHACARA 07 BLOCO 22 APT 101',
          endereco_bairro: 'CHACARAS BRASIL',
          endereco_cidade: 'VALPARAISO DE GOIAS',
          endereco_uf: 'GO',
          endereco_complemento: 'COND GRAN PARIS',
          servico_online: true,
          rad_dataconexao: '2026-04-07T09:26:23',
        },
      ]
    );

    const contract = data?.contracts[0];
    expect(contract?.id).toBe('27398');
    expect(contract?.ip).toBe('100.65.16.141');
    expect(contract?.ipv6).toBe('2804:3cd0:80::/64');
    expect(contract?.delegatedIpv6).toBe('2804:3cd0:c6:80f0::/62');
    expect(contract?.cto).toBe('PQM - 10-O2 - 17');
    expect(contract?.geoLocation).toBe('-16.115829624,-47.9918647332');
    expect(contract?.addressLabel).toBe('QUADRA 02 CHACARA 07 BLOCO 22 APT 101 - CHACARAS BRASIL - VALPARAISO DE GOIAS - GO - COND GRAN PARIS');
    expect(contract?.connectedAt).toBe('2026-04-07T09:26:23');
  });

  it('keeps the online Radius session when support API returns multiple services for one contract', () => {
    const data = buildSGPContactPanelData(
      [{
        nome: 'Fabio Silva Soares',
        cpfcnpj: '866.752.731-91',
        contratos: [{
          id: '16317',
          status: 'Ativo',
          servicos: [{
            tipo: 'Fibra',
            plano: { descricao: 'PLANO_1000MEGA_WIFI6_60CANAIS' },
            login: 'testesuporte.fibra',
            ip: '',
          }],
        }],
        titulos: [],
      }],
      [
        {
          contrato_id: '16317',
          servico_online: true,
          rad_ip: '100.65.14.124',
          rad_framedipv6prefix: '2804:3cd0:80::/64',
          rad_delegatedipv6prefix: '2804:3cd0:cd:a334::/62',
          rad_dataconexao: '2026-06-01T16:17:17',
          servico_login: 'testesuporte.fibra',
        },
        {
          contrato_id: '16317',
          servico_login: 'testesuporte2026',
        },
      ]
    );

    expect(data?.contracts[0]).toMatchObject({
      id: '16317',
      connectionStatus: 'online',
      ip: '100.65.14.124',
      ipv6: '2804:3cd0:80::/64',
      delegatedIpv6: '2804:3cd0:cd:a334::/62',
      connectedAt: '2026-06-01T16:17:17',
    });
  });
});
