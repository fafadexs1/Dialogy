import type { Chat as WebChat, Message as WebMessage, Workspace } from '@/lib/types';

export type MobileChannel = 'whatsapp' | 'messenger' | 'telegram' | 'instagram';

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'C') + (parts[1]?.[0] || '');
}

export function inferChannel(input: {
  source?: string | null;
  instance_name?: string | null;
  instance_type?: string | null;
  metaPlatform?: string | null;
  meta_platform?: string | null;
  phone?: string | null;
  phone_number_jid?: string | null;
}): MobileChannel {
  const raw = [
    input.metaPlatform,
    input.meta_platform,
    input.source,
    input.instance_type,
    input.instance_name,
    input.phone,
    input.phone_number_jid,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (raw.includes('instagram')) return 'instagram';
  if (raw.includes('messenger') || raw.includes('facebook')) return 'messenger';
  if (raw.includes('telegram') || raw.includes('tg')) return 'telegram';
  return 'whatsapp';
}

export function mapMobileUser(user: any, workspace: Workspace) {
  return {
    id: user.id,
    name: user.name || user.email || 'Usuario',
    email: user.email || '',
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    initials: initialsFromName(user.name || user.email || 'Usuario').toUpperCase(),
    workspaces: (user.workspaces || []).map((item: Workspace) => ({
      id: item.id,
      name: item.name,
    })),
  };
}

export function mapMobileChat(chat: WebChat) {
  const contactName = chat.contact?.name || 'Contato';
  const channel = inferChannel({
    source: chat.source,
    instance_name: chat.instance_name,
    instance_type: chat.instance_type,
    metaPlatform: chat.metaPlatform,
    phone_number_jid: chat.contact?.phone_number_jid,
  });
  const lastMessage = chat.messages?.[0];

  return {
    id: chat.id,
    workspaceId: chat.workspace_id,
    contact: {
      id: chat.contact?.id || chat.id,
      name: contactName,
      initials: initialsFromName(contactName).toUpperCase(),
      channel,
      phone: chat.contact?.phone_number_jid || chat.contact?.phone,
      avatarUrl: chat.contact?.avatar_url,
    },
    status: chat.assigned_system_agent_id ? 'robo' : chat.status,
    lastMessage: lastMessage?.content || 'Sem mensagens ainda.',
    lastMessageAt: lastMessage?.createdAt || chat.updatedAt || new Date().toISOString(),
    unreadCount: chat.unreadCount || 0,
    tags: [chat.teamName, chat.tag].filter(Boolean),
    assignedTo: chat.agent?.name || chat.assignedSystemAgent?.name,
    assignedToId: chat.agentId || chat.agent?.id || chat.assigned_system_agent_id || undefined,
    assignedAvatarUrl: chat.agent?.avatar_url || chat.agent?.avatar || chat.assignedSystemAgent?.avatar_url,
    teamName: chat.teamName,
    attendantType: chat.assigned_system_agent_id ? 'ai' : chat.agent?.name ? 'agent' : 'queue',
    isAiActive: Boolean(chat.is_autopilot_active || chat.assigned_system_agent_id),
  };
}

export function mapMobileMessage(message: WebMessage, fallbackChannel: MobileChannel = 'whatsapp') {
  return {
    id: message.id,
    chatId: message.chat_id,
    content: message.content || '',
    createdAt: message.createdAt || new Date().toISOString(),
    fromMe: Boolean(message.from_me),
    channel: inferChannel({
      source: message.source_from_api,
      instance_name: message.instance_name,
      meta_platform: message.platform,
    }) || fallbackChannel,
    status: message.optimistic ? 'pending' : 'sent',
    isSystem: message.type === 'system',
  };
}
