"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  TOAST_DURATION_MS,
} from "@/components/ui/toast"
import { AlertCircle, Bell } from "lucide-react"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={TOAST_DURATION_MS}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const isDestructive = props.variant === "destructive"
        return (
          <Toast key={id} {...props} duration={TOAST_DURATION_MS}>
            <div
              className={
                isDestructive
                  ? "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400"
                  : "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              }
            >
              {isDestructive ? <AlertCircle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </div>
            <div className="grid min-w-0 flex-1 gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
            <div
              aria-hidden="true"
              className={
                isDestructive
                  ? "toast-progressbar absolute inset-x-0 bottom-0 h-0.5 origin-left bg-red-400"
                  : "toast-progressbar absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
              }
            />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
