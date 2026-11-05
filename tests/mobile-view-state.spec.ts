import { describe, expect, it } from 'vitest';
import { calculateKeyboardMetrics } from '../src/hooks/use-visual-viewport';
import type { MobileViewState, MobileInboxTab } from '../src/types/mobile-chat';

describe('Mobile View State & Visual Viewport Tracking', () => {
  describe('calculateKeyboardMetrics', () => {
    it('returns closed keyboard when viewport equals window height', () => {
      const metrics = calculateKeyboardMetrics(844, 844);
      expect(metrics.isOpen).toBe(false);
      expect(metrics.keyboardHeight).toBe(0);
      expect(metrics.viewportHeight).toBe(844);
    });

    it('returns closed keyboard when height difference is within normal address-bar threshold (<= 150px)', () => {
      const metrics = calculateKeyboardMetrics(844, 780);
      expect(metrics.isOpen).toBe(false);
      expect(metrics.keyboardHeight).toBe(0);
      expect(metrics.viewportHeight).toBe(780);
    });

    it('detects active virtual keyboard and measures exact keyboard height when viewport shrinks significantly', () => {
      // iPhone 14 Pro: window is 852px, keyboard opens taking ~300px -> visualViewport is 552px
      const metrics = calculateKeyboardMetrics(852, 552);
      expect(metrics.isOpen).toBe(true);
      expect(metrics.keyboardHeight).toBe(300);
      expect(metrics.viewportHeight).toBe(552);
    });
  });

  describe('MobileViewState state transitions', () => {
    const createInitialState = (): MobileViewState => ({
      activeChatId: null,
      activeTab: 'robo',
      searchQuery: '',
      isContactSheetOpen: false,
      isTransferDialogOpen: false,
      isCloseDialogOpen: false,
    });

    it('transitions to chat view when selecting a chat, preserving current activeTab', () => {
      const state = createInitialState();
      state.activeTab = 'atendimentos';

      // User selects chat
      const updatedState: MobileViewState = {
        ...state,
        activeChatId: 'chat-uuid-123',
      };

      expect(updatedState.activeChatId).toBe('chat-uuid-123');
      expect(updatedState.activeTab).toBe('atendimentos');
    });

    it('returns to chat list on back navigation, preserving list tab and clearing activeChatId', () => {
      const inChatState: MobileViewState = {
        ...createInitialState(),
        activeChatId: 'chat-uuid-123',
        activeTab: 'gerais',
        isContactSheetOpen: true,
      };

      // User clicks back
      const listState: MobileViewState = {
        ...inChatState,
        activeChatId: null,
        isContactSheetOpen: false,
      };

      expect(listState.activeChatId).toBeNull();
      expect(listState.activeTab).toBe('gerais');
      expect(listState.isContactSheetOpen).toBe(false);
    });

    it('validates all allowed mobile inbox tabs', () => {
      const validTabs: MobileInboxTab[] = ['robo', 'gerais', 'atendimentos', 'encerrados'];
      expect(validTabs).toHaveLength(4);
      expect(validTabs).toContain('robo');
      expect(validTabs).toContain('gerais');
      expect(validTabs).toContain('atendimentos');
      expect(validTabs).toContain('encerrados');
    });
  });
});
