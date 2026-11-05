import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Nexus product operations contract', () => {
  it('persists recoverable revisions for every meaningful flow lifecycle event', () => {
    const migration = read('prisma/migrations/20260826120000_nexus_workflow_history/migration.sql');
    const actions = read('src/modules/nexus/actions/workflows.ts');

    expect(migration).toContain('CREATE TABLE public.nexus_workflow_versions');
    expect(migration).toContain("'create', 'save', 'publish', 'restore', 'duplicate', 'import'");
    expect(migration).toContain('UNIQUE (nexus_workflow_id, revision)');
    for (const source of ['create', 'publish', 'restore', 'duplicate']) {
      expect(actions).toContain(`source: '${source}'`);
    }
    expect(actions).toContain("input.source || 'save'");
    expect(actions).toContain("Extract<NexusWorkflowVersionSource, 'save' | 'import'>");
  });

  it('exposes real standalone flow operations instead of the agent-only menu', () => {
    const actions = read('src/modules/nexus/actions/workflows.ts');
    const builder = read('src/components/workflow/native-workflow-builder.tsx');
    const editor = read('src/modules/nexus/components/standalone-flow-editor.tsx');
    const catalog = read('src/modules/nexus/components/nexus-catalog.tsx');

    expect(builder).toContain("surface === 'standalone' ? 'Gerenciar fluxo' : 'Gerenciar agente'");
    expect(builder).toContain("onOpenPanel('executions')");
    expect(builder).toContain('Histórico de versões');
    expect(builder).toContain('Exportar JSON');
    expect(builder).toContain('Importar JSON');
    expect(editor).toContain('<NexusWorkflowHistoryDialog');
    expect(editor).toContain('<NexusWorkflowExecutionsDialog');
    expect(catalog).toContain('duplicateNexusWorkflow');
    expect(catalog).toContain('archiveNexusWorkflow');
    expect(catalog).toContain('restoreArchivedNexusWorkflow');
    expect(catalog).toContain('Fluxos arquivados');
    expect(actions).toContain("status = 'archived'");
    expect(actions).toContain("status = CASE");
  });
});
