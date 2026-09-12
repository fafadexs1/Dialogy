'use server';
import { requestPlatformJson } from '@/services/ai/platform-json';


import { z } from 'zod';
import { getCurrentUser } from './user';
import { hasWorkspacePermission } from '@/lib/workspace-permissions';
import type { CriteriaGroup } from '@/lib/crm-query-builder';
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

        const user=await getCurrentUser();
        if(!user?.activeWorkspaceId||!await hasWorkspacePermission(user.id,user.activeWorkspaceId,'crm:view')) throw new Error('Acesso negado.');
        const parsed=await requestPlatformJson({workspaceId:user.activeWorkspaceId,model:'',apiKey:'',schema:z.object({operator:z.enum(['AND','OR']),conditions:z.array(z.object({field:z.string(),operator:z.string(),value:z.string().optional()}))}),
          schemaName:'dialogy_crm_segment',jsonSchema:{type:'object',properties:{operator:{type:'string',enum:['AND','OR']},conditions:{type:'array',items:{type:'object',properties:{field:{type:'string'},operator:{type:'string'},value:{type:'string'}},required:['field','operator'],additionalProperties:false}}},required:['operator','conditions'],additionalProperties:false},
          systemPrompt:SYSTEM_PROMPT,userPrompt:prompt,maxTokens:2000,timeoutMs:30000});

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
