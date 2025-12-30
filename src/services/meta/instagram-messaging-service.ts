import { resilientFetch } from '@/lib/http/resilient-fetch';
import { MetaChannelRecord, refreshMetaChannelAccessToken } from './meta-channel.service';

type OutgoingType = 'text' | 'image' | 'video' | 'audio' | 'file';

export class InstagramMessagingService {
  constructor(private channel: MetaChannelRecord) {}

  private get endpoint(): string {
    const baseId = this.channel.ig_business_id || this.channel.external_page_id;
    if (!baseId) {
      throw new Error('ID da conta Instagram Business nao configurado.');
    }
    return `https://graph.facebook.com/v20.0/${baseId}/messages`;
  }

  private async request(body: Record<string, any>, retryAuth = false): Promise<any> {
    const res = await resilientFetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.channel.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = json.error || {};
      const message = String(error.message || '');
      const lowered = message.toLowerCase();
      const isAuthError =
        error.code === 190 ||
        error.type === 'OAuthException' ||
        lowered.includes('error validating access token') ||
        lowered.includes('session has expired');

      if (isAuthError && !retryAuth) {
        const refreshed = await refreshMetaChannelAccessToken(this.channel);
        if (refreshed?.access_token) {
          this.channel.access_token = refreshed.access_token;
          this.channel.settings = refreshed.settings ?? this.channel.settings;
          return this.request(body, true);
        }
        throw new Error('Token do canal expirado. Reconecte o canal Meta para continuar.');
      }

      throw new Error(message || 'Falha ao enviar mensagem para Instagram Graph API');
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
