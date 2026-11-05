'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MobileKeyboardMetrics } from '@/types/mobile-chat';

export function calculateKeyboardMetrics(
  windowHeight: number,
  visualViewportHeight: number
): MobileKeyboardMetrics {
  const diff = windowHeight - visualViewportHeight;
  // If height difference exceeds 150px, the mobile virtual keyboard is considered active
  const isOpen = diff > 150;
  const keyboardHeight = isOpen ? Math.round(diff) : 0;

  return {
    isOpen,
    keyboardHeight,
    viewportHeight: Math.round(visualViewportHeight),
  };
}

export function useVisualViewport(): MobileKeyboardMetrics {
  const [metrics, setMetrics] = useState<MobileKeyboardMetrics>(() => {
    if (typeof window === 'undefined') {
      return {
        isOpen: false,
        keyboardHeight: 0,
        viewportHeight: 800,
      };
    }
    const vv = window.visualViewport;
    const currentHeight = vv ? vv.height : window.innerHeight;
    return calculateKeyboardMetrics(window.innerHeight, currentHeight);
  });

  const updateMetrics = useCallback(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const newMetrics = calculateKeyboardMetrics(window.innerHeight, vvHeight);

    setMetrics(newMetrics);

    // Synchronize CSS variable for smooth hardware-accelerated animations
    if (document.documentElement) {
      document.documentElement.style.setProperty(
        '--keyboard-offset',
        `${newMetrics.keyboardHeight}px`
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;
    if (!vv) {
      window.addEventListener('resize', updateMetrics);
      return () => {
        window.removeEventListener('resize', updateMetrics);
      };
    }

    vv.addEventListener('resize', updateMetrics);
    vv.addEventListener('scroll', updateMetrics);
    window.addEventListener('resize', updateMetrics);

    // Initial sync
    updateMetrics();

    return () => {
      vv.removeEventListener('resize', updateMetrics);
      vv.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      if (document.documentElement) {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
      }
    };
  }, [updateMetrics]);

  return metrics;
}
