import { MetaChannelRecord } from './meta-channel.service';

type OutgoingType = 'text' | 'image' | 'video' | 'audio' | 'file';

export class MessengerMessagingService {
  constructor(private channel: MetaChannelRecord) {}

  private get endpoint(): string {
    return `https://graph.facebook.com/v20.0/me/messages`;
  }

  private async request(body: Record<string, any>) {
    const res = await fetch(`${this.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.channel.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_type: 'RESPONSE',
        ...body,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error?.message || 'Falha ao enviar mensagem para o Messenger.');
    }
    return json;
  }

  async sendText(recipientId: string, text: string) {
    return this.request({
      recipient: { id: recipientId },
      message: { text },
    });
  }

  async sendAttachment(recipientId: string, type: Exclude<OutgoingType, 'text'>, mediaUrl: string) {
    return this.request({
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: type === 'file' ? 'file' : type,
          payload: { url: mediaUrl },
        },
      },
    });
  }

  async markSeen(recipientId: string) {
    return this.request({
      recipient: { id: recipientId },
      sender_action: 'mark_seen',
    });
  }

  async setTyping(recipientId: string, typingOn: boolean) {
    return this.request({
      recipient: { id: recipientId },
      sender_action: typingOn ? 'typing_on' : 'typing_off',
    });
  }

  async sendMessage(params: { recipientId: string; type: OutgoingType; text?: string; mediaUrl?: string }) {
    const { recipientId, type, text, mediaUrl } = params;
    if (type === 'text') {
      if (!text) throw new Error('Texto obrigatorio para mensagens de texto.');
      return this.sendText(recipientId, text);
    }

    if (!mediaUrl) {
      throw new Error('URL de midia obrigatoria para mensagens com anexos.');
    }

    return this.sendAttachment(recipientId, type, mediaUrl);
  }
}
