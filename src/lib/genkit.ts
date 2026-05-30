import { genkit } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';
import { normalizeGoogleAiModelId } from '@/lib/ai-models';

// Initialize Genkit - This file should ONLY be used on the server
const ai = genkit({
    plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
    model: gemini15Flash,
});

export async function generateSummary(conversationText: string, apiKey?: string, modelName?: string): Promise<string> {
    let localAi = ai;
    const normalizedModel = normalizeGoogleAiModelId(modelName);

    // Se temos uma chave ou um modelo específico, precisamos re-instanciar
    if (apiKey || normalizedModel) {
        localAi = genkit({
            plugins: [googleAI({ apiKey: apiKey || process.env.GOOGLE_GENAI_API_KEY })],
            model: normalizedModel || gemini15Flash,
        });
    }

    const prompt = `
    Resuma o seguinte atendimento de suporte em um parágrafo conciso para notas internas.
    Foque apenas na conversa atual fornecida.
    Destaque o problema principal e a resolução (ou estado atual).
    O resumo deve ter no máximo 500 caracteres.
    Não invente informações.
    
    Conversa:
    ${conversationText}
    `;

    try {
        const { text } = await localAi.generate(prompt);
        return text;
    } catch (error: any) {
        console.error('Error generating summary with Genkit:', error);
        if (error.message?.includes('404') || error.status === 404) {
            throw new Error('Modelo de IA não disponível. Verifique a chave de API e permissões.');
        }
        throw new Error('Falha na geração do resumo.');
    }
}
