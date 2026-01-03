"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type AvatarProps = React.ComponentPropsWithoutRef<"div">
type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement> & { fallbackSrc?: string }
type AvatarFallbackProps = React.ComponentPropsWithoutRef<"span">

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full [&_img:not(.hidden)~*]:hidden",
        className
      )}
      {...props}
    />
  )
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, src, alt, onError, onLoad, fallbackSrc, ...props }, ref) => {
    const [isLoaded, setIsLoaded] = React.useState<boolean>(false)
    const [hasError, setHasError] = React.useState<boolean>(false)
    const safeSrc = React.useMemo(() => (typeof src === 'string' && src.trim() !== '') ? src : undefined, [src]);
    const internalRef = React.useRef<HTMLImageElement | null>(null);

    const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(
      safeSrc || fallbackSrc
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
      setCurrentSrc(safeSrc || fallbackSrc)
      setIsLoaded(false)
      setHasError(false)
    }, [safeSrc, fallbackSrc])

    React.useEffect(() => {
      if (!currentSrc) return;
      const img = internalRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        setIsLoaded(true);
      }
    }, [currentSrc]);

    return currentSrc ? (
      <img
        ref={setRefs}
        src={currentSrc}
        alt={alt ?? ""}
        className={cn(
          "aspect-square h-full w-full object-cover",
          (hasError || !isLoaded) && "hidden",
          className
        )}
        onLoad={(e) => {
          setIsLoaded(true)
          onLoad?.(e)
        }}
        onError={(e) => {
          setIsLoaded(false)
          setHasError(true)
          if (fallbackSrc && currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc)
            setHasError(false)
            return
          }
          onError?.(e)
        }}
        {...props}
      />
    ) : null
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
