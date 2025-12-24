import { genkit } from 'genkit';
import { googleAI, gemini15Flash } from '@genkit-ai/googleai';

// Initialize Genkit - This file should ONLY be used on the server
const ai = genkit({
    plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
    model: gemini15Flash,
});

export async function generateSummary(conversationText: string, apiKey?: string): Promise<string> {
    let localAi = ai;
    if (apiKey) {
        localAi = genkit({
            plugins: [googleAI({ apiKey })],
            model: gemini15Flash,
        });
    }

    const prompt = `
    Resuma o seguinte atendimento de suporte em um parágrafo conciso para notas internas.
    Foque apenas na conversa atual fornecida.
    Destaque o problema principal e a resolução (ou estado atual).
    Não invente informações.
    
    Conversa:
    ${conversationText}
    `;

    try {
        const { text } = await localAi.generate(prompt);
        return text;
    } catch (error) {
        console.error('Error generating summary with Genkit:', error);
        throw new Error('Falha na geração do resumo.');
    }
}
