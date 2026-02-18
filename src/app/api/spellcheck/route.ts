
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/actions/user';
import { getIntegrationConfig } from '@/actions/integrations';

export async function POST(request: Request) {
    try {
        const user = await getCurrentUser();
        if (!user?.activeWorkspaceId) {
            return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
        }

        const body = await request.json();
        const { text } = body;

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return NextResponse.json({ error: 'Texto vazio.' }, { status: 400 });
        }

        // Resolve Gemini API key: workspace integrations -> env var
        let apiKey: string | undefined;
        let model = 'gemini-2.0-flash';

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
                { error: 'Gemini não configurado. Vá em Integrações > Gemini para adicionar sua chave de API.' },
                { status: 400 }
            );
        }

        // Use the same SDK as the rest of the app
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);

        // Strip any "googleai/" prefix that might be on the model name
        const cleanModel = model.replace(/^googleai\//, '');

        const genModel = genAI.getGenerativeModel({
            model: cleanModel,
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1024,
            },
        });

        const result = await genModel.generateContent(
            `Você é um corretor ortográfico e gramatical de português brasileiro. Corrija APENAS erros de ortografia, gramática e pontuação do texto abaixo. NÃO altere o significado, NÃO adicione conteúdo novo, NÃO reformule frases. Mantenha o tom informal se o original for informal. Retorne APENAS o texto corrigido, sem explicações ou comentários adicionais.\n\nTexto: ${text}`
        );

        const correctedText = result.response?.text()?.trim();

        if (!correctedText) {
            return NextResponse.json(
                { error: 'Não foi possível obter uma resposta do Gemini.' },
                { status: 500 }
            );
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
