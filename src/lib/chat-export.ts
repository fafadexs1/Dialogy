import { Chat, Message, User } from './types';
import { resolveClientMediaUrl } from './storage-url';

type ExportSenderKind = 'user' | 'contact' | 'system_agent';

type ExportSenderInfo = {
    name: string;
    avatarUrl?: string;
    initial: string;
    kind: ExportSenderKind;
};

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function pickString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                return trimmed;
            }
        }
    }
    return undefined;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value: string): string {
    return escapeHtml(value).replace(/`/g, '&#096;');
}

function normalizeAssetUrl(raw?: string): string | undefined {
    if (!raw || typeof raw !== 'string') return undefined;

    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    if (
        trimmed.startsWith('data:') ||
        trimmed.startsWith('blob:') ||
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://')
    ) {
        return trimmed;
    }

    if (trimmed.startsWith('//')) {
        return `https:${trimmed}`;
    }

    if (typeof window !== 'undefined') {
        try {
            return new URL(trimmed, window.location.origin).toString();
        } catch {
            return undefined;
        }
    }

    return undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
                return;
            }
            reject(new Error('Unable to read blob as data URL.'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Unable to read blob.'));
        reader.readAsDataURL(blob);
    });
}

async function inlineAsset(
    url: string | undefined,
    cache: Map<string, Promise<string | undefined>>
): Promise<string | undefined> {
    if (!url) return undefined;
    if (url.startsWith('data:')) return url;

    if (!cache.has(url)) {
        cache.set(
            url,
            (async () => {
                try {
                    const requestInit: RequestInit = {};

                    if (typeof window !== 'undefined') {
                        const parsed = new URL(url, window.location.origin);
                        if (parsed.origin === window.location.origin) {
                            requestInit.credentials = 'include';
                        }
                    }

                    const response = await fetch(url, requestInit);
                    if (!response.ok) {
                        return url;
                    }

                    const blob = await response.blob();
                    if (!blob.size) {
                        return url;
                    }

                    return await blobToDataUrl(blob);
                } catch {
                    return url;
                }
            })()
        );
    }

    return cache.get(url)!;
}

function getInitial(name: string): string {
    const match = name.trim().match(/[A-Za-z0-9]/);
    return (match?.[0] ?? '?').toUpperCase();
}

function formatExportText(text: string, isOutgoing: boolean): string {
    let formatted = escapeHtml(text);

    formatted = formatted
        .replace(/```([\s\S]*?)```/g, '<pre class="message-code"><code>$1</code></pre>')
        .replace(/(\s|^)\*(.*?)\*(?=\s|$|[.,:;!?])/g, '$1<strong>$2</strong>')
        .replace(/(\s|^)_(.*?)_(?=\s|$|[.,:;!?])/g, '$1<em>$2</em>')
        .replace(/(\s|^)~(.*?)~(?=\s|$|[.,:;!?])/g, '$1<s>$2</s>');

    formatted = formatted.replace(URL_REGEX, (url) => {
        const classes = isOutgoing ? 'message-link outgoing' : 'message-link incoming';
        return `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener noreferrer" class="${classes}">${escapeHtml(url)}</a>`;
    });

    return formatted.replace(/\n/g, '<br />');
}

function formatDateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return 'Data desconhecida';
    }

    return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function formatTimeLabel(message: Message): string {
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    return pickString(message.timestamp, '--:--') ?? '--:--';
}

function normalizeStatus(status?: string): string {
    return (status || '').trim().toUpperCase();
}

function renderSingleCheck(title: string, colorClass: string): string {
    return `
        <span class="message-status ${colorClass}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">
            <svg viewBox="0 0 14 12" aria-hidden="true">
                <path d="M1.5 6.5L4.7 9.7L12 1.8" />
            </svg>
        </span>
    `;
}

function renderDoubleCheck(title: string, colorClass: string): string {
    return `
        <span class="message-status ${colorClass}" title="${escapeAttribute(title)}" aria-label="${escapeAttribute(title)}">
            <svg viewBox="0 0 18 12" aria-hidden="true">
                <path d="M1 6.5L4.2 9.7L10 1.8" />
                <path d="M8 6.5L11.2 9.7L17 1.8" />
            </svg>
        </span>
    `;
}

