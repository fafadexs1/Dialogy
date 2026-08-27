'use server';

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import type { CriteriaGroup } from '@/lib/crm-query-builder';

const geminiFlashModel = googleAI.model('gemini-2.5-flash');

const ai = genkit({
    plugins: [googleAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY })],
    model: geminiFlashModel,
});

const SYSTEM_PROMPT = `Você é um assistente que converte descrições em linguagem natural de segmentos de contatos CRM em filtros estruturados JSON.

Os campos disponíveis são:
- "name" (texto): nome do contato
- "email" (texto): email do contato
- "phone_number_jid" (texto): telefone
- "tags" (seleção): tags atribuídas (valores: novo, qualificado, proposta, negociacao, fechamento)
- "last_activity" (data): data da última atividade
- "created_at" (data): data de criação do contato
- "lead_score" (número): score/pontuação do lead (0-100)
- "owner_id" (texto): ID do responsável

Os operadores disponíveis são:
- "equals": igual a
- "contains": contém (apenas texto)
- "gt": maior que (datas e números)
- "lt": menor que (datas e números)
- "gte": maior ou igual
- "lte": menor ou igual
- "is_set": está preenchido (sem valor)
- "is_not_set": não está preenchido (sem valor)

Para datas relativas como "últimos 5 dias", use a data ISO calculada a partir de hoje.

Responda SOMENTE com o JSON válido, sem markdown, sem explicação. O formato deve ser:
{
  "operator": "AND" ou "OR",
  "conditions": [
    { "field": "campo", "operator": "operador", "value": "valor" }
  ]
}`;

export async function parseNaturalLanguageSegment(
    description: string
): Promise<{ criteria: CriteriaGroup | null; error?: string }> {
    if (!description.trim()) {
        return { criteria: null, error: 'Descrição vazia.' };
    }

    try {
        const today = new Date().toISOString().split('T')[0];
        const prompt = `${SYSTEM_PROMPT}

Data de hoje: ${today}

Converta esta descrição em filtros JSON:
"${description}"`;

        const { text } = await ai.generate(prompt);

        // Extract JSON from response (may have markdown fences)
        let jsonStr = text.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const parsed = JSON.parse(jsonStr);

        // Validate structure
        if (!parsed.operator || !Array.isArray(parsed.conditions)) {
            return { criteria: null, error: 'Formato inválido retornado pela IA.' };
        }

        // Validate operator
        if (!['AND', 'OR'].includes(parsed.operator)) {
            parsed.operator = 'AND';
        }

        // Validate conditions
        const validFields = ['name', 'email', 'phone_number_jid', 'tags', 'last_activity', 'created_at', 'lead_score', 'owner_id'];
        const validOperators = ['equals', 'contains', 'gt', 'lt', 'gte', 'lte', 'is_set', 'is_not_set'];

        parsed.conditions = parsed.conditions.filter((c: any) => {
            if (!c.field || !c.operator) return false;
            if (!validFields.includes(c.field) && !c.field.startsWith('custom_field_')) return false;
            if (!validOperators.includes(c.operator)) return false;
            return true;
        });

        if (parsed.conditions.length === 0) {
            return { criteria: null, error: 'Não foi possível gerar filtros a partir da descrição.' };
        }

        return { criteria: parsed as CriteriaGroup };
    } catch (error: any) {
        console.error('[NLP_SEGMENT] Error:', error);
        return { criteria: null, error: 'Falha ao processar linguagem natural.' };
    }
}
