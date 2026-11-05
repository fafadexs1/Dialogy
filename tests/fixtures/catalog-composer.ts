import { createRef } from 'react';
import type { Chat } from '@/lib/types';
import type { AnimatedComposerProps } from '@/components/chat/animated-composer';

const noop = () => {};
const asyncNoop = async () => {};

export function catalogComposerProps(overrides: Partial<Chat> = {}): AnimatedComposerProps {
  return {
    chat: { id: '4ed75223-7ca1-47da-9121-167b350b99b7', workspace_id: 'test-workspace', status: 'atendimentos', messages: [], contact: { id: 'test-contact', name: 'Cliente de teste', phone_number_jid: '5511999999999@s.whatsapp.net' }, ...overrides } as Chat,
    value: 'Olá', onChange: noop, onSubmit: asyncNoop, onSendAudio: asyncNoop,
    mediaFiles: [], setMediaFiles: noop,
    isInternalNote: false, setIsInternalNote: noop,
    skipUserSignature: false, setSkipUserSignature: noop,
    isVoiceActive: false, setIsVoiceActive: noop,
    shortcuts: [], isAiTyping: false, isSpellChecking: false, onSpellCheck: asyncNoop,
    composerAiAgents: [], selectedAutopilotAgent: null, isCopilotActive: false,
    isRequestingSuggestion: false, isTakingOverWithAi: false, canAiTakeOverConversation: false,
    onAgentChange: asyncNoop, onDisableCopilot: asyncNoop, onRequestSuggestion: asyncNoop,
    onLearnFromConversation: noop, onOpenToolExecutions: noop, onOpenAiTakeOver: noop,
    onOpenCatalog: noop, emojiPickerTheme: 'light', fileInputRef: createRef<HTMLInputElement>(),
    handleFileChange: noop, processFiles: asyncNoop,
  };
}
