/**
 * Mobile Chat Presentation & View State Types
 * Feature: 001-redefinir-modo-mobile
 */

import type { Chat, User, Tag } from '@/lib/types';
import type { InitialChatsPayload } from '@/actions/chats';

export type CloseReasonTag = Tag;

export type MobileInboxTab = 'robo' | 'gerais' | 'atendimentos' | 'encerrados';

export interface MobileViewState {
  activeChatId: string | null;
  activeTab: MobileInboxTab;
  searchQuery: string;
  isContactSheetOpen: boolean;
  isTransferDialogOpen: boolean;
  isCloseDialogOpen: boolean;
}

export interface MobileKeyboardMetrics {
  isOpen: boolean;
  keyboardHeight: number;
  viewportHeight: number;
}

export interface MobileChatLayoutProps {
  initialUser: User;
  chatId: string | null;
  initialData: InitialChatsPayload | null;
  preserveClientState?: boolean;
}

export interface MobileChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  currentUser: User | null;
  ownershipFilter: 'mine' | 'everyone';
  onOwnershipFilterChange: (filter: 'mine' | 'everyone') => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

export interface MobileChatViewProps {
  chat: Chat;
  currentUser: User | null;
  onBack: () => void;
  onActionSuccess?: () => void;
  closeReasons?: Tag[];
  workspaceTimezone?: string;
  renderContactSheet?: (props: {
    isOpen: boolean;
    onClose: () => void;
    chat: Chat;
  }) => React.ReactNode;
}

export interface MobileContactSheetProps {
  isOpen: boolean;
  onClose: () => void;
  chat: Chat;
  currentUser: User | null;
  closeReasons?: Tag[];
  onTransferSuccess?: () => void;
  onCloseSuccess?: () => void;
}
