"use client"

import * as React from "react"

import { resolveClientMediaUrl } from "@/lib/storage-url"
import { cn } from "@/lib/utils"

type AvatarProps = React.ComponentPropsWithoutRef<"div">
type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fallbackOnBlank?: boolean
  fallbackSrc?: string
}
type AvatarFallbackProps = React.ComponentPropsWithoutRef<"span">

function isLikelyPlaceholderAvatarUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return [
    'blank-avatar',
    'default-avatar',
    'default_profile',
    'default-profile',
    'default_user',
    'default-user',
    'no-avatar',
    'noavatar',
    'placeholder-avatar',
    'profile-default',
    'profile_placeholder',
    'profile-placeholder',
    'sem-foto',
    'sem_foto',
    'user-default',
  ].some((pattern) => normalized.includes(pattern));
}

function isLikelyBlankAvatarImage(image: HTMLImageElement): boolean {
  if (typeof document === 'undefined') return false;
  if (!image.naturalWidth || !image.naturalHeight) return true;

  try {
    const sampleSize = 16;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;

    context.drawImage(image, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const totalPixels = sampleSize * sampleSize;
    let opaquePixels = 0;
    let veryLightPixels = 0;
    let lightPixels = 0;
    let darkPixels = 0;
    let strongDarkPixels = 0;
    let saturatedPixels = 0;
    let brightnessSum = 0;
    let brightnessSqSum = 0;
    let saturationSum = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3] ?? 0;
      if (alpha < 16) continue;

      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const brightness = (red + green + blue) / 3;
      const maxChannel = Math.max(red, green, blue);
      const minChannel = Math.min(red, green, blue);
      const saturation = maxChannel - minChannel;

      opaquePixels++;
      brightnessSum += brightness;
      brightnessSqSum += brightness * brightness;
      saturationSum += saturation;

      if (brightness > 244 && saturation < 12) veryLightPixels++;
      if (brightness > 225) lightPixels++;
      if (brightness < 210) darkPixels++;
      if (brightness < 160) strongDarkPixels++;
      if (saturation > 32) saturatedPixels++;
    }

    if (opaquePixels / totalPixels < 0.25) return true;

    const meanBrightness = brightnessSum / opaquePixels;
    const meanSaturation = saturationSum / opaquePixels;
    const variance = Math.max(0, brightnessSqSum / opaquePixels - meanBrightness * meanBrightness);
    const standardDeviation = Math.sqrt(variance);
    const veryLightRatio = veryLightPixels / opaquePixels;
    const lightRatio = lightPixels / opaquePixels;
    const darkRatio = darkPixels / opaquePixels;
    const strongDarkRatio = strongDarkPixels / opaquePixels;
    const saturatedRatio = saturatedPixels / opaquePixels;

    return (
      (meanBrightness > 246 && standardDeviation < 10) ||
      (veryLightRatio > 0.96 && darkRatio < 0.02) ||
      (meanBrightness > 232 && meanSaturation < 16 && standardDeviation < 42) ||
      (veryLightRatio > 0.84 && meanSaturation < 18 && darkRatio < 0.2) ||
      (lightRatio > 0.9 && saturatedRatio < 0.04 && strongDarkRatio < 0.08)
    );
  } catch {
    return false;
  }
}

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
  ({ className, src, alt, onError, onLoad, fallbackOnBlank = false, fallbackSrc, ...props }, ref) => {
    const [status, setStatus] = React.useState<'loading' | 'loaded' | 'error'>('loading')
    const safeSrc = React.useMemo(() => {
      if (typeof src !== 'string') return undefined;
      const trimmedSrc = src.trim();
      if (!trimmedSrc) return undefined;
      if (isLikelyPlaceholderAvatarUrl(trimmedSrc)) return undefined;
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
          if (fallbackOnBlank && isLikelyBlankAvatarImage(img)) {
            setStatus('error');
            return;
          }
          setStatus('loaded');
        } else {
          // Image completed but with 0 width = broken
          setStatus('error');
        }
      }
    }, [currentSrc, fallbackOnBlank]);

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
          if (fallbackOnBlank && isLikelyBlankAvatarImage(e.currentTarget)) {
            setStatus('error')
            return
          }
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
