import type { KnowledgeBaseDocument } from '@/lib/types';

export type AutopilotIntentName =
    | 'catalogo_planos'
    | 'unknown';

export type AutopilotIntentResolution = {
    intent: AutopilotIntentName;
    confidence: number;
    reason: string;
    sourceDocumentId?: string;
    sourceDocumentName?: string;
    officialResponse?: string;
};

const PLAN_CATALOG_MAX_CHARS = 2600;

function normalizeForIntent(value: string): string {
    return value
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function getDocumentCategory(document: KnowledgeBaseDocument): string {
    const rawDocument = document as KnowledgeBaseDocument & {
        category?: string | null;
        type?: string | null;
        kind?: string | null;
        tags?: string[] | null;
    };

    return [
        rawDocument.category,
        rawDocument.type,
        rawDocument.kind,
        ...(Array.isArray(rawDocument.tags) ? rawDocument.tags : []),
        document.name,
    ]
        .filter(Boolean)
        .join(' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}

export function isInternetPlanInquiry(message: string, chatHistory = ''): boolean {
    const normalized = normalizeForIntent(message);
    const normalizedHistory = normalizeForIntent(chatHistory);

    if (/\b(?:me\s+)?manda(?:r)?\s+todos\b/.test(normalized) || /\btodos\s+os\s+planos\b/.test(normalized)) {
        return true;
    }

    const isAffirmativeFollowUp = /\b(sim|quero|pode|manda|mandar|mostra|mostrar|envia|enviar|conhecer)\b/.test(normalized);
    const recentPlanOffer = /\b(?:deseja|quer|gostaria).{0,80}\b(?:conhecer|ver|receber).{0,80}\b(?:planos?|internet|fibra)\b/.test(
        normalizedHistory.slice(-1200)
    );
    if (isAffirmativeFollowUp && recentPlanOffer) {
        return true;
    }

    return (
        /\b(planos?|pacotes?|internet|fibra|mega|megas|assinar|contratar|valor(?:es)?|precos?)\b/.test(normalized) &&
        /\b(mostrar|mostra|manda|mandar|envia|enviar|ver|conhecer|quais|todos|opcoes|opcao|lista|tabela|sim)\b/.test(normalized)
    );
}

export function cleanKnowledgeCatalogContent(content: string): string {
    let normalized = content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, '').trimStart())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    const firstCatalogLine = normalized.search(/(?:[\p{Extended_Pictographic}]|\*)\s*\*?.{0,80}(?:PLANOS?|PROMO|CONHE[ÇC]A|INTERNET|FIBRA)/iu);
    if (firstCatalogLine > 0) {
        normalized = normalized.slice(firstCatalogLine).trim();
    }

    return normalized;
}

function scorePlanCatalogDocument(document: KnowledgeBaseDocument, content: string): number {
    const category = getDocumentCategory(document);
    const haystack = normalizeForIntent(`${document.name || ''}\n${content}`);
    let score = 0;

    if (/\bcatalogo[_\s-]*planos?\b/.test(category)) score += 120;
    if (/\bplanos?\s+de\s+internet\b/.test(category)) score += 100;
    if (/\b(?:precos?|valores?)\s+(?:dos?\s+)?planos?\b/.test(category)) score += 90;
    if (/\bplanos?\b/.test(haystack)) score += 30;
    if (/\b(?:internet|fibra|mega|megas|canais)\b/.test(haystack)) score += 30;
    if (/\bR\$\s*\d+/i.test(content)) score += 30;
    if (content.includes('\n\n')) score += 10;
    if (/\bpromocao\b/.test(category) || /\bpromocao\b/.test(haystack.slice(0, 160))) score -= 35;

    return score;
}

export function findOfficialPlanCatalog(
    documents: KnowledgeBaseDocument[] | null | undefined
): { content: string; document: KnowledgeBaseDocument; score: number } | null {
    const candidates = (documents || [])
        .map((document) => {
            const content = cleanKnowledgeCatalogContent(String(document.content || ''));
            return {
                document,
                content,
                score: scorePlanCatalogDocument(document, content),
            };
        })
        .filter(({ score }) => score >= 80)
        .sort((left, right) => right.score - left.score || right.content.length - left.content.length);

    const best = candidates[0];
    if (!best?.content) return null;

    return {
        ...best,
        content: best.content.length > PLAN_CATALOG_MAX_CHARS
            ? best.content.slice(0, PLAN_CATALOG_MAX_CHARS).trim()
            : best.content,
    };
}

export function resolveAutopilotIntent(input: {
    customerMessage: string;
    chatHistory?: string;
    knowledgeDocuments?: KnowledgeBaseDocument[] | null;
}): AutopilotIntentResolution {
    if (isInternetPlanInquiry(input.customerMessage, input.chatHistory || '')) {
        const catalog = findOfficialPlanCatalog(input.knowledgeDocuments);
        if (catalog) {
            return {
                intent: 'catalogo_planos',
                confidence: 0.98,
                reason: 'Cliente pediu planos/valores e existe catalogo oficial na base.',
                sourceDocumentId: catalog.document.id,
                sourceDocumentName: catalog.document.name,
                officialResponse: catalog.content,
            };
        }

        return {
            intent: 'catalogo_planos',
            confidence: 0.72,
            reason: 'Cliente pediu planos/valores, mas nao foi encontrado catalogo oficial elegivel.',
        };
    }

    return {
        intent: 'unknown',
        confidence: 0,
        reason: 'Nenhuma intencao deterministica reconhecida.',
    };
}
