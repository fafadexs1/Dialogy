"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type AvatarProps = React.ComponentPropsWithoutRef<"div">
type AvatarImageProps = React.ImgHTMLAttributes<HTMLImageElement>
type AvatarFallbackProps = React.ComponentPropsWithoutRef<"span">

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
)
Avatar.displayName = "Avatar"

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, src, alt, onError, onLoad, ...props }, ref) => {
    const [isLoaded, setIsLoaded] = React.useState<boolean>(false)
    const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(
      src as string | undefined
    )

    React.useEffect(() => {
      setCurrentSrc(src as string | undefined)
      setIsLoaded(false)
    }, [src])

    return currentSrc ? (
      <img
        ref={ref}
        src={currentSrc}
        alt={alt ?? ""}
        className={cn(
          "aspect-square h-full w-full object-cover",
          !isLoaded && "hidden",
          className
        )}
        onLoad={(e) => {
          setIsLoaded(true)
          onLoad?.(e)
        }}
        onError={(e) => {
          setIsLoaded(false)
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
