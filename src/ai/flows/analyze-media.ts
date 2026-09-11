'use server';

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

async function requestDeepSeekTextCompletion(input: {
  apiKey: string;
  model?: string | null;
  prompt: string;
  content: string;
}): Promise<string> {
  let modelId = (input.model || '').replace(/^deepseek\//, '').trim();
  if (!modelId || modelId === 'deepseek-reasoner') {
    modelId = 'deepseek-flash';
  }

  const deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: `${input.prompt}\n\nConteúdo extraído do documento:\n"""\n${input.content.slice(0, 30000)}\n"""`,
        },
      ],
      max_tokens: 2000,
      thinking: {
        type: 'disabled',
      },
    }),
  });

  if (!deepseekResponse.ok) {
    const errorBody = await deepseekResponse.text();
    throw new Error(`Falha na API DeepSeek (${deepseekResponse.status}): ${errorBody}`);
  }

  const data = await deepseekResponse.json();
  const choice = data.choices?.[0]?.message;
  const content = choice?.content?.trim() || choice?.reasoning_content?.trim() || '';
  if (!content) {
    throw new Error('DeepSeek retornou uma resposta vazia para o documento.');
  }
  return content;
}

async function requestDeepSeekVisionText(input: {
  apiKey: string;
  model?: string | null;
  mediaUrl?: string | null;
  imageBuffer?: Buffer | null;
  mimetype?: string | null;
  prompt: string;
}): Promise<string> {
  let dataUri: string;
  if (input.imageBuffer) {
    const mimeType = input.mimetype || 'image/png';
    dataUri = `data:${mimeType};base64,${input.imageBuffer.toString('base64')}`;
  } else if (input.mediaUrl) {
    const response = await fetch(input.mediaUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar imagem: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const base64Media = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = input.mimetype || response.headers.get('content-type') || 'image/jpeg';
    dataUri = `data:${mimeType};base64,${base64Media}`;
  } else {
    throw new Error('Nenhuma URL ou buffer de imagem fornecido para analise visual.');
  }

  let modelId = (input.model || '').replace(/^deepseek\//, '').trim();
  if (!modelId || modelId === 'deepseek-reasoner') {
    modelId = 'deepseek-flash';
  }

  const deepseekResponse = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: input.prompt },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: 2000,
      thinking: {
        type: 'disabled',
      },
    }),
  });

  if (!deepseekResponse.ok) {
    const errorBody = await deepseekResponse.text();
    throw new Error(`Falha na API DeepSeek Vision (${deepseekResponse.status}): ${errorBody}`);
  }

  const data = await deepseekResponse.json();
  const choice = data.choices?.[0]?.message;
  const content = choice?.content?.trim() || choice?.reasoning_content?.trim() || '';
  if (!content) {
    throw new Error('DeepSeek retornou uma analise visual vazia.');
  }
  return content;
}