function renderStatusHtml(message: Message): string {
    if (!message.from_me || message.status === 'deleted' || message.optimistic) {
        return '';
    }

    const status = normalizeStatus(message.api_message_status);

    if (status === 'FAILED' || status === 'ERROR') {
        return '<span class="message-status-chip failed">Falha</span>';
    }

    if (status === 'READ' || status === 'PLAYED') {
        return renderDoubleCheck('Lida', 'status-read');
    }

    if (status === 'DELIVERED' || status === 'SENT') {
        return renderDoubleCheck('Entregue', 'status-delivered');
    }

    if (status === 'PENDING') {
        return renderSingleCheck('Pendente', 'status-pending');
    }

    return renderSingleCheck('Enviada', 'status-pending');
}

function resolveSenderInfo(message: Message, chat: Chat, currentUser: User): ExportSenderInfo {
    const metadataRecord = message.metadata as Record<string, unknown> | undefined;
    const isSystemAgent =
        message.sender?.type === 'system_agent' ||
        message.metadata?.sentBy === 'system_agent' ||
        message.metadata?.sentBy === 'autopilot';

    const systemAgentName = pickString(
        metadataRecord?.systemAgentName,
        metadataRecord?.system_agent_name,
        metadataRecord?.senderName,
        metadataRecord?.sender_name,
        metadataRecord?.assistantName,
        metadataRecord?.assistant_name,
        metadataRecord?.agent_name,
        metadataRecord?.from_system_agent_name
    );

    const systemAgentAvatar = normalizeAssetUrl(
        pickString(
            metadataRecord?.systemAgentAvatar,
            metadataRecord?.system_agent_avatar,
            metadataRecord?.systemAgentAvatarUrl,
            metadataRecord?.system_agent_avatar_url,
            metadataRecord?.senderAvatar,
            metadataRecord?.sender_avatar,
            metadataRecord?.senderAvatarUrl,
            metadataRecord?.sender_avatar_url,
            metadataRecord?.assistantAvatar,
            metadataRecord?.assistant_avatar,
            metadataRecord?.assistantAvatarUrl,
            metadataRecord?.assistant_avatar_url,
            metadataRecord?.agent_avatar,
            metadataRecord?.agent_avatar_url,
            metadataRecord?.from_system_agent_avatar,
            metadataRecord?.from_system_agent_avatar_url
        )
    );

    if (message.from_me) {
        const name =
            pickString(
                message.sender?.name,
                systemAgentName,
                isSystemAgent ? 'Assistente Virtual' : undefined,
                currentUser.name,
                'Voce'
            ) ?? 'Voce';

        const avatarUrl = normalizeAssetUrl(
            pickString(
                (message.sender as any)?.avatar,
                (message.sender as any)?.avatar_url,
                systemAgentAvatar,
                currentUser.avatar,
                currentUser.avatar_url
            )
        );

        return {
            name,
            avatarUrl,
            initial: getInitial(name),
            kind: isSystemAgent ? 'system_agent' : 'user',
        };
    }

    const contactName = pickString(message.sender?.name, chat.contact.name, 'Contato') ?? 'Contato';
    const contactAvatar = normalizeAssetUrl(
        pickString((message.sender as any)?.avatar, (message.sender as any)?.avatar_url, chat.contact.avatar_url)
    );

    return {
        name: contactName,
        avatarUrl: contactAvatar,
        initial: getInitial(contactName),
        kind: 'contact',
    };
}

function renderAvatarHtml(avatarUrl: string | undefined, sender: ExportSenderInfo, className: string): string {
    if (avatarUrl) {
        return `
            <div class="${className}">
                <img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(sender.name)}" />
            </div>
        `;
    }

    return `
        <div class="${className}">
            <div class="${className}-placeholder">${escapeHtml(sender.initial)}</div>
        </div>
    `;
}

