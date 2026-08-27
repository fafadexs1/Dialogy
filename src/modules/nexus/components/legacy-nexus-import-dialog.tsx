'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson2, Loader2, Upload } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import type { ModelConfiguration, WorkflowDefinition } from '@/services/workflow-runtime/types';
import { importNexusPortableFlow } from '../services/flow-portability';
import {
  convertLegacyNexusFlow,
  parseLegacyNexusFlowJson,
  type LegacyNexusImportReport,
  type NexusImportMcpTool,
} from '../services/legacy-import';

export function LegacyNexusImportDialog({
  disabled,
  workspaceId,
  configId,
  name,
  model,
  mcpTools = [],
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  onApply,
}: {
  disabled?: boolean;
  workspaceId: string;
  configId: string;
  name: string;
  model: ModelConfiguration;
  mcpTools?: readonly NexusImportMcpTool[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  onApply: (workflow: WorkflowDefinition, report: LegacyNexusImportReport) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [json, setJson] = useState('');
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ workflow: WorkflowDefinition; report: LegacyNexusImportReport; native: boolean } | null>(null);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const reset = () => {
    setJson('');
    setFilename('');
    setError('');
    setPreview(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const importPreview = () => {
    setBusy(true);
    setError('');
    try {
      const raw = parseLegacyNexusFlowJson(json);
      const portable = importNexusPortableFlow({ raw, workflowId: configId, workspaceId, name });
      if (portable) {
        setPreview({
          workflow: portable.workflow,
          native: true,
          report: {
            sourceVersion: 'dialogy-native-v1',
            importedNodes: portable.workflow.nodes.length,
            importedConnections: portable.workflow.connections.length,
            dialogyAiNodes: portable.workflow.nodes.filter((node) => node.type.startsWith('ai.')).length,
            placeholders: 0,
            discardedSecretFields: 0,
            warnings: [],
            validation: portable.validation,
          },
        });
        return;
      }
      const result = convertLegacyNexusFlow({ raw, workspaceId, configId, name, model, mcpTools });
      setPreview({ ...result, native: false });
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'O arquivo não possui um fluxo Nexus válido.');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    onApply(preview.workflow, preview.report);
    setOpen(false);
    reset();
  };

  return (
    <>
      {!hideTrigger ? <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="absolute bottom-5 right-5 z-40 rounded-full border-slate-600 bg-slate-950/90 text-slate-200 shadow-xl hover:bg-slate-900 hover:text-white"
      >
        <Upload className="mr-2 h-4 w-4" />
        Importar fluxo
      </Button> : null}

      <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) reset(); }}>
        <DialogContent className="dark flex max-h-[92vh] w-[min(820px,95vw)] max-w-none flex-col overflow-hidden border-slate-700 bg-[#0b121a] p-0 text-slate-100 shadow-2xl">
          <div className="border-b border-slate-700/80 bg-[#101b26] px-6 py-5">
            <DialogTitle className="flex items-center gap-3"><FileJson2 className="h-5 w-5 text-cyan-300" />Importar fluxo</DialogTitle>
            <DialogDescription className="mt-2 text-slate-400">
              Aceita exportações nativas da Dialogy e arquivos do Nexus antigo. Na conversão antiga, IA, memória, conhecimento e ferramentas usam os recursos seguros da Dialogy.
            </DialogDescription>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
            {!preview ? (
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setFilename(file.name);
                    setJson(await file.text());
                    setError('');
                  }}
                />
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} className="w-full border-dashed border-slate-600 bg-slate-900/50 py-8 text-slate-200 hover:bg-slate-900">
                  <Upload className="mr-2 h-4 w-4" />{filename || 'Selecionar exportação .json'}
                </Button>
                <div className="text-center text-xs uppercase tracking-wider text-slate-500">ou cole o JSON</div>
                <Textarea value={json} onChange={(event) => setJson(event.target.value)} placeholder="{ &quot;version&quot;: &quot;1.0&quot;, &quot;nodes&quot;: [...], &quot;connections&quot;: [...] }" className="min-h-52 border-slate-700 bg-slate-950 font-mono text-xs text-slate-200" />
                {error && <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
              </>
            ) : (
              <div className="space-y-5">
                <div className={`rounded-2xl border p-5 ${preview.report.validation.valid ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-amber-500/20 bg-amber-500/10'}`}>
                  <div className="flex items-center gap-3">
                    {preview.report.validation.valid ? <CheckCircle2 className="h-5 w-5 text-emerald-300" /> : <AlertTriangle className="h-5 w-5 text-amber-300" />}
                    <div><p className="font-medium">{preview.report.validation.valid ? (preview.native ? 'Fluxo nativo pronto para importar' : 'Conversão pronta para revisão no canvas') : 'Importação criada com pendências'}</p><p className="mt-1 text-sm text-slate-400">{preview.report.importedNodes} blocos e {preview.report.importedConnections} conexões carregados.</p></div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"><div className="text-2xl font-semibold text-cyan-300">{preview.report.dialogyAiNodes}</div><div className="mt-1 text-xs text-slate-400">blocos na IA Dialogy</div></div>
                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"><div className="text-2xl font-semibold text-amber-300">{preview.report.placeholders}</div><div className="mt-1 text-xs text-slate-400">itens para revisão</div></div>
                  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"><div className="text-2xl font-semibold text-emerald-300">{preview.report.discardedSecretFields}</div><div className="mt-1 text-xs text-slate-400">segredos descartados</div></div>
                </div>
                {preview.report.warnings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-slate-200">Relatório da migração</p>
                    <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      {preview.report.warnings.map((warning, index) => <div key={`${warning.code}-${warning.legacyNodeId || warning.legacyConnectionId || index}`} className="text-xs leading-5 text-slate-400"><Badge variant="outline" className="mr-2 border-slate-700 text-[10px] text-slate-300">{warning.code}</Badge>{warning.message}</div>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-700 bg-[#101b26] px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => preview ? setPreview(null) : setOpen(false)}>{preview ? 'Voltar' : 'Cancelar'}</Button>
            {preview ? <Button type="button" onClick={apply} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">Aplicar ao rascunho</Button> : <Button type="button" onClick={importPreview} disabled={!json.trim() || busy} className="bg-cyan-400 text-slate-950 hover:bg-cyan-300">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Analisar importação</Button>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
