import 'server-only';
import Papa from 'papaparse';
import { extractStudioKnowledgeFile } from '@/services/agent-studio/knowledge-file';
import { requestPlatformMedia } from '@/services/ai/platform-media';
import { transcribePrivateAudioWithWhisper } from '@/services/audio/transcription-service';
import { isRecord, materializeValue, statePatchAtPath } from '@/services/workflow-runtime/utils';
import type { NodeExecutionResult, NodeRuntimeInput } from '@/services/workflow-runtime/types';
import { loadWorkflowFile, saveWorkflowFile } from './workflow-files';
import { requestPublicHttps } from './public-http';
import { loadNexusCredentialPayload } from './credentials';
import { assertBoundedSpreadsheetArchive } from './spreadsheet-limits';
import { generateToolboxDocument } from './toolbox-documents';
import { convertLegacyOffice } from './legacy-office';

import { toolboxSource } from './runtime-source';

export async function executeToolboxMedia(input: NodeRuntimeInput, resolvedConfig?: Record<string, unknown>): Promise<NodeExecutionResult> {
  const workspaceId = input.workflow.workspaceId;
  if (!workspaceId) throw new Error('A operação exige um workspace.');
  // Model-provided tool arguments are already resolved and must not be treated
  // as workflow templates capable of reading unrelated execution variables.
  const config = resolvedConfig ?? materializeValue(input.node.config, toolboxSource(input)) as Record<string, unknown>;
  let result: unknown;
  if (input.node.type === 'files.write') {
    const format = String(config.format || 'json');
    if (!['json', 'txt', 'csv', 'pdf', 'docx', 'xlsx', 'pptx'].includes(format)) throw new Error('Formato de saída inválido.');
    const value = config.source ?? input.input;
    const name = !config.fileName || config.fileName === 'resultado.json' ? `resultado.${format}` : String(config.fileName);
    if (format === 'pdf' || format === 'docx' || format === 'xlsx' || format === 'pptx') {
      const generated = await generateToolboxDocument(format, value);
      result = await saveWorkflowFile({ workspaceId, name, ...generated });
    } else {
      if (format === 'csv' && (!Array.isArray(value) || value.length > 1000 || !value.every(isRecord))) throw new Error('CSV exige uma lista de até 1.000 objetos.');
      const text = format === 'json' ? JSON.stringify(value, null, 2) : format === 'csv' ? Papa.unparse(value as Record<string, unknown>[], { escapeFormulae: true }) : String(value);
      result = await saveWorkflowFile({ workspaceId, name, mimeType: format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain', data: Buffer.from(text) });
    }
  } else if (input.node.type === 'audio.elevenlabs') {
    const text = String(config.text || '').trim(), voiceId = String(config.voiceId || '');
    if (!text || text.length > 10000 || !/^[A-Za-z0-9_-]{1,100}$/.test(voiceId)) throw new Error('Informe texto de até 10.000 caracteres e um ID de voz válido.');
    const credential = await loadNexusCredentialPayload({ workspaceId, credentialId: String(config.credentialId || ''), allowedTypes: ['api_key'] });
    const key=String(credential.payload.value || ''), modelId=String(config.modelId || 'eleven_multilingual_v2');
    if (!key || key.length > 10000 || /[\r\n]/.test(key) || !/^[A-Za-z0-9_-]{1,100}$/.test(modelId)) throw new Error('Configure uma credencial e modelo ElevenLabs válidos.');
    const response = await requestPublicHttps({ url:`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, method:'POST', headers:{'xi-api-key':key,'Content-Type':'application/json','Accept':'audio/mpeg'}, body:JSON.stringify({text,model_id:modelId}), timeoutMs:120000, maxResponseBytes:10000000, signal:input.signal });
    const contentType=String(response.headers['content-type'] || '').split(';')[0].toLowerCase().trim();
    if (!['audio/mpeg','audio/mp3','application/octet-stream'].includes(contentType) || !response.body.length) throw new Error('O provedor não retornou um áudio MP3 válido.');
    result = await saveWorkflowFile({workspaceId,name:'voz.mp3',mimeType:'audio/mpeg',data:response.body});
  } else if (input.node.type === 'audio.transcribe') {
    const { file, data } = await loadWorkflowFile(workspaceId, config.file);
    if (!file.mimeType.startsWith('audio/')) throw new Error('Selecione um arquivo de áudio.');
    result = { text: await transcribePrivateAudioWithWhisper({data,mimeType:file.mimeType,name:file.name,scope:`workspace:${workspaceId}:workflow:${input.workflow.id}`,signal:input.signal}) };
  } else {
    const { file, data } = await loadWorkflowFile(workspaceId, config.file);
    if (input.node.type === 'media.analyze') {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(file.mimeType)) throw new Error('Use uma imagem PNG, JPEG, WebP, GIF ou um PDF compatível com o modelo.');
      result = { text: await requestPlatformMedia({ workspaceId, prompt: String(config.prompt || ''), data, mimeType: file.mimeType, requireDeclaredCapability: true }) };
    } else {
      const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
      const mimeFormats: Record<string, string> = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/json': 'json', 'text/csv': 'csv', 'text/plain': 'txt', 'text/markdown': 'md' };
      const knownExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'json', 'csv', 'txt', 'md'];
      let format = config.format && config.format !== 'auto' ? String(config.format) : extension && knownExtensions.includes(extension) ? extension : mimeFormats[file.mimeType];
      let readableData = data;
      if (format === 'xls') { readableData = await convertLegacyOffice(data, 'xls', input.signal); format = 'xlsx'; }
      if (format === 'xlsx') {
        if (data.length > 2_000_000) throw new Error('Use uma planilha XLSX de até 2 MB.');
        assertBoundedSpreadsheetArchive(readableData);
        const { default: readExcel } = await import('read-excel-file/universal');
        const sheets = await readExcel(new Uint8Array(readableData).buffer, { trim: false });
        if (sheets.length > 20) throw new Error('A planilha excede o limite de 20 abas.');
        const parsed = sheets.map(sheet => {
          const rows = sheet.data || [];
          if (rows.length > 1001 || rows.some(row => row.length > 100)) throw new Error('A planilha excede 1.000 linhas ou 100 colunas.');
          const headers = (rows[0] || []).map((value, index) => String(value || `coluna_${index + 1}`));
          if (new Set(headers).size !== headers.length) throw new Error('A planilha contém nomes de colunas repetidos.');
          return { name: sheet.sheet, items: rows.slice(1).map(row => Object.fromEntries(headers.map((key, index) => [key, row[index] instanceof Date ? row[index]?.toISOString() : row[index] ?? null]))) };
        });
        result = { items: parsed[0]?.items || [], ...(parsed.length > 1 ? { sheets: parsed } : {}) };
      } else if (format === 'csv') {
        const parsed = Papa.parse<Record<string, string>>(data.toString('utf8'), { header: true, skipEmptyLines: true, preview: 1001 });
        if (parsed.errors.length || parsed.data.length > 1000) throw new Error('CSV inválido ou com mais de 1.000 linhas.');
        result = { items: parsed.data };
      } else if (format === 'json') result = JSON.parse(data.toString('utf8'));
      else if (format === 'pdf' || format === 'docx' || format === 'doc' || format === 'pptx') result = await extractStudioKnowledgeFile(new File([new Uint8Array(data)], extension === format ? file.name : `${file.name}.${format}`, { type: file.mimeType }));
      else if (['txt', 'md'].includes(format || '')) result = { text: new TextDecoder('utf-8', { fatal: true }).decode(data) };
      else throw new Error('Formato de arquivo não suportado.');
    }
  }
  if (Buffer.byteLength(JSON.stringify(result) ?? 'null') > 1_000_000) throw new Error('Os dados extraídos excedem 1 MB.');
  input.signal.throwIfAborted();
  return { status: 'success', selectedOutput: 'success', output: isRecord(result) ? result : { value: result }, statePatch: statePatchAtPath(String(config.outputKey || 'result'), result), metrics: { durationMs: 0, modelCalls: input.node.type === 'media.analyze' ? 1 : 0, toolCalls: input.node.type.startsWith('audio.') ? 1 : 0 } };
}