async function renderMediaHtml(
    message: Message,
    cache: Map<string, Promise<string | undefined>>
): Promise<string> {
    const rawMediaUrl = pickString(message.mediaUrl, message.metadata?.mediaUrl, message.metadata?.thumbnail);
    const mediaUrl = normalizeAssetUrl(resolveClientMediaUrl(rawMediaUrl, { kind: 'media' }));
    const imageUrl = normalizeAssetUrl(resolveClientMediaUrl(rawMediaUrl, { kind: 'image' }));
    const fileName = pickString(message.metadata?.fileName, message.metadata?.mimetype);
    const mimetype = pickString(message.metadata?.mimetype) || '';
    const isImage = message.type === 'image' || mimetype.startsWith('image/');
    const isVideo = message.type === 'video' || mimetype.startsWith('video/');
    const isAudio = message.type === 'audio' || mimetype.startsWith('audio/');
    const isDocument = message.type === 'document' || (!isImage && !isVideo && !isAudio && Boolean(mediaUrl));

    if (isImage && imageUrl) {
        const embeddedImageUrl = await inlineAsset(imageUrl, cache);
        const href = embeddedImageUrl || imageUrl;
        return `
            <a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" class="media-link">
                <img src="${escapeAttribute(href)}" class="media-image" alt="Imagem da conversa" />
            </a>
        `;
    }

    if ((isVideo || isAudio || isDocument) && mediaUrl) {
        const label =
            isVideo
                ? 'Video'
                : isAudio
                    ? 'Audio'
                    : 'Arquivo';
        const embeddedMediaUrl = mediaUrl.startsWith('data:') ? mediaUrl : undefined;
        const href = embeddedMediaUrl || mediaUrl;

        return `
            <a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer" class="file-card">
                <span class="file-card-label">${label}</span>
                <span class="file-card-name">${escapeHtml(fileName || 'Abrir anexo')}</span>
            </a>
        `;
    }

    return '';
}

