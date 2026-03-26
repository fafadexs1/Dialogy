"use client"

import * as React from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type ThemeToggleProps = {
    onThemeChange?: (theme: "light" | "dark" | "system") => void
    disabled?: boolean
}

export function ThemeToggle({ onThemeChange, disabled = false }: ThemeToggleProps) {
    const { setTheme, theme, resolvedTheme } = useTheme()

    const activeTheme = theme ?? resolvedTheme ?? "dark"
    const ActiveIcon = activeTheme === "light" ? Sun : activeTheme === "dark" ? Moon : Monitor

    const handleChange = (nextTheme: "light" | "dark" | "system") => {
        setTheme(nextTheme)
        onThemeChange?.(nextTheme)
    }

    const itemClassName = (itemTheme: "light" | "dark" | "system") =>
        cn(
            "flex items-center justify-between",
            activeTheme === itemTheme && "bg-accent/70"
        )

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    className="min-w-[126px] justify-between gap-2 border-border bg-background text-foreground hover:bg-muted dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                    <span className="flex items-center gap-2">
                        <ActiveIcon className="h-4 w-4" />
                        <span className="text-sm">
                            {activeTheme === "light" ? "Claro" : activeTheme === "dark" ? "Escuro" : "Sistema"}
                        </span>
                    </span>
                    <span className="sr-only">Alterar tema</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleChange("light")} className={itemClassName("light")}>
                    <span className="flex items-center gap-2">
                        <Sun className="h-4 w-4" />
                        Claro
                    </span>
                    {activeTheme === "light" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleChange("dark")} className={itemClassName("dark")}>
                    <span className="flex items-center gap-2">
                        <Moon className="h-4 w-4" />
                        Escuro
                    </span>
                    {activeTheme === "dark" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleChange("system")} className={itemClassName("system")}>
                    <span className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        Sistema
                    </span>
                    {activeTheme === "system" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
