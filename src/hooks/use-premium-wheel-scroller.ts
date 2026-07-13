'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePremiumWheelScroller(suspended: boolean, contentVersion: string) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const cancelAnimationRef = useRef<() => void>(() => undefined);
  const scrollerRef = useCallback((node: HTMLElement | Window | null) => {
    setScroller(node instanceof HTMLElement ? node : null);
  }, []);
  const cancelAnimation = useCallback(() => cancelAnimationRef.current(), []);

  useEffect(() => {
    if (!scroller || suspended) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame: number | null = null;
    let targetScrollTop = scroller.scrollTop;
    let previousTimestamp = 0;

    const cancelCurrentAnimation = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      previousTimestamp = 0;
      targetScrollTop = scroller.scrollTop;
    };
    cancelAnimationRef.current = cancelCurrentAnimation;

    const animate = (timestamp: number) => {
      const elapsed = previousTimestamp ? Math.min(32, timestamp - previousTimestamp) : 16;
      previousTimestamp = timestamp;
      const distance = targetScrollTop - scroller.scrollTop;

      if (Math.abs(distance) <= 0.5) {
        scroller.scrollTop = targetScrollTop;
        animationFrame = null;
        previousTimestamp = 0;
        return;
      }

      const damping = 1 - Math.exp(-elapsed / 52);
      scroller.scrollTop += distance * damping;
      animationFrame = window.requestAnimationFrame(animate);
    };

    const handleWheel = (event: WheelEvent) => {
      if (
        reducedMotion.matches ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      // Precision trackpads already provide native momentum. Smooth only the
      // coarse notches emitted by a traditional mouse wheel.
      if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(event.deltaY) < 40) {
        return;
      }

      const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? scroller.clientHeight
          : 1;
      const rawDelta = event.deltaY * deltaMultiplier;
      const delta = Math.max(-160, Math.min(160, rawDelta));
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const remainingDistance = targetScrollTop - scroller.scrollTop;

      if (remainingDistance && Math.sign(remainingDistance) !== Math.sign(delta)) {
        targetScrollTop = scroller.scrollTop;
      }

      const accumulatedTarget = targetScrollTop + delta * 0.82;
      const boundedTarget = Math.max(
        scroller.scrollTop - 480,
        Math.min(scroller.scrollTop + 480, accumulatedTarget)
      );
      const nextTarget = Math.min(maxScrollTop, Math.max(0, boundedTarget));
      if (Math.abs(nextTarget - scroller.scrollTop) <= 0.5) return;

      event.preventDefault();
      targetScrollTop = nextTarget;
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    const handleReducedMotionChange = () => {
      if (reducedMotion.matches) cancelCurrentAnimation();
    };

    scroller.addEventListener('wheel', handleWheel, { passive: false });
    scroller.addEventListener('pointerdown', cancelCurrentAnimation, { passive: true });
    scroller.addEventListener('touchstart', cancelCurrentAnimation, { passive: true });
    reducedMotion.addEventListener('change', handleReducedMotionChange);

    return () => {
      cancelCurrentAnimation();
      cancelAnimationRef.current = () => undefined;
      scroller.removeEventListener('wheel', handleWheel);
      scroller.removeEventListener('pointerdown', cancelCurrentAnimation);
      scroller.removeEventListener('touchstart', cancelCurrentAnimation);
      reducedMotion.removeEventListener('change', handleReducedMotionChange);
    };
  }, [contentVersion, scroller, suspended]);

  return { cancelAnimation, scrollerRef };
}
