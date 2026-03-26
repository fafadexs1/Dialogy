import Image from "next/image";
import Link from "next/link";
import { Download, ExternalLink, Terminal } from "lucide-react";

import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';

function SdkCard({ language, icon, version, installCmd }: { language: string, icon: string, version: string, installCmd: string }) {
    return (
        <div className="p-6 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all group">
            <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl">
                        {icon}
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">{language}</h3>
                        <p className="text-sm text-white/40">v{version}</p>
                    </div>
                </div>
                <Link href="#" className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                    <ExternalLink className="w-5 h-5" />
                </Link>
            </div>

            <div className="bg-[#0f172a] rounded-lg p-3 border border-white/5 flex items-center justify-between group-hover:border-white/10 transition-colors">
                <code className="text-sm font-mono text-blue-400">{installCmd}</code>
                <button className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                    <Download className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/developer/sdks' });
}

export default function SdksPage() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <StoredSeoJsonLd pathname="/developer/sdks" />
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/developer" className="font-bold text-xl tracking-tight flex items-center gap-2">
                            <Image src="/logo.png" alt="Dialogy" width={170} height={48} className="h-12 w-auto" />
                            <span className="text-white/40 font-normal ml-2">SDKs</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer" className="text-sm font-medium text-white/60 hover:text-white">Voltar para Developer Hub</Link>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-6 py-20">
                <div className="text-center max-w-2xl mx-auto mb-20">
                    <h1 className="text-4xl md:text-5xl font-bold mb-6">Bibliotecas Oficiais</h1>
                    <p className="text-xl text-white/60">
                        Acelere seu desenvolvimento com nossas bibliotecas oficiais. Totalmente tipadas, documentadas e prontas para produção.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
                    <SdkCard
                        language="Node.js"
                        icon="🟢"
                        version="2.4.0"
                        installCmd="npm install dialogy-node"
                    />
                    <SdkCard
                        language="Python"
                        icon="🐍"
                        version="1.8.2"
                        installCmd="pip install dialogy-python"
                    />
                    <SdkCard
                        language="Go"
                        icon="🔵"
                        version="0.9.5"
                        installCmd="go get github.com/dialogy/go"
                    />
                    <SdkCard
                        language="PHP"
                        icon="🐘"
                        version="3.1.0"
                        installCmd="composer require dialogy/php"
                    />
                    <SdkCard
                        language="Java"
                        icon="☕"
                        version="4.0.1"
                        installCmd="mvn install dialogy-java"
                    />
                    <SdkCard
                        language="Ruby"
                        icon="💎"
                        version="2.1.0"
                        installCmd="gem install dialogy-ruby"
                    />
                </div>

                <div className="rounded-2xl bg-gradient-to-br from-blue-900/20 to-purple-900/20 border border-white/10 p-12 text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
                    <div className="relative z-10">
                        <h2 className="text-2xl font-bold mb-4">Não encontrou sua linguagem?</h2>
                        <p className="text-white/60 mb-8 max-w-lg mx-auto">
                            Nossa API é baseada em padrões HTTP REST, então você pode usá-la com qualquer linguagem que suporte requisições HTTP.
                        </p>
                        <Link href="/developer/api" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-white text-black font-semibold hover:bg-white/90 transition-colors">
                            <Terminal className="w-4 h-4" />
                            Ver Referência da API REST
                        </Link>
                    </div>
                </div>
            </main>
        </div>
    );
}
