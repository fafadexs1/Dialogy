import { requestPlatformJson } from '@/services/ai/platform-json';
import 'server-only';
import { z } from 'zod';
import { requestPlatformMedia } from '@/services/ai/platform-media';

import { getWorkspaceAiRuntimeConfig } from '@/actions/autopilot';
import { DEFAULT_AUTOPILOT_MODEL, getAiModelRuntimeProvider, getGoogleAiSdkModelName } from '@/lib/ai-models';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { transcribeAudio } from '@/ai/flows/transcribe-audio';
import { resolveWorkspaceAiExecutionContext } from '@/services/ai/runtime';
import { isLmStudioModel } from '@/services/ai/lm-studio';
import { requestLmStudioVisionText } from '@/services/ai/lm-studio-client';
import { resolveAiProviderKeyCandidates } from '@/services/ai/provider-keys';

export type AnalyzeMediaInput = {
  mediaUrl: string;
  workspaceId: string;
  mediaType: 'audio' | 'image' | 'video' | 'document';
  mimetype?: string | null;
  caption?: string | null;
  model?: string | null;
};

export type AnalyzeMediaOutput = {
  analysis: string;
};

function buildPrompt(input: AnalyzeMediaInput): string {
  const caption = input.caption?.trim()
    ? `\nLegenda/texto enviado pelo cliente: "${input.caption.trim()}".`
    : '';

  if (input.mediaType === 'image') {
    return `Analise esta imagem no contexto de atendimento ao cliente. Descreva objetivamente o que aparece, possiveis problemas visiveis e informacoes uteis para o atendente em ate 4 frases curtas.${caption}`;
  }

  if (input.mediaType === 'video') {
    return `Analise este video no contexto de atendimento ao cliente. Resuma o que aparece/acontece e qualquer problema visivel ou audivel em ate 4 frases curtas.${caption}`;
  }

  return `Analise este arquivo no contexto de atendimento ao cliente e resuma informacoes uteis em ate 4 frases curtas.${caption}`;
}

async function extractPdfContent(arrayBuffer: ArrayBuffer): Promise<{
  text?: string;
  imageBuffer?: Buffer;
}> {
  const data = new Uint8Array(arrayBuffer);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const pagesText: string[] = [];
    let firstImageBuffer: Buffer | null = null;

    const maxPages = Math.min(pdf.numPages, 10);
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ')
        .trim();
      if (pageText) {
        pagesText.push(pageText);
      }

      if (!firstImageBuffer) {
        try {
          const ops = await page.getOperatorList();
          for (let i = 0; i < ops.fnArray.length; i++) {
            if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) {
              const imgId = ops.argsArray[i][0];
              const imgData: any = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 1500);
                page.objs.get(imgId, (res: any) => {
                  clearTimeout(timeout);
                  resolve(res);
                });
              });
              if (imgData && imgData.data && imgData.width && imgData.height) {
                const sharp = (await import('sharp')).default;
                const channels = imgData.data.length === imgData.width * imgData.height * 4 ? 4 : 3;
                firstImageBuffer = await sharp(Buffer.from(imgData.data), {
                  raw: {
                    width: imgData.width,
                    height: imgData.height,
                    channels,
                  },
                }).png().toBuffer();
                break;
              }
            } else if (ops.fnArray[i] === pdfjs.OPS.paintInlineImageXObject) {
              const imgData = ops.argsArray[i][0];
              if (imgData && imgData.data && imgData.width && imgData.height) {
                const sharp = (await import('sharp')).default;
                const channels = imgData.data.length === imgData.width * imgData.height * 4 ? 4 : 3;
                firstImageBuffer = await sharp(Buffer.from(imgData.data), {
                  raw: {
                    width: imgData.width,
                    height: imgData.height,
                    channels,
                  },
                }).png().toBuffer();
                break;
              }
            }
          }
        } catch (err) {
          console.warn('[PDF_IMAGE_EXTRACT] Falha ao extrair imagem da página do PDF:', err);
        }
      }
    }

    const fullText = pagesText.join('\n\n').trim();
    return {
      text: fullText || undefined,
      imageBuffer: firstImageBuffer || undefined,
    };
  } finally {
    await task.destroy();
  }
}

export async function analyzeMediaForAutopilot(input:AnalyzeMediaInput):Promise<AnalyzeMediaOutput> {
  if(input.mediaType==='audio') {
    const result=await transcribeAudio({audioUrl:input.mediaUrl,workspaceId:input.workspaceId});
    return {analysis:[result.transcription,input.caption?.trim()].filter(Boolean).join(' ')};
  }
  const response=await fetch(input.mediaUrl);
  if(!response.ok)throw new Error('Falha ao baixar a midia.');
  const buffer=await response.arrayBuffer();
  const mime=input.mimetype||response.headers.get('content-type')||'application/octet-stream';
  if(input.mediaType==='document' && (mime.includes('pdf')||mime.startsWith('text/'))) {
    const extracted=mime.includes('pdf')?await extractPdfContent(buffer):{text:new TextDecoder().decode(buffer)};
    if(extracted.text?.trim()) {
      const output=await requestPlatformJson({workspaceId:input.workspaceId,model:'',apiKey:'',schema:z.object({analysis:z.string()}),schemaName:'dialogy_document',
        jsonSchema:{type:'object',properties:{analysis:{type:'string'}},required:['analysis'],additionalProperties:false},systemPrompt:buildPrompt(input),userPrompt:extracted.text.slice(0,30000),maxTokens:2048,timeoutMs:60000});
      return output;
    }
    if(extracted.imageBuffer)return {analysis:await requestPlatformMedia({workspaceId:input.workspaceId,prompt:buildPrompt(input),data:extracted.imageBuffer,mimeType:'image/png'})};
  }
  return {analysis:await requestPlatformMedia({workspaceId:input.workspaceId,prompt:buildPrompt(input),data:Buffer.from(buffer),mimeType:mime})};
}
