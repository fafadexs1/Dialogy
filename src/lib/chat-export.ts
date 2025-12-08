import { Chat, Message, User } from "./types";

export function generateChatHtml(chat: Chat, currentUser: User): string {
    const messages = chat.messages || [];
    const contactName = chat.contact.name;
    const contactPhone = chat.contact.phone;
    const contactAvatar = chat.contact.avatar_url;
    const instanceName = chat.instance_name;

    const styles = `
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f0f2f5;
            margin: 0;
            padding: 20px;
            color: #111b21;
        }
        .chat-container {
            max-width: 800px;
            margin: 0 auto;
            background: #efeae2;
            border-radius: 8px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .chat-header {
            background-color: #202c33;
            color: white;
            padding: 10px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .header-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            background-color: #6d7f8c;
        }
        .header-info h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
        }
        .header-info p {
            margin: 0;
            font-size: 12px;
            color: #8696a0;
        }
        .chat-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .message {
            max-width: 65%;
            padding: 6px 7px 8px 9px;
            border-radius: 7.5px;
            position: relative;
            font-size: 14.2px;
            line-height: 19px;
            word-wrap: break-word;
        }
        .message.from-me {
            align-self: flex-end;
            background-color: #d9fdd3;
            border-top-right-radius: 0;
        }
        .message.from-contact {
            align-self: flex-start;
            background-color: white;
            border-top-left-radius: 0;
        }
        .message-content {
            margin-bottom: 4px;
        }
        .message-nav {
            display: flex;
            justify-content: flex-end;
            font-size: 11px;
            color: #667781;
            align-items: center;
            gap: 2px;
            height: 15px;
        }
        .system-message {
            align-self: center;
            background-color: #fffae6; /* Yellowish for system */
            color: #54656f;
            font-size: 12.5px;
            padding: 5px 12px;
            border-radius: 8px;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            margin: 8px 0;
            text-align: center;
            max-width: 90%;
        }
        .date-divider {
            align-self: center;
            background-color: #ffffff;
            color: #54656f;
            font-size: 12.5px;
            padding: 5px 12px;
            border-radius: 8px;
            box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
            margin: 8px 0;
            text-align: center;
        }
        .media-image {
            max-width: 100%;
            border-radius: 6px;
            margin-bottom: 4px;
        }
        .print-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: #00a884;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 24px;
            cursor: pointer;
            font-weight: bold;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            z-index: 100;
        }
        @media print {
            .print-btn { display: none; }
            body { background-color: white; padding: 0; }
            .chat-container { box-shadow: none; max-width: 100%; }
        }
    </style>
    `;

    const script = `
    <script>
        function printChat() {
            window.print();
        }
    </script>
    `;

    let html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat - ${contactName}</title>
        ${styles}
    </head>
    <body>
        <button class="print-btn" onclick="printChat()">Imprimir / Salvar PDF</button>

        <div class="chat-container">
            <div class="chat-header">
                ${contactAvatar ? `<img src="${contactAvatar}" alt="${contactName}" class="header-avatar">` : '<div class="header-avatar"></div>'}
                <div class="header-info">
                    <h2>${contactName}</h2>
                    <p>${contactPhone} ${instanceName ? `• ${instanceName}` : ''}</p>
                </div>
            </div>

            <div class="chat-body">
    `;

    let lastDate = '';

    messages.forEach(msg => {
        // Date Divider
        const msgDate = new Date(msg.createdAt).toLocaleDateString('pt-BR');
        if (msgDate !== lastDate) {
            html += `<div class="date-divider">${msgDate}</div>`;
            lastDate = msgDate;
        }

        const isMe = msg.from_me;
        const time = new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        if (msg.type === 'system') {
            html += `<div class="system-message">${msg.content}</div>`;
            return;
        }

        let content = '';

        if (['image', 'video'].includes(msg.type) && msg.metadata?.mediaUrl) {
            // If it's a blob URL (optimistic), this won't work in a new window unless we convert to base64 or it's a public URL.
            // Assuming messages loaded from DB have public URLs or base64.
            // If base64 is separate, check that.
            // Simplified: use metadata.mediaUrl
            if (msg.type === 'image') {
                content += `<img src="${msg.metadata.mediaUrl}" class="media-image" alt="Imagem">`;
            } else if (msg.type === 'video') {
                content += `<div style="background:rgba(0,0,0,0.1); padding:10px; border-radius:4px; text-align:center;">[Vídeo]</div>`;
            }
        }

        if (msg.content) {
            content += `<div>${msg.content.replace(/\n/g, '<br>')}</div>`;
        }

        html += `
            <div class="message ${isMe ? 'from-me' : 'from-contact'}">
                <div class="message-content">${content}</div>
                <div class="message-nav">
                    <span>${time}</span>
                    ${isMe ? `<span>${msg.is_read ? '✓✓' : '✓'}</span>` : ''}
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
        ${script}
    </body>
    </html>
    `;

    return html;
}
