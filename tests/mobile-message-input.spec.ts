import { describe, expect, it, vi } from 'vitest';

describe('User Story 2: Mobile Virtual Keyboard Anchoring & Message Input', () => {
  it('prevents sending empty or whitespace-only messages', () => {
    const onSend = vi.fn();
    const handleSendAttempt = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onSend(trimmed);
    };

    handleSendAttempt('   ');
    expect(onSend).not.toHaveBeenCalled();

    handleSendAttempt('\n\n  \t ');
    expect(onSend).not.toHaveBeenCalled();

    handleSendAttempt('  Mensagem válida para o cliente  ');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Mensagem válida para o cliente');
  });

  it('calculates bottom offset styling based on keyboard height metrics', () => {
    const computeInputBottomStyle = (keyboardHeight: number, isKeyboardOpen: boolean) => {
      if (isKeyboardOpen && keyboardHeight > 0) {
        return {
          transform: `translateY(-${keyboardHeight}px)`,
          paddingBottom: '0.5rem',
        };
      }
      return {
        transform: 'translateY(0px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)',
      };
    };

    // Keyboard closed on iPhone (uses safe area)
    const closedStyle = computeInputBottomStyle(0, false);
    expect(closedStyle.transform).toBe('translateY(0px)');
    expect(closedStyle.paddingBottom).toContain('safe-area-inset-bottom');

    // Keyboard open with 300px height (lifts input)
    const openStyle = computeInputBottomStyle(300, true);
    expect(openStyle.transform).toBe('translateY(-300px)');
    expect(openStyle.paddingBottom).toBe('0.5rem');
  });

  it('clamps multi-line textarea height to a maximum of 4 lines (approx 120px)', () => {
    const calculateTextareaHeight = (lineCount: number, lineHeight: number = 24) => {
      const minHeight = 44;
      const maxHeight = 120;
      const calculated = lineCount * lineHeight + 16;
      return Math.min(Math.max(calculated, minHeight), maxHeight);
    };

    expect(calculateTextareaHeight(1)).toBe(44); // 1 line clamped to min
    expect(calculateTextareaHeight(2)).toBe(64); // 2 lines
    expect(calculateTextareaHeight(4)).toBe(112); // 4 lines
    expect(calculateTextareaHeight(10)).toBe(120); // clamped to max
  });
});
