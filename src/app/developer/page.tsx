import Link from 'next/link';
import {
    Book,
    Box,
    ChevronRight,
    Code2,
    Layers,
    Search,
    Share2,
    Shield,
    Terminal,
    Zap,
} from 'lucide-react';

import { DeveloperBrand } from '@/components/developer/developer-brand';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { buildPageMetadata } from '@/lib/seo/metadata';
import { JsonLd, getBreadcrumbSchema } from '@/lib/seo/schema';

function Card({ title, description, icon: Icon, href }: { title: string; description: string; icon: any; href: string }) {
    return (
        <Link href={href} className="group relative rounded-2xl border border-white/10 bg-white/5 p-6 transition-all duration-300 hover:-translate-y-1 hover:bg-white/10">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                <Icon className="h-5 w-5 text-blue-400 transition-transform group-hover:scale-110" />
            </div>
            <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-white">
                {title} <ChevronRight className="h-4 w-4 text-blue-400 opacity-0 transition-opacity group-hover:opacity-100" />
            </h3>
            <p className="text-sm text-white/60">{description}</p>
        </Link>
    );
}

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/developer' });
}

export default function DeveloperPage() {
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Developer', path: '/developer' },
    ]);

    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <JsonLd id="developer-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/developer" />

            <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-8">
                        <DeveloperBrand />
                        <div className="hidden items-center gap-6 text-sm font-medium text-white/60 md:flex">
                            <Link href="/developer/docs" className="transition-colors hover:text-white">Documentacao</Link>
                            <Link href="/developer/api" className="transition-colors hover:text-white">Referencia da API</Link>
                            <Link href="/developer/sdks" className="transition-colors hover:text-white">SDKs</Link>
                            <Link href="/developer/community" className="transition-colors hover:text-white">Comunidade</Link>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                            <input
                                type="text"
                                placeholder="Buscar docs..."
                                className="w-64 rounded-full border border-white/10 bg-white/5 py-1.5 pl-9 pr-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            />
                        </div>
                        <Link href="/login" className="text-sm font-medium hover:text-blue-400">Dashboard</Link>
                    </div>
                </div>
            </nav>

            <header className="relative overflow-hidden border-b border-white/5 py-20">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
                <div className="pointer-events-none absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-blue-600/20 blur-[120px]" />

                <div className="relative z-10 mx-auto max-w-7xl px-6">
                    <div className="max-w-3xl">
                        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
                            <Terminal className="h-3 w-3" /> API v2.0 ja esta disponivel
                        </div>
                        <h1 className="mb-6 text-5xl font-bold tracking-tight">
                            Construa o futuro das <br />
                            <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">experiencias conversacionais.</span>
                        </h1>
                        <p className="mb-10 max-w-2xl text-xl leading-relaxed text-white/60">
                            Tudo o que voce precisa para integrar o Dialogy em suas aplicacoes. Guias abrangentes,
                            APIs poderosas e SDKs robustos para ajudar sua equipe a entregar mais rapido.
                        </p>
                        <div className="flex flex-col gap-4 sm:flex-row">
                            <Link href="/developer/docs" className="rounded-lg bg-blue-600 px-6 py-3 text-center font-semibold text-white transition-colors hover:bg-blue-500">
                                Ler a documentacao
                            </Link>
                            <button className="rounded-lg border border-white/10 px-6 py-3 font-semibold text-white transition-colors hover:bg-white/5">
                                Obter chave de API
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-6 py-20">
                <div className="mb-20 grid gap-8 md:grid-cols-3">
                    <Card
                        title="Guia de inicio rapido"
                        description="Coloque sua primeira automacao no ar em poucos minutos."
                        icon={Zap}
                        href="/developer/docs"
                    />
                    <Card
                        title="Referencia da API"
                        description="Endpoints, parametros e exemplos de resposta."
                        icon={Book}
                        href="/developer/api"
                    />
                    <Card
                        title="SDKs e bibliotecas"
                        description="Bibliotecas para Node.js, Python, Go e outras stacks."
                        icon={Box}
                        href="/developer/sdks"
                    />
                </div>

                <div className="grid gap-16 md:grid-cols-2">
                    <div>
                        <h2 className="mb-6 text-2xl font-bold">Topicos populares</h2>
                        <div className="space-y-4">
                            {[
                                { title: 'Autenticacao', icon: Shield },
                                { title: 'Webhooks', icon: Share2 },
                                { title: 'Tipos de mensagem', icon: MessagesSquare },
                                { title: 'Limites de taxa', icon: Layers },
                            ].map((item) => (
                                <Link key={item.title} href="/developer/docs" className="group flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-4 transition-all hover:border-white/10 hover:bg-white/10">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-8 w-8 items-center justify-center rounded bg-white/5">
                                            <item.icon className="h-4 w-4 text-white/70" />
                                        </div>
                                        <span className="font-medium text-white/90">{item.title}</span>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-white/30 transition-colors group-hover:text-white" />
                                </Link>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h2 className="mb-6 text-2xl font-bold">Snippet de codigo</h2>
                        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f172a] shadow-2xl">
                            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
                                <span className="text-xs font-mono text-white/50">send-message.js</span>
                                <div className="flex gap-1.5">
                                    <div className="h-2.5 w-2.5 rounded-full bg-red-500/20" />
                                    <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/20" />
                                    <div className="h-2.5 w-2.5 rounded-full bg-green-500/20" />
                                </div>
                            </div>
                            <div className="overflow-x-auto p-6">
                                <pre className="text-sm leading-relaxed">
                                    <span className="text-purple-400">const</span> <span className="text-blue-400">dialogy</span> = <span className="text-purple-400">require</span>(<span className="text-green-400">'dialogy-node'</span>);{'\n\n'}
                                    <span className="text-white/50">// Inicializar cliente</span>{'\n'}
                                    <span className="text-purple-400">const</span> client = <span className="text-purple-400">new</span> <span className="text-yellow-400">Client</span>(process.env.API_KEY);{'\n\n'}
                                    <span className="text-white/50">// Enviar uma mensagem de texto</span>{'\n'}
                                    <span className="text-purple-400">await</span> client.messages.<span className="text-blue-400">create</span>({'\n'}
                                    {'  '}to: <span className="text-green-400">'+1234567890'</span>,{'\n'}
                                    {'  '}text: <span className="text-green-400">'Ola mundo!'</span>{'\n'}
                                    {'}'});
                                </pre>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="border-t border-white/10 bg-[#020617] py-12">
                <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
                    <div className="flex items-center gap-2 text-sm text-white/40">
                        <Code2 className="h-4 w-4" />
                        <span>Construido por desenvolvedores para desenvolvedores</span>
                    </div>
                    <div className="flex gap-6 text-sm text-white/60">
                        <Link href="/developer/community" className="hover:text-white">Comunidade</Link>
                        <Link href="/developer/docs" className="hover:text-white">Documentacao</Link>
                        <Link href="/developer/api" className="hover:text-white">API</Link>
                        <Link href="/developer/sdks" className="hover:text-white">SDKs</Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}

function MessagesSquare(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2v5Z" />
            <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
        </svg>
    );
}
