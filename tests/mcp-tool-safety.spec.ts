import { describe, expect, it } from 'vitest';

import { classifyMcpToolSafety } from '@/services/mcp/tool-safety';

describe('MCP tool semantic safety classification', () => {
  it.each([
    ['get_wifi_view', 'Retorna SSIDs, senhas, status e canais atuais.'],
    ['scan_wifi_neighbors', 'Realiza scan das redes Wi-Fi vizinhas e retorna canais e sinal.'],
    ['get_wifi_scan_cached', 'Retorna o ultimo scan salvo em cache.'],
    ['list_connected_devices', 'Lista dispositivos conectados ao roteador.'],
    ['queue_get_parameters', 'Enfileira GetParameterValues para ler parametros.'],
    ['refresh_wifi_full', 'Enfileira coleta completa de Wi-Fi.'],
    ['sync_mesh_topology', 'Sincroniza a topologia Mesh no cache.'],
  ])('classifies observational tool %s as read-only without annotations', (name, description) => {
    expect(classifyMcpToolSafety(`mcp:router:${name}`, { name, description })).toMatchObject({
      class: 'read_only',
      riskLevel: 'low',
      sideEffect: 'none',
      idempotent: true,
      requiresHumanApproval: false,
      inferredFrom: 'semantics',
    });
  });

  it.each([
    ['reboot_router', 'Reinicia o roteador.'],
    ['queue_set_parameters', 'Enfileira SetParameterValues no roteador.'],
    ['change_wifi_credentials', 'Altera nome e senha do Wi-Fi.'],
    ['clear_pending_commands', 'Limpa comandos pendentes.'],
    ['import_mesh_topology', 'Importa topologia Mesh no cadastro.'],
  ])('classifies mutating tool %s as high risk without annotations', (name, description) => {
    expect(classifyMcpToolSafety(`mcp:router:${name}`, { name, description })).toMatchObject({
      class: 'write_non_idempotent',
      riskLevel: 'high',
      sideEffect: 'high',
      requiresHumanApproval: false,
      inferredFrom: 'semantics',
    });
  });

  it('gives explicit MCP annotations precedence over semantic inference', () => {
    expect(classifyMcpToolSafety('mcp:custom:inspect', {
      name: 'inspect',
      annotations: { destructiveHint: true, readOnlyHint: true },
    })).toMatchObject({
      riskLevel: 'high',
      sideEffect: 'high',
      inferredFrom: 'annotation',
    });
  });
});
