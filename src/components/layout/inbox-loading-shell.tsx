import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoadingShell() {
    return (
        <div className="flex flex-1 w-full min-h-0 h-full bg-black/20 backdrop-blur-xl">
            <div className="flex w-[360px] flex-shrink-0 flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
                <Skeleton className="h-12 w-full bg-white/5" />
                <Skeleton className="h-10 w-full bg-white/5" />
                <Skeleton className="h-10 w-full bg-white/5" />
                <div className="space-y-2 mt-4">
                    <Skeleton className="h-16 w-full bg-white/5" />
                    <Skeleton className="h-16 w-full bg-white/5" />
                    <Skeleton className="h-16 w-full bg-white/5" />
                    <Skeleton className="h-16 w-full bg-white/5" />
                </div>
            </div>
            <div className="flex-1 flex flex-col min-w-0 bg-transparent">
                <Skeleton className="h-16 w-full bg-white/5" />
                <div className="flex-1 p-6 space-y-4">
                    <Skeleton className="h-10 w-1/2 ml-auto bg-white/5" />
                    <Skeleton className="h-10 w-1/2 bg-white/5" />
                    <Skeleton className="h-10 w-1/2 ml-auto bg-white/5" />
                </div>
                <Skeleton className="h-24 w-full bg-white/5" />
            </div>
            <div className="hidden lg:flex lg:flex-col lg:w-1/4 lg:flex-shrink-0 border-l border-white/10 bg-black/20 backdrop-blur-xl p-4 gap-4">
                <Skeleton className="h-16 w-full bg-white/5" />
                <Skeleton className="h-24 w-full bg-white/5" />
                <Skeleton className="h-32 w-full bg-white/5" />
            </div>
        </div>
    );
}
