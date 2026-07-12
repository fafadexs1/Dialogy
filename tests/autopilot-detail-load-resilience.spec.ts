import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/autopilot/[id]/page.tsx'),
  'utf8',
);

describe('Autopilot detail loading resilience contract', () => {
  it('renders the critical configuration before waiting for optional resources', () => {
    const criticalLoad = source.indexOf('const autopilotData = await getAutopilotConfig');
    const configReady = source.indexOf('setConfig(autopilotData.config)');
    const optionalLoads = source.indexOf('await Promise.allSettled', configReady);

    expect(criticalLoad).toBeGreaterThan(-1);
    expect(configReady).toBeGreaterThan(criticalLoad);
    expect(optionalLoads).toBeGreaterThan(configReady);
  });

  it('never uses a blank return for missing or failed configuration', () => {
    const renderBoundary = source.slice(
      source.indexOf('if (loading && !config)'),
      source.indexOf('const handlePreviewNativeMigration'),
    );
    expect(renderBoundary).not.toContain('return null');
    expect(source).toContain('Carregando o Flowbuilder');
    expect(source).toContain('Não foi possível abrir o Flowbuilder');
    expect(source).toContain('Automação não encontrada');
    expect(source).toContain('Configuração indisponível');
    expect(source).toContain('Voltar para automações');
    expect(source).toContain('Tentar novamente');
  });

  it('degrades optional model, tool, RAG and usage failures independently', () => {
    expect(source).toContain("resource: 'models'");
    expect(source).toContain("resource: 'tools'");
    expect(source).toContain("resource: 'rag'");
    expect(source).toContain("resource: 'usage'");
    expect(source).toContain('Os modelos já configurados no workspace continuam disponíveis.');
    expect(source).toContain('As conexões já salvas foram preservadas.');
    expect(source).toContain('Os documentos continuam editáveis.');
  });

  it('keeps retry available inside a loaded but degraded editor', () => {
    expect(source).toContain('Editor carregado com recursos limitados');
    expect(source).toContain('fetchData({ showLoading: false })');
    expect(source).toContain('{loadWarningBanner}');
  });
});
