export interface SGPPayload {
    contactExternalID?: string;
    to: string;
    attendance_id?: string;
    is_hsm?: number;
    close_session?: number;
    channel_id?: string;
    agent?: string;
    platform_id?: string;
    instance: string;
    token: string;
    message: any;
    type?: string;
}

export interface AgentSendQuotedPayload {
    key?: {
        id?: string;
    };
    message?: Record<string, any>;
}

export interface AgentSendListPayload {
    title?: string;
    description?: string;
    buttonText: string;
    footerText?: string;
    sections: Array<{
        title: string;
        rows: Array<{
            title: string;
            description?: string;
            rowId: string;
        }>;
    }>;
    delay?: number;
    quoted?: AgentSendQuotedPayload;
    mentionsEveryOne?: boolean;
    mentioned?: string[];
}

export type AgentSendButtonType = 'reply' | 'copy' | 'url' | 'call' | 'pix';

export interface AgentSendButton {
    type: AgentSendButtonType;
    displayText?: string;
    id?: string;
    url?: string;
    copyCode?: string;
    phoneNumber?: string;
    currency?: string;
    name?: string;
    keyType?: 'phone' | 'email' | 'cpf' | 'cnpj' | 'random';
    key?: string;
}

export interface AgentSendButtonsPayload {
    title: string;
    description?: string;
    footer?: string;
    thumbnailUrl?: string;
    buttons: AgentSendButton[];
    delay?: number;
    quoted?: AgentSendQuotedPayload;
    mentionsEveryOne?: boolean;
    mentioned?: string[];
}

export interface AgentSendPayload {
    type?: 'text' | 'media' | 'template' | 'list' | 'buttons';
    chatId?: string;
    phoneNumber?: string; // JID format
    content?: string; // For text messages
    skipUserSignature?: boolean;
    media?: any[]; // For media messages
    instance?: string;
    template?: {
        name: string;
        language: string;
        components: any[];
        renderedContent?: string;
    };
    list?: AgentSendListPayload;
    buttonsPayload?: AgentSendButtonsPayload;
    title?: string;
    description?: string;
    buttonText?: string;
    footerText?: string;
    footer?: string;
    thumbnailUrl?: string;
    sections?: AgentSendListPayload['sections'];
    buttons?: AgentSendButton[];
    delay?: number;
    quoted?: AgentSendQuotedPayload;
    mentionsEveryOne?: boolean;
    mentioned?: string[];
}

export function normalizeAgentListPayload(body: any): AgentSendListPayload | undefined {
    if (!body || typeof body !== 'object') {
        return undefined;
    }

    const listSource = body.list && typeof body.list === 'object' ? body.list : {};
    const normalized = {
        title: listSource.title ?? body.title,
        description: listSource.description ?? body.description,
        buttonText: listSource.buttonText ?? body.buttonText,
        footerText: listSource.footerText ?? body.footerText,
        sections: listSource.sections ?? body.sections,
        delay: listSource.delay ?? body.delay,
        quoted: listSource.quoted ?? body.quoted,
        mentionsEveryOne: listSource.mentionsEveryOne ?? body.mentionsEveryOne,
        mentioned: listSource.mentioned ?? body.mentioned,
    };

    if (!normalized.buttonText || !Array.isArray(normalized.sections)) {
        return undefined;
    }

    return normalized;
}

export function normalizeAgentButtonsPayload(body: any): AgentSendButtonsPayload | undefined {
    if (!body || typeof body !== 'object') {
        return undefined;
    }

    const source =
        body.buttonsPayload && typeof body.buttonsPayload === 'object'
            ? body.buttonsPayload
            : (body.buttons && !Array.isArray(body.buttons) && typeof body.buttons === 'object' ? body.buttons : {});

    const buttons = Array.isArray(source.buttons)
        ? source.buttons
        : (Array.isArray(body.buttons) ? body.buttons : undefined);

    if (!Array.isArray(buttons) || buttons.length === 0) {
        return undefined;
    }

    const title = source.title ?? body.title;
    if (typeof title !== 'string' || title.trim().length === 0) {
        return undefined;
    }

    return {
        title,
        description: source.description ?? body.description,
        // A Evolution usa "footer" aqui (e "footerText" em listas).
        footer: source.footer ?? source.footerText ?? body.footer ?? body.footerText,
        thumbnailUrl: source.thumbnailUrl ?? body.thumbnailUrl,
        buttons,
        delay: source.delay ?? body.delay,
        quoted: source.quoted ?? body.quoted,
        mentionsEveryOne: source.mentionsEveryOne ?? body.mentionsEveryOne,
        mentioned: source.mentioned ?? body.mentioned,
    };
}

export function isSGPPayload(body: any): body is SGPPayload {
    if (!body || typeof body !== 'object') return false;

    const hasDestination = 'to' in body;
    const hasInstance = 'instance' in body;
    const hasMessage = 'message' in body;
    const hasTemplateInfo =
        'template' in body ||
        (typeof body.message === 'object' && body.message !== null && 'template' in body.message);

    return hasDestination && hasInstance && (hasMessage || hasTemplateInfo);
}

