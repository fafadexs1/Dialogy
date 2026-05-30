import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { getIntegrationConfig } from '@/actions/integrations';
import { DEFAULT_AUTOPILOT_MODEL, getGoogleAiSdkModelName } from '@/lib/ai-models';

const MIN_OUTPUT_TOKENS = 1024;
const MAX_OUTPUT_TOKENS = 8192;

function calculateMaxOutputTokens(text: string): number {
    const estimatedTokens = Math.ceil(text.length / 3) + 512;
    return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, estimatedTokens));
}

function normalizeForComparison(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function looksTruncated(original: string, corrected: string): boolean {
    const originalNorm = normalizeForComparison(original);
    const correctedNorm = normalizeForComparison(corrected);

    if (!originalNorm) return false;
    if (!correctedNorm) return true;

    const originalWords = originalNorm.split(' ').filter(Boolean).length;
    const correctedWords = correctedNorm.split(' ').filter(Boolean).length;
    const charRatio = correctedNorm.length / originalNorm.length;
    const wordRatio = originalWords > 0 ? correctedWords / originalWords : 1;
    const minRatio = originalNorm.length > 300 ? 0.75 : 0.6;

    return charRatio < minRatio || (originalWords >= 20 && wordRatio < 0.75);
}

function extractCorrectedText(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    const fencedMatch = trimmed.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i);
    return (fencedMatch ? fencedMatch[1] : trimmed).trim();
}

export async function POST(request: Request) {
    try {
        const user = await getCurrentUser();
        if (!user?.activeWorkspaceId) {
            return NextResponse.json({ error: 'N\u00e3o autenticado.' }, { status: 401 });
        }

        const body = await request.json();
        const { text } = body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return NextResponse.json({ error: 'Texto vazio.' }, { status: 400 });
        }

        // Resolve Gemini API key: workspace integrations -> env var
        let apiKey: string | undefined;
        let model = DEFAULT_AUTOPILOT_MODEL.replace(/^googleai\//, '');

        const { config, isActive } = await getIntegrationConfig(user.activeWorkspaceId, 'gemini');

        if (config?.apiKey && isActive) {
            apiKey = config.apiKey;
            if (config.aiModel) {
                model = config.aiModel;
            }
        }

        // Fallback to env var (same as autopilot-service)
        if (!apiKey) {
            apiKey = process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY;
        }

        if (!apiKey) {
            return NextResponse.json(
                { error: 'Gemini n\u00e3o configurado. V\u00e1 em Integra\u00e7\u00f5es > Gemini para adicionar sua chave de API.' },
                { status: 400 }
            );
        }

        // Use the same SDK as the rest of the app
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);

        // Strip any "googleai/" prefix that might be on the model name
        const cleanModel = getGoogleAiSdkModelName(model) || getGoogleAiSdkModelName(DEFAULT_AUTOPILOT_MODEL)!;

        const prompt = [
            'Voce e um corretor ortografico e gramatical de portugues brasileiro.',
            'Regras obrigatorias:',
            '- Preserve TODO o conteudo original, sem resumir ou remover frases.',
            '- Corrija apenas ortografia, acentuacao, concordancia e pontuacao.',
            '- Nao altere o significado.',
            '- Nao adicione conteudo novo.',
            '- Mantenha a mesma ordem das frases e os mesmos paragrafos.',
            '- Se ja estiver correto, devolva o texto exatamente como esta.',
            '- Retorne APENAS o texto corrigido, sem explicacoes.',
            '',
            'Texto para corrigir:',
            text,
        ].join('\n');

        const runSpellcheck = async (maxOutputTokens: number) => {
            const genModel = genAI.getGenerativeModel({
                model: cleanModel,
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens,
                },
            });

            const result = await genModel.generateContent(prompt);
            const finishReason = String(result.response?.candidates?.[0]?.finishReason || '');
            const correctedText = extractCorrectedText(result.response?.text() || '');
            return { correctedText, finishReason };
        };

        const initialMaxTokens = calculateMaxOutputTokens(text);
        let { correctedText, finishReason } = await runSpellcheck(initialMaxTokens);

        if ((!correctedText || finishReason === 'MAX_TOKENS') && initialMaxTokens < MAX_OUTPUT_TOKENS) {
            ({ correctedText, finishReason } = await runSpellcheck(MAX_OUTPUT_TOKENS));
        }

        if (!correctedText) {
            return NextResponse.json(
                { error: 'N\u00e3o foi poss\u00edvel obter uma resposta do Gemini.' },
                { status: 500 }
            );
        }

        if (finishReason === 'MAX_TOKENS' || looksTruncated(text, correctedText)) {
            console.warn('[SPELLCHECK] Resposta potencialmente truncada; mantendo texto original.');
            correctedText = text;
        }

        return NextResponse.json({ correctedText });
    } catch (error: any) {
        console.error('[SPELLCHECK] Error:', error?.message || error);
        return NextResponse.json(
            { error: error?.message || 'Erro interno do servidor.' },
            { status: 500 }
        );
    }
}
