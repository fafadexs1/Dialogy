export type CommunityMedia = {
  type: 'image' | 'youtube' | 'vimeo';
  url: string;
};

export type CommunityMediaInput = {
  type: 'image' | 'video';
  url: string;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;

export function normalizeCommunityMedia(input?: CommunityMediaInput | null): CommunityMedia | null {
  if (!input?.url.trim()) return null;
  if (input.url.length > 2048) throw new Error('A URL da mídia é muito longa.');

  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new Error('Informe uma URL válida.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Use uma URL HTTPS pública, sem usuário ou senha.');
  }

  if (input.type === 'image') return { type: 'image', url: parsed.href };

  const host = parsed.hostname.toLowerCase();
  let videoId = '';
  if (host === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    videoId = parsed.pathname.startsWith('/shorts/')
      ? parsed.pathname.split('/')[2] || ''
      : parsed.searchParams.get('v') || '';
  }
  if (YOUTUBE_ID.test(videoId)) {
    return { type: 'youtube', url: `https://www.youtube-nocookie.com/embed/${videoId}` };
  }

  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    const vimeoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (VIMEO_ID.test(vimeoId)) return { type: 'vimeo', url: `https://player.vimeo.com/video/${vimeoId}` };
  }

  throw new Error('Para vídeos, use uma URL válida do YouTube ou Vimeo.');
}
