"use client"

import * as React from "react"

import { resolveClientMediaUrl } from "@/lib/storage-url"
import { cn } from "@/lib/utils"

type AvatarProps = React.ComponentPropsWithoutRef<"div">
type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { fallbackSrc?: string }
type AvatarFallbackProps = React.ComponentPropsWithoutRef<"span">

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full [&_img.avatar-loaded~*]:hidden",
        className
      )}
      {...props}
    />
  )
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, src, alt, onError, onLoad, fallbackSrc, ...props }, ref) => {
    const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading')
    const safeSrc = React.useMemo(() => {
      if (typeof src !== 'string') return undefined;
      const trimmedSrc = src.trim();
      if (!trimmedSrc) return undefined;
      const resolvedSrc = resolveClientMediaUrl(trimmedSrc, { kind: 'image' });
      return resolvedSrc || undefined;
    }, [src]);
    const safeFallbackSrc = React.useMemo(() => {
      if (typeof fallbackSrc !== 'string') return fallbackSrc;
      const trimmedFallbackSrc = fallbackSrc.trim();
      if (!trimmedFallbackSrc) return undefined;
      const resolvedFallbackSrc = resolveClientMediaUrl(trimmedFallbackSrc, { kind: 'image' });
      return resolvedFallbackSrc || undefined;
    }, [fallbackSrc]);
    const internalRef = React.useRef<HTMLImageElement | null>(null);

    const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(
      safeSrc || safeFallbackSrc
    )

    const setRefs = React.useCallback((node: HTMLImageElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLImageElement | null>).current = node;
      }
    }, [ref]);

    React.useEffect(() => {
      setCurrentSrc(safeSrc || safeFallbackSrc)
      setStatus('loading')
    }, [safeSrc, safeFallbackSrc])

    // Catch images that loaded before React hydrated (race condition fix)
    React.useEffect(() => {
      if (!currentSrc) return;
      const img = internalRef.current;
      if (img && img.complete) {
        if (img.naturalWidth > 0) {
          setStatus('loaded');
        } else {
          // Image completed but with 0 width = broken
          setStatus('error');
        }
      }
    }, [currentSrc]);

    if (!currentSrc) return null;

    const isLoaded = status === 'loaded';

    return (
      <img
        ref={setRefs}
        src={currentSrc}
        alt={alt ?? ""}
        className={cn(
          "aspect-square h-full w-full object-cover",
          isLoaded ? "avatar-loaded" : "hidden",
          className
        )}
        onLoad={(e) => {
          setStatus('loaded')
          onLoad?.(e)
        }}
        onError={(e) => {
          if (safeFallbackSrc && currentSrc !== safeFallbackSrc) {
            setCurrentSrc(safeFallbackSrc)
            setStatus('loading')
            return
          }
          setStatus('error')
          onError?.(e)
        }}
        {...props}
      />
    )
  }
)
AvatarImage.displayName = "AvatarImage"

const AvatarFallback = React.forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
)
AvatarFallback.displayName = "AvatarFallback"

export { Avatar, AvatarImage, AvatarFallback }