export async function analyzeMediaForAutopilot(input: AnalyzeMediaInput): Promise<AnalyzeMediaOutput> {
  if (input.mediaType === 'audio') {
    const result = await transcribeAudio({
      audioUrl: input.mediaUrl,
      workspaceId: input.workspaceId,
    });
    const caption = input.caption?.trim() ? ` Legenda/texto enviado pelo cliente: ${input.caption.trim()}` : '';
    return { analysis: `${result.transcription}${caption}`.trim() };
  }

  const selectedModel = input.model || (await resolveWorkspaceAiExecutionContext(input.workspaceId)).model;
  if (input.mediaType === 'image' && isLmStudioModel(selectedModel)) {
    return {
      analysis: await requestLmStudioVisionText({
        model: selectedModel,
        prompt: buildPrompt(input),
        mediaUrl: input.mediaUrl,
        timeoutMs: Number.parseInt(process.env.AI_MEDIA_ANALYSIS_TIMEOUT_MS || '', 10) || 12000,
        maxTokens: 320,
      }),
    };
  }

  const provider = getAiModelRuntimeProvider(selectedModel);
  const keyCandidates = await resolveAiProviderKeyCandidates({
    config: { workspace_id: input.workspaceId },
  });

  const isDeepSeek = provider === 'deepseek' || selectedModel.toLowerCase().includes('deepseek');
  const deepseekCandidate = keyCandidates.find((c) => c.provider === 'deepseek' && c.key);

  if (input.mediaType === 'image' && (isDeepSeek || (deepseekCandidate && provider !== 'googleai'))) {
    if (!deepseekCandidate?.key) {
      throw new Error('Integracao DeepSeek do workspace nao configurada ou inativa.');
    }

    return {
      analysis: await requestDeepSeekVisionText({
        apiKey: deepseekCandidate.key,
        model: isDeepSeek ? selectedModel : 'deepseek-flash',
        mediaUrl: input.mediaUrl,
        mimetype: input.mimetype,
        prompt: buildPrompt(input),
      }),
    };
  }

  // Tratamento especializado para documentos e PDFs (texto, escaneado e outros formatos)
  if (input.mediaType === 'document') {
    const docResponse = await fetch(input.mediaUrl);
    if (!docResponse.ok) {
      throw new Error(`Falha ao baixar documento: ${docResponse.statusText}`);
    }

    const docBuffer = await docResponse.arrayBuffer();
    const mimeType = input.mimetype || docResponse.headers.get('content-type') || 'application/octet-stream';
    const isPdf = mimeType.includes('pdf') || new TextDecoder().decode(new Uint8Array(docBuffer.slice(0, 5))) === '%PDF-';
    const isImageDoc = mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(input.mediaUrl);

    if (isImageDoc && (isDeepSeek || (deepseekCandidate && provider !== 'googleai'))) {
      if (!deepseekCandidate?.key) throw new Error('Integracao DeepSeek do workspace nao configurada ou inativa.');
      return {
        analysis: await requestDeepSeekVisionText({
          apiKey: deepseekCandidate.key,
          model: isDeepSeek ? selectedModel : 'deepseek-flash',
          mediaUrl: input.mediaUrl,
          mimetype: mimeType,
          prompt: buildPrompt({ ...input, mediaType: 'image' }),
        }),
      };
    }

    if (isPdf && (isDeepSeek || (deepseekCandidate && provider !== 'googleai'))) {
      if (!deepseekCandidate?.key) throw new Error('Integracao DeepSeek do workspace nao configurada ou inativa.');
      const extracted = await extractPdfContent(docBuffer);

      // 1. PDF com texto digital selecionável
      if (extracted.text && extracted.text.length > 30) {
        const docPrompt = `Analise este documento PDF enviado pelo cliente no contexto de atendimento ao cliente. Identifique o tipo de documento, principais dados (valores, datas, contratante/titular) e informacoes uteis em ate 4 frases curtas.${input.caption ? `\nLegenda do cliente: "${input.caption}".` : ''}`;
        return {
          analysis: await requestDeepSeekTextCompletion({
            apiKey: deepseekCandidate.key,
            model: isDeepSeek ? selectedModel : 'deepseek-flash',
            prompt: docPrompt,
            content: extracted.text,
          }),
        };
      }

      // 2. PDF escaneado (imagem de documento dentro do PDF)
      if (extracted.imageBuffer) {
        const scannedPrompt = `Analise esta imagem escaneada de documento PDF no contexto de atendimento ao cliente. Identifique o tipo de documento (RG, CNH, contrato, fatura, comprovante, etc.), dados legiveis relevantes e resuma em ate 4 frases curtas.${input.caption ? `\nLegenda do cliente: "${input.caption}".` : ''}`;
        return {
          analysis: await requestDeepSeekVisionText({
            apiKey: deepseekCandidate.key,
            model: isDeepSeek ? selectedModel : 'deepseek-flash',
            imageBuffer: extracted.imageBuffer,
            mimetype: 'image/png',
            prompt: scannedPrompt,
          }),
        };
      }

      return {
        analysis: 'Documento PDF recebido, mas sem conteudo legivel de texto ou imagem para analise automatica.',
      };
    }

    // Arquivos de texto plano, CSV ou JSON
    const isTextDoc = mimeType.startsWith('text/') || /\.(txt|csv|json|md)$/i.test(input.mediaUrl);
    if (isTextDoc && (isDeepSeek || (deepseekCandidate && provider !== 'googleai'))) {
      if (!deepseekCandidate?.key) throw new Error('Integracao DeepSeek do workspace nao configurada ou inativa.');
      const text = new TextDecoder('utf-8').decode(docBuffer);
      return {
        analysis: await requestDeepSeekTextCompletion({
          apiKey: deepseekCandidate.key,
          model: isDeepSeek ? selectedModel : 'deepseek-flash',
          prompt: buildPrompt(input),
          content: text,
        }),
      };
    }

    // Suporte nativo ao PDF no Google Gemini
    const googleCandidate = keyCandidates.find((c) => c.provider === 'googleai' && c.key);
    if (googleCandidate?.key) {
      const base64Media = Buffer.from(docBuffer).toString('base64');
      const modelName = getGoogleAiSdkModelName(selectedModel) || getGoogleAiSdkModelName(DEFAULT_AUTOPILOT_MODEL)!;
      const genAI = new GoogleGenerativeAI(googleCandidate.key);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: isPdf ? 'application/pdf' : mimeType,
            data: base64Media,
          },
        },
        { text: buildPrompt(input) },
      ]);
      return { analysis: result.response.text().trim() };
    }
  }

  const googleKeyCandidate = keyCandidates.find((c) => c.provider === 'googleai' && c.key);
  let apiKey = googleKeyCandidate?.key;
  let aiModel = selectedModel;

  if (!apiKey) {
    const runtimeConfig = await getWorkspaceAiRuntimeConfig(input.workspaceId).catch(() => null);
    apiKey = runtimeConfig?.apiKey || undefined;
    aiModel = runtimeConfig?.aiModel || selectedModel;
  }

  if (!apiKey) {
    throw new Error('Integracao Gemini/DeepSeek do workspace nao configurada ou inativa.');
  }

  const response = await fetch(input.mediaUrl);
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Media = Buffer.from(arrayBuffer).toString('base64');
  const mimeType = input.mimetype || response.headers.get('content-type') || 'application/octet-stream';
  const modelName = getGoogleAiSdkModelName(aiModel) || getGoogleAiSdkModelName(DEFAULT_AUTOPILOT_MODEL)!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: base64Media,
      },
    },
    { text: buildPrompt(input) },
  ]);

  return { analysis: result.response.text().trim() };
}
