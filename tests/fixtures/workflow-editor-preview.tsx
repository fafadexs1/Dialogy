'use client';

import { useEffect, useRef, useState } from 'react';
import { NativeWorkflowBuilder } from '@/components/workflow/native-workflow-builder';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';
import { createStudioCompositionPreview, studioCompositionPreviewReleases } from './studio-composition-preview';
import { StudioFlowSettings } from '@/components/autopilot/studio-flow-settings';
import { studioFlowRelease } from './studio-flow-fixture';
import { createWorkflowEditorFixture } from './workflow-editor-fixture';
import { createToolboxPreview } from './toolbox-preview';
import { createStandaloneNexusWorkflow } from '@/modules/nexus/services/standalone-workflows';

function Harness() {
  const [definition, setDefinition] = useState(() => createWorkflowEditorFixture());
  const [saved, setSaved] = useState(definition);
  const { setTheme } = useTheme();
  const [measurement, setMeasurement] = useState('');
  const [studioPreview, setStudioPreview] = useState(false);
  const [studioDocument, setStudioDocument] = useState(() => studioFlowRelease().agentSnapshot);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const measure = () => {
    cancelAnimationFrame(raf.current);
    setMeasurement('Medindo…');
    const frames: number[] = []; const active: number[] = [];
    let previousTime = performance.now(); const start = previousTime; let previousSignature = '';
    const tick = (time: number) => {
      const signature = (document.querySelector('.react-flow__viewport')?.getAttribute('style') || '') + (document.querySelector('.react-flow__node')?.getAttribute('style') || '');
      const delta = time - previousTime;
      if (delta > 0) { frames.push(delta); if (signature !== previousSignature) active.push(delta); }
      previousTime = time; previousSignature = signature;
      if (time - start < 4000) raf.current = requestAnimationFrame(tick);
      else {
        const percentile = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)].toFixed(2)) : null; };
        setMeasurement(JSON.stringify({ nodes: definition.nodes.length, viewport: [innerWidth, innerHeight], sampleMs: 4000, frames: frames.length, activeFrames: active.length, p95Ms: percentile(frames), activeP95Ms: percentile(active), maxMs: Number(Math.max(...frames).toFixed(2)), visibleNodes: document.querySelectorAll('.react-flow__node').length }));
      }
    };
    raf.current = requestAnimationFrame(tick);
  };
  return <div className="flex h-dvh flex-col"><div className="flex shrink-0 flex-wrap items-center gap-3 bg-slate-800 px-4 py-2 text-xs text-white"><strong>Validação local · dados sintéticos</strong><button onClick={() => setTheme('light')}>Tema claro</button><button onClick={() => setTheme('dark')}>Tema escuro</button>{[9, 300, 500].map((count) => <button key={count} onClick={() => { const next = createWorkflowEditorFixture(count); setDefinition(next); setSaved(next); }}>{count} nodes</button>)}<button onClick={() => { const next = createStudioCompositionPreview(); setDefinition(next); setSaved(next); setStudioPreview(false); }}>IA Studio</button><button onClick={() => setStudioPreview(!studioPreview)}>Configurar Studio</button><button onClick={() => { const next = createToolboxPreview(); setDefinition(next); setSaved(next); setStudioPreview(false); }}>Dados e APIs</button><button onClick={() => { const next = createStandaloneNexusWorkflow({ id: 'aurora-preview', workspaceId: 'preview-workspace', name: 'Aurora Work · Vendas fictícias', template: 'sales_demo' }); setDefinition(next); setSaved(next); setStudioPreview(false); }}>Vendas Aurora</button><button onClick={measure}>Medir 4s</button><output aria-label="Medição de frames" className="max-w-[360px] truncate text-[10px]">{measurement}</output><output aria-label="Quantidade de operações">{definition.nodes.length}</output><output aria-label="Definição sintética" className="sr-only">{JSON.stringify(definition)}</output></div><div className="min-h-0 flex-1">{studioPreview ? <div className="h-full overflow-auto bg-background"><StudioFlowSettings document={studioDocument} onChange={(flowBuilder) => setStudioDocument((current) => ({ ...current, flowBuilder }))} /></div> : <NativeWorkflowBuilder studioReleases={studioCompositionPreviewReleases} onTest={async () => ({ success: true, executionId: 'toolbox-preview', status: 'completed', input: { leads: [{ name: 'Maria', active: true }, { name: 'João', active: false }] }, variables: { qualified: [{ name: 'Maria', active: true }] }, nodeResults: { filter: { status: 'success', output: { result: [{ name: 'Maria', active: true }] }, statePatch: { qualified: [{ name: 'Maria', active: true }] } } }, messages: [{ id: 'preview', role: 'system', text: 'Teste sintético concluído.', timestamp: new Date().toISOString() }] })} surface="standalone" definition={definition} onChange={setDefinition} defaultModel={{ provider: 'openai', model: 'fixture', temperature: 0.2, maxOutputTokens: 2048, supportsTools: true, supportsStructuredOutput: true, supportsStreaming: true, timeoutMs: 60000, maxRetries: 2 }} modelOptions={[{ id: 'fixture', label: 'IA Dialogy (fixture local)', provider: 'openai', enabled: true }]} knowledgeDocuments={[]} knowledgeCollections={[]} tools={[]} toolsLoading={false} isSaving={false} isPublishing={false} isDirty={JSON.stringify(saved) !== JSON.stringify(definition)} hasDraft={true} onBack={() => {}} onSave={() => setSaved(definition)} onPublish={() => {}} onDiscard={() => setDefinition(saved)} />}</div></div>;
}
export default function Preview() { return <ThemeProvider attribute="class" defaultTheme="light" storageKey="workflow-preview-theme"><Harness /></ThemeProvider>; }