export async function generateChatHtml(chat: Chat, currentUser: User, exportMessages?: Message[]): Promise<string> {
    const messages = exportMessages?.length ? exportMessages : (chat.messages || []);
    const contactName = pickString(chat.contact.name, 'Contato') ?? 'Contato';
    const contactPhone = pickString(chat.contact.phone, chat.contact.phone_number_jid, 'Sem identificacao') ?? 'Sem identificacao';
    const instanceName = pickString(chat.instance_name);
    const protocol = pickString(chat.protocol);
    const exportedAt = new Date().toLocaleString('pt-BR');
    const assetCache = new Map<string, Promise<string | undefined>>();

    const contactAvatarUrl = normalizeAssetUrl(chat.contact.avatar_url);
    const headerAvatar = await inlineAsset(contactAvatarUrl, assetCache);

    const avatarCandidates = new Set<string>();
    if (contactAvatarUrl) avatarCandidates.add(contactAvatarUrl);

    for (const message of messages) {
        const sender = resolveSenderInfo(message, chat, currentUser);
        if (sender.avatarUrl) {
            avatarCandidates.add(sender.avatarUrl);
        }
    }

    await Promise.all(Array.from(avatarCandidates, (url) => inlineAsset(url, assetCache)));

    const styles = `
    <style>
        :root {
            color-scheme: light;
            --bg: #e9edef;
            --panel: #efeae2;
            --header: #202c33;
            --header-muted: #8696a0;
            --incoming: #ffffff;
            --outgoing: #d9fdd3;
            --text: #111b21;
            --muted: #667781;
            --line: rgba(17, 27, 33, 0.08);
            --teal: #128c7e;
            --teal-dark: #005c4b;
            --blue: #53bdeb;
            --gray-check: #8696a0;
            --danger: #c62828;
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            padding: 20px;
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .chat-container {
            max-width: 860px;
            margin: 0 auto;
            background: var(--panel);
            border-radius: 18px;
            overflow: hidden;
            box-shadow: 0 16px 45px rgba(0, 0, 0, 0.12);
        }
        .chat-header {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px 18px;
            background: var(--header);
            color: #fff;
        }
        .header-avatar,
        .header-avatar-placeholder {
            width: 44px;
            height: 44px;
            border-radius: 999px;
            overflow: hidden;
            flex-shrink: 0;
            background: #6d7f8c;
        }
        .header-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .header-avatar-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 16px;
            font-weight: 700;
        }
        .header-main {
            min-width: 0;
            flex: 1;
        }
        .header-main h1 {
            margin: 0;
            font-size: 17px;
            font-weight: 600;
        }
        .header-subtitle {
            margin-top: 3px;
            color: var(--header-muted);
            font-size: 12px;
        }
        .header-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 10px 18px;
            background: #f7f9fa;
            border-bottom: 1px solid var(--line);
        }
        .meta-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            background: #fff;
            border: 1px solid var(--line);
            color: var(--muted);
            font-size: 11px;
        }
        .meta-pill strong {
            color: var(--text);
            font-weight: 600;
        }
        .chat-body {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 18px;
        }
        .date-divider,
        .system-message {
            align-self: center;
            max-width: 92%;
            padding: 6px 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.88);
            color: #54656f;
            font-size: 12px;
            box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.08);
            text-align: center;
        }
        .system-message {
            background: #fff6d5;
        }
        .message-row {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            max-width: 86%;
        }
        .message-row.from-me {
            align-self: flex-end;
            flex-direction: row-reverse;
        }
        .message-row.from-contact {
            align-self: flex-start;
        }
        .msg-avatar,
        .msg-avatar-placeholder {
            width: 30px;
            height: 30px;
            border-radius: 999px;
            overflow: hidden;
            flex-shrink: 0;
            background: #dfe5e7;
            border: 1px solid rgba(0, 0, 0, 0.08);
        }
        .msg-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .msg-avatar-placeholder {
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            color: #5f6b70;
        }
        .message-bubble {
            min-width: 0;
        }
        .message {
            border-radius: 18px;
            padding: 8px 10px 9px;
            box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.13);
            word-break: break-word;
        }
        .message.from-me {
            background: var(--outgoing);
            border-top-right-radius: 4px;
        }
        .message.from-contact {
            background: var(--incoming);
            border-top-left-radius: 4px;
        }
        .message-sender {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 5px;
        }
        .message-row.from-me .message-sender {
            justify-content: flex-end;
        }
        .message-sender-name {
            font-size: 11px;
            font-weight: 700;
            color: var(--teal);
        }
        .message-row.from-me .message-sender-name {
            color: var(--teal-dark);
        }
        .sender-kind-chip {
            border-radius: 999px;
            padding: 2px 6px;
            background: rgba(0, 92, 75, 0.08);
            color: var(--teal-dark);
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        .message-content {
            font-size: 14px;
            line-height: 1.45;
        }
        .message-text {
            white-space: normal;
        }
        .message-code {
            margin: 8px 0 0;
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(17, 27, 33, 0.06);
            overflow-x: auto;
            font-size: 12px;
            line-height: 1.4;
        }
        .message-link {
            text-decoration: underline;
            word-break: break-all;
        }
        .message-link.incoming {
            color: #1264a3;
        }
        .message-link.outgoing {
            color: #084c61;
        }
        .media-link {
            display: block;
            margin-bottom: 6px;
        }
        .media-image {
            display: block;
            max-width: 100%;
            border-radius: 14px;
        }
        .file-card {
            display: flex;
            flex-direction: column;
            gap: 2px;
            margin-bottom: 6px;
            padding: 10px 12px;
            border-radius: 14px;
            background: rgba(17, 27, 33, 0.06);
            text-decoration: none;
            color: inherit;
        }
        .file-card-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--muted);
        }
        .file-card-name {
            font-size: 13px;
            font-weight: 600;
        }
        .message-nav {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 6px;
            margin-top: 5px;
            color: var(--muted);
            font-size: 11px;
        }
        .message-status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 12px;
            color: var(--gray-check);
        }
        .message-status svg {
            width: 16px;
            height: 12px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.7;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .status-read {
            color: var(--blue);
        }
        .status-delivered,
        .status-pending {
            color: var(--gray-check);
        }
        .message-status-chip {
            display: inline-flex;
            align-items: center;
            padding: 2px 6px;
            border-radius: 999px;
            font-size: 10px;
            font-weight: 700;
        }
        .message-status-chip.failed {
            background: rgba(198, 40, 40, 0.12);
            color: var(--danger);
        }
        .print-btn {
            position: fixed;
            right: 20px;
            bottom: 20px;
            border: none;
            border-radius: 999px;
            background: #00a884;
            color: #fff;
            padding: 12px 18px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 12px 25px rgba(0, 0, 0, 0.2);
        }
        @media (max-width: 700px) {
            body {
                padding: 0;
            }
            .chat-container {
                border-radius: 0;
            }
            .chat-body {
                padding: 14px;
            }
            .message-row {
                max-width: 94%;
            }
            .print-btn {
                right: 14px;
                bottom: 14px;
            }
        }
        @media print {
            body {
                padding: 0;
                background: #fff;
            }
            .chat-container {
                max-width: 100%;
                border-radius: 0;
                box-shadow: none;
            }
            .print-btn {
                display: none;
            }
        }
    </style>
    `;

    let html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Conversa - ${escapeHtml(contactName)}</title>
        ${styles}
    </head>
    <body>
        <button class="print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
        <div class="chat-container">
            <div class="chat-header">
                ${renderAvatarHtml(
                    headerAvatar,
                    { name: contactName, avatarUrl: headerAvatar, initial: getInitial(contactName), kind: 'contact' },
                    'header-avatar'
                )}
                <div class="header-main">
                    <h1>${escapeHtml(contactName)}</h1>
                    <div class="header-subtitle">
                        ${escapeHtml(contactPhone)}
                        ${instanceName ? ` &bull; ${escapeHtml(instanceName)}` : ''}
                    </div>
                </div>
            </div>
            <div class="header-meta">
                <span class="meta-pill"><strong>Exportado em</strong> ${escapeHtml(exportedAt)}</span>
                <span class="meta-pill"><strong>Mensagens</strong> ${messages.length}</span>
                <span class="meta-pill"><strong>Exportado por</strong> ${escapeHtml(currentUser.name)}</span>
                ${protocol ? `<span class="meta-pill"><strong>Protocolo</strong> ${escapeHtml(protocol)}</span>` : ''}
            </div>
            <div class="chat-body" id="chat-body">
    `;

    let lastDate = '';

    for (const message of messages) {
        const currentDate = formatDateLabel(message.createdAt);
        if (currentDate !== lastDate) {
            html += `<div class="date-divider">${escapeHtml(currentDate)}</div>`;
            lastDate = currentDate;
        }

        const timeLabel = formatTimeLabel(message);

        if (message.type === 'system') {
            const systemContent = message.content?.trim() ? formatExportText(message.content, false) : 'Evento do sistema';
            html += `<div class="system-message">${systemContent} &bull; ${escapeHtml(timeLabel)}</div>`;
            continue;
        }

        const sender = resolveSenderInfo(message, chat, currentUser);
        const embeddedAvatar = await inlineAsset(sender.avatarUrl, assetCache);
        const messageText = message.content?.trim()
            ? `<div class="message-text">${formatExportText(message.content, Boolean(message.from_me))}</div>`
            : '';
        const mediaHtml = await renderMediaHtml(message, assetCache);
        const senderChip =
            sender.kind === 'system_agent'
                ? '<span class="sender-kind-chip">IA</span>'
                : sender.kind === 'user'
                    ? '<span class="sender-kind-chip">Agente</span>'
                    : '';

        html += `
            <div class="message-row ${message.from_me ? 'from-me' : 'from-contact'}">
                ${renderAvatarHtml(embeddedAvatar, sender, 'msg-avatar')}
                <div class="message-bubble">
                    <div class="message ${message.from_me ? 'from-me' : 'from-contact'}">
                        <div class="message-sender">
                            <span class="message-sender-name">${escapeHtml(sender.name)}</span>
                            ${senderChip}
                        </div>
                        <div class="message-content">
                            ${mediaHtml}
                            ${messageText || (!mediaHtml ? '<div class="message-text"><em>Mensagem sem conteudo</em></div>' : '')}
                        </div>
                    </div>
                    <div class="message-nav">
                        <span>${escapeHtml(timeLabel)}</span>
                        ${renderStatusHtml(message)}
                    </div>
                </div>
            </div>
        `;
    }

    html += `
                <div id="chat-end" class="chat-end" aria-hidden="true"></div>
            </div>
        </div>
        <script>
            (function () {
                function scrollToLatestMessage() {
                    var end = document.getElementById('chat-end');
                    if (end && typeof end.scrollIntoView === 'function') {
                        end.scrollIntoView({ block: 'end' });
                        return;
                    }
                    window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
                }

                window.addEventListener('load', function () {
                    scrollToLatestMessage();
                    window.setTimeout(scrollToLatestMessage, 100);
                    window.setTimeout(scrollToLatestMessage, 500);
                });
            })();
        </script>
    </body>
    </html>
    `;

    return html;
}
