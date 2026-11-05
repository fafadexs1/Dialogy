import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiAgentJourneyStudio } from '../../src/components/autopilot/ai-agent-journey-studio';
import { Toaster } from '../../src/components/ui/toaster';
import { createDefaultAgentStudioDocument, CollectedFieldDefinitionSchema, ProcedureDocumentSchema } from '../../src/services/agent-studio/types';
import '../../src/app/globals.css';

// Isolated regression fixture for HTTP origins. This never affects the real application.
if (new URLSearchParams(window.location.search).has('http-compat')) {
  Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true });
}

const id = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const document = createDefaultAgentStudioDocument(id, workspaceId, 'Agente fictício · QA');
document.concludeStage.handoffTeam = 'Suporte';
document.resolveStage.procedures = [ProcedureDocumentSchema.parse({ id: 'billing', name: 'Segunda via de fatura', objective: 'Consultar fatura do cliente', triggerKeywords: ['fatura'], updatedAt: '2026-08-27', steps: [
  { id: 'collect', order: 1, type: 'collect_data', title: 'Coletar CPF', collectField: CollectedFieldDefinitionSchema.parse({ id: 'cpf', name: 'CPF', type: 'cpf', variableKey: 'cpf', promptMessage: 'Informe o CPF do titular.', required: true, isSensitive: true }) },
  { id: 'respond', order: 2, type: 'respond', title: 'Confirmar dados', messageText: 'CPF válido. Esta é uma simulação sem consultar faturas reais.' },
] })];
createRoot(window.document.getElementById('root')!).render(<><AiAgentJourneyStudio config={{ id, name: document.name, workspace_id: workspaceId } as any} initialDocument={document} workspaceId={workspaceId} /><Toaster /></>);
