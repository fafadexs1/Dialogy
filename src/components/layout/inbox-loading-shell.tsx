import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoadingShell() {
    return (
        <div className="flex h-full min-h-0 w-full flex-1 bg-background text-foreground" aria-busy="true" aria-label="Carregando inbox">
            <div className="flex h-full w-full shrink-0 border-r border-border bg-background md:w-[clamp(320px,29vw,460px)] md:min-w-[320px] md:max-w-[460px]">
                <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <Skeleton className="h-7 w-32 bg-muted" />
                        <Skeleton className="h-9 w-9 rounded-xl bg-muted" />
                    </div>
                    <Skeleton className="h-10 w-full rounded-xl bg-muted" />
                    <div className="mt-2 space-y-2">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <Skeleton key={index} className="h-[72px] w-full rounded-2xl bg-muted" />
                        ))}
                    </div>
                </div>
            </div>
            <div className="hidden min-w-0 flex-1 flex-col bg-background md:flex">
                <div className="flex min-h-[72px] items-center gap-3 border-b border-border px-6">
                    <Skeleton className="h-11 w-11 rounded-full bg-muted" />
                    <div className="space-y-2">
                        <Skeleton className="h-4 w-36 bg-muted" />
                        <Skeleton className="h-3 w-24 bg-muted" />
                    </div>
                </div>
                <div className="flex flex-1 flex-col gap-4 p-6">
                    <Skeleton className="ml-auto h-12 w-[min(58%,420px)] rounded-2xl bg-muted" />
                    <Skeleton className="h-12 w-[min(52%,380px)] rounded-2xl bg-muted" />
                    <Skeleton className="ml-auto h-16 w-[min(64%,460px)] rounded-2xl bg-muted" />
                </div>
                <div className="border-t border-border p-4">
                    <Skeleton className="h-14 w-full rounded-2xl bg-muted" />
                </div>
            </div>
        </div>
    );
}
