'use client';

import Image from "next/image";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

function CodeBlock({ code, language = "json" }: { code: string, language?: string }) {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0f172a] group">
            <div className="absolute right-3 top-3">
                <button
                    onClick={copyToClipboard}
                    className="rounded-md bg-white/5 p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                >
                    {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                </button>
            </div>
            <div className="overflow-x-auto p-4">
                <pre className="font-mono text-sm text-white/80">
                    <code>{code}</code>
                </pre>
            </div>
        </div>
    );
}

function Endpoint({ method, path, description }: { method: string, path: string, description: string }) {
    const methodColors: Record<string, string> = {
        GET: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        POST: "bg-green-500/10 text-green-400 border-green-500/20",
        PUT: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
        DELETE: "bg-red-500/10 text-red-400 border-red-500/20",
    };

    return (
        <div className="mb-4 rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="mb-2 flex items-center gap-3">
                <span className={`rounded border px-2 py-0.5 text-xs font-bold ${methodColors[method] || "bg-gray-500/10 text-gray-400"}`}>
                    {method}
                </span>
                <code className="text-sm font-mono text-white/80">{path}</code>
            </div>
            <p className="text-sm text-white/60">{description}</p>
        </div>
    );
}

export default function ApiClient() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-8">
                        <Link href="/developer" className="flex items-center gap-2 text-xl font-bold tracking-tight">
                            <Image src="/logo.png" alt="Dialogy" width={170} height={48} className="h-12 w-auto" />
                            <span className="ml-2 font-normal text-white/40">API</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer" className="text-sm font-medium text-white/60 hover:text-white">Voltar para Developer Hub</Link>
                    </div>
                </div>
            </nav>

            <div className="mx-auto flex max-w-7xl flex-col gap-12 px-6 py-12 md:flex-row">
                <aside className="sticky top-24 h-fit w-full shrink-0 space-y-8 md:w-64">
                    <div>
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/40">Recursos</h3>
                        <div className="space-y-1">
                            <Link href="#messages" className="block rounded-lg bg-blue-600/10 px-3 py-2 text-sm font-medium text-blue-400">Mensagens</Link>
                            <Link href="#contacts" className="block rounded-lg px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white">Contatos</Link>
                            <Link href="#webhooks" className="block rounded-lg px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white">Webhooks</Link>
                        </div>
                    </div>
                </aside>

                <main className="max-w-3xl flex-1">
                    <div className="mb-12">
                        <h1 className="mb-6 text-4xl font-bold">Referencia da API</h1>
                        <p className="mb-8 text-xl leading-relaxed text-white/60">
                            A API do Dialogy e organizada em torno de REST. Nossa API tem URLs orientadas a recursos, aceita corpos de solicitacao codificados em formulario, retorna respostas em JSON e usa codigos HTTP padrao.
                        </p>

                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-200">
                            <strong>Base URL:</strong> <code className="text-white">https://api.dialogy.com/v1</code>
                        </div>
                    </div>

                    <section id="messages" className="mb-16">
                        <h2 className="mb-6 flex items-center gap-2 text-2xl font-bold">
                            Mensagens <span className="rounded-full bg-white/5 px-2 py-0.5 text-sm font-normal text-white/40">Recurso</span>
                        </h2>
                        <p className="mb-6 text-white/60">
                            O recurso de mensagens permite que voce envie e receba mensagens atraves de varios canais.
                        </p>

                        <div className="space-y-6">
                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Endpoints</h3>
                                <Endpoint method="POST" path="/messages" description="Envia uma nova mensagem para um contato." />
                                <Endpoint method="GET" path="/messages" description="Lista todas as mensagens enviadas e recebidas." />
                                <Endpoint method="GET" path="/messages/:id" description="Recupera os detalhes de uma mensagem especifica." />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Exemplo de Requisicao</h3>
                                <CodeBlock code={`{
  "to": "+5511999999999",
  "channel": "whatsapp",
  "content": {
    "type": "text",
    "text": "Ola! Como posso ajudar voce hoje?"
  }
}`} />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Exemplo de Resposta</h3>
                                <CodeBlock code={`{
  "id": "msg_123456789",
  "status": "queued",
  "created_at": "2023-10-27T10:00:00Z"
}`} />
                            </div>
                        </div>
                    </section>

                    <section id="contacts" className="mb-16">
                        <h2 className="mb-6 flex items-center gap-2 text-2xl font-bold">
                            Contatos <span className="rounded-full bg-white/5 px-2 py-0.5 text-sm font-normal text-white/40">Recurso</span>
                        </h2>
                        <p className="mb-6 text-white/60">
                            Gerencie sua base de contatos e seus metadados.
                        </p>

                        <div className="space-y-6">
                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Endpoints</h3>
                                <Endpoint method="POST" path="/contacts" description="Cria um novo contato." />
                                <Endpoint method="GET" path="/contacts" description="Lista todos os contatos." />
                            </div>
                        </div>
                    </section>
                </main>
            </div>
        </div>
    );
}
