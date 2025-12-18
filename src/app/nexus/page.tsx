import { NexusEmbed } from "@/components/nexus-embed";

export const dynamic = 'force-dynamic';

export default function NexusPage() {
    // FORCE READING RUNTIME ENV VAR (Bracket notation prevents build-time inlining)
    // We check NEXUS_URL first (runtime override), then NEXT_PUBLIC_NEXUS_URL
    const nexusUrl = process.env['NEXUS_URL'] || process.env['NEXT_PUBLIC_NEXUS_URL'] || "http://localhost:3000";
    console.log('[NexusPage] Runtime Env URL:', nexusUrl);

    return (
        <div className="p-2 h-full w-full overflow-hidden">
            <NexusEmbed nexusUrl={nexusUrl} />
        </div>
    );
}