export function adaptSGPPayload(body: SGPPayload): AgentSendPayload {
    const msg = body.message;
    console.log('[SGP] Adapting payload. Message:', msg);

    const buildTemplatePayload = (source: any): AgentSendPayload | null => {
        const template = source?.template;
        if (!template || !template.name || !template.language) return null;

        const components =
            template.components ||
            (template.parameters ? [{ type: 'body', parameters: template.parameters }] : undefined);

        if (!components) return null;

        return {
            type: 'template',
            phoneNumber: (body as any).to,
            instance: source.instance || (body as any).instance,
            template: {
                name: template.name,
                language: template.language,
                components,
            },
        };
    };

    // Message already comes as structured object
    if (msg && typeof msg === 'object') {
        const tpl = buildTemplatePayload(msg);
        if (tpl) return tpl;
    }

    if (typeof msg === 'string') {
        const tryParse = (str: string): any => {
            // Clean up the string: remove newlines, extra spaces
            let cleanStr = str.trim().replace(/[\r\n]+/g, ' ');

            // Fix common malformations like missing commas between object properties or array items
            const repairCommonJsonIssues = (input: string) => {
                let repaired = input;
                // Add missing commas between object properties: "name":"x" "language":"y"
                repaired = repaired.replace(
                    /("[-\w]+"(?:\s*):(?:\s*)"[^"]+")\s+(?="[-\w]+"\s*:)/g,
                    '$1, '
                );
                // Add missing commas between objects inside arrays: } {
                repaired = repaired.replace(/}\s+(?={)/g, '}, ');
                return repaired;
            };

            cleanStr = repairCommonJsonIssues(cleanStr);

            const attempt = (s: string) => {
                try {
                    return JSON.parse(s);
                } catch (e) {
                    return null;
                }
            };

            // 1. Try as is
            let res = attempt(cleanStr);
            if (res) return res;

            // 2. Try wrapping in {}
            // If it doesn't start with {, assume it's a list of properties
            let base = cleanStr;
            let needsWrapping = !cleanStr.startsWith('{');

            // Remove trailing comma if present before we start repairing
            if (base.trim().endsWith(',')) {
                base = base.trim().slice(0, -1);
            }

            if (needsWrapping) {
                res = attempt(`{${base}}`);
                if (res) return res;
            }

            // 3. Try repairing truncation
            // We need to be smart about trailing commas inside the structure too.
            // But simple regex replacement of ", *" with "" at the end might help.

            const repairs = ['}', ']}', '}}', ']}}', ']} }', '} }', '}]}', '}]}}'];

            for (const repair of repairs) {
                let candidateBase = base;
                // If the base ends with a comma (after potential previous cleanup), remove it
                if (candidateBase.trim().endsWith(',')) {
                    candidateBase = candidateBase.trim().slice(0, -1);
                }

                // If needs wrapping, we put the repair INSIDE the wrapper
                let candidate: string;
                if (needsWrapping) {
                    candidate = `{${candidateBase}${repair}}`;
                } else {
                    candidate = `${candidateBase}${repair}`;
                }

                res = attempt(candidate);
                if (res) {
                    console.log(`[SGP] Repaired JSON with suffix "${repair}"`);
                    return res;
                }
            }

            return null;
        };

        // 1. Try parsing as is (for GET requests where it's already decoded)
        let parsedMessage = tryParse(msg);

        // 2. If failed, try decoding (for POST requests where it might be encoded)
        if (!parsedMessage) {
            try {
                // Handle + as space for form-urlencoded compatibility
                const toDecode = msg.replace(/\+/g, '%20');
                const decoded = decodeURIComponent(toDecode);
                console.log('[SGP] Decoded message:', decoded);
                parsedMessage = tryParse(decoded);
            } catch (e) {
                console.error('[SGP] Decoding error:', e);
            }
        }

        // 3. If still failed, try decoding without replacing + (just in case)
        if (!parsedMessage) {
            try {
                const decoded = decodeURIComponent(msg);
                parsedMessage = tryParse(decoded);
            } catch (e) {
                // Ignore
            }
        }

        if (parsedMessage) {
            console.log('[SGP] Parsed message:', parsedMessage);
        } else {
            console.warn('[SGP] Failed to parse message.');
        }

        if (parsedMessage && parsedMessage.type === 'template' && parsedMessage.template) {
            const tpl = buildTemplatePayload(parsedMessage);
            if (tpl) {
                return tpl;
            }
        }

        // Heuristic fallback: detect template shape in raw string even if JSON parsing failed
        const isTemplateLike = /"type"\s*:\s*"template"/i.test(msg) && /"template"\s*:\s*{/.test(msg);
        if (!parsedMessage && isTemplateLike) {
            const nameMatch = /"name"\s*:\s*"([^"]+)"/i.exec(msg);
            const languageMatch = /"language"\s*:\s*"([^"]+)"/i.exec(msg);
            const instanceMatch = /"instance"\s*:\s*"([^"]+)"/i.exec(msg);

            const parameters: { type: 'text'; text: string }[] = [];
            const paramTextRegex = /"text"\s*:\s*"([^"]*)"/gi;
            let pMatch: RegExpExecArray | null;
            while ((pMatch = paramTextRegex.exec(msg)) !== null) {
                parameters.push({ type: 'text', text: pMatch[1] });
            }

            if (nameMatch && parameters.length > 0) {
                const tpl = buildTemplatePayload({
                    instance: instanceMatch?.[1],
                    template: {
                        name: nameMatch[1],
                        language: languageMatch?.[1] || 'pt_BR',
                        parameters,
                    }
                });
                if (tpl) return tpl;
            }
        }
    }

    // Fallback: if the whole body is already in template shape
    if ((body as any).type === 'template' && (body as any).template) {
        const tpl = buildTemplatePayload(body as any);
        if (tpl) {
            return tpl;
        }
    }

    return {
        type: 'text',
        phoneNumber: body.to,
        content: body.message,
        instance: body.instance,
    };
}
