import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Nexus native module boundary', () => {
  it('keeps app routes thin and owned by src/modules/nexus', () => {
    const catalogRoute = read('src/app/nexus/page.tsx');
    const editorRoute = read('src/app/nexus/[id]/page.tsx');
    const standaloneEditorRoute = read('src/app/nexus/flows/[id]/page.tsx');

    expect(catalogRoute).toContain("from '@/modules/nexus'");
    expect(editorRoute).toContain("from 'next/navigation'");
    expect(editorRoute).toContain('redirect(`/autopilot/${encodeURIComponent(id)}`)');
    expect(standaloneEditorRoute).toContain("from '@/modules/nexus'");
    expect(catalogRoute).not.toContain("@/app/autopilot");
    expect(editorRoute).not.toContain('NexusFlowEditor');
  });

  it('keeps standalone Nexus workflows separate from Autopilot agents', () => {
    const catalog = read('src/modules/nexus/components/nexus-catalog.tsx');
    const standaloneEditor = read('src/modules/nexus/components/standalone-flow-editor.tsx');
    const actions = read('src/modules/nexus/actions/workflows.ts');

    expect(catalog).toContain('Fluxos de automação');
    expect(catalog).toContain('Agentes inteligentes');
    expect(catalog).toContain('createNexusWorkflow');
    expect(standaloneEditor).toContain('surface="standalone"');
    expect(standaloneEditor).not.toContain('createAutopilotNativeWorkflowDraft');
    expect(actions).toContain('public.nexus_workflows');
    expect(actions).not.toContain('INSERT INTO autopilot_configs');
  });

  it('does not mount the Flowbuilder from the autonomous-agent page', () => {
    const agentPage = read('src/app/autopilot/[id]/page.tsx');

    expect(agentPage).not.toContain('NativeWorkflowBuilder');
    expect(agentPage).not.toContain('NativeAiBuilderDialog');
    expect(agentPage).not.toContain('usePathname');
    expect(agentPage).toContain('AiAgentJourneyStudio');
    expect(agentPage).toContain('getAgentStudioDataAction');
  });

  it('has no iframe or external Nexus SSO in the active Nexus routes', () => {
    const catalogRoute = read('src/app/nexus/page.tsx');
    const editorRoute = read('src/app/nexus/[id]/page.tsx');
    const moduleIndex = read('src/modules/nexus/index.ts');

    for (const source of [catalogRoute, editorRoute, moduleIndex]) {
      expect(source).not.toMatch(/iframe|NexusEmbed|nexus-settings|actions\/nexus/i);
    }
  });

  it('requires an explicit versioned system-agent sender instead of creating a hidden fallback', () => {
    const deploymentDialog = read('src/modules/nexus/components/nexus-deployment-dialog.tsx');
    const chatAdapters = read('src/modules/nexus/services/chat-adapters.ts');
    const resources = read('src/modules/nexus/services/dialogy-resources.ts');

    expect(deploymentDialog).toContain('Agente do fluxo');
    expect(deploymentDialog).toContain('senderSystemAgentId');
    expect(chatAdapters).toContain('resolveNexusSenderSystemAgent');
    expect(chatAdapters).not.toContain('ensureNexusSystemAgent');
    expect(resources).toContain('metadata.senderSystemAgentId');
  });
});
