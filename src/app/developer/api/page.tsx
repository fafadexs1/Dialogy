'use client';

import React from "react";
import Link from "next/link";
import { Code2, Copy, Check } from "lucide-react";
import { useState } from "react";

function CodeBlock({ code, language = "json" }: { code: string, language?: string }) {
    const [copied, setCopied] = useState(false);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="relative rounded-lg bg-[#0f172a] border border-white/10 overflow-hidden group">
            <div className="absolute top-3 right-3">
                <button
                    onClick={copyToClipboard}
                    className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
            </div>
            <div className="p-4 overflow-x-auto">
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
        <div className="p-4 rounded-xl border border-white/5 bg-white/5 mb-4">
            <div className="flex items-center gap-3 mb-2">
                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${methodColors[method] || "bg-gray-500/10 text-gray-400"}`}>
                    {method}
                </span>
                <code className="text-sm font-mono text-white/80">{path}</code>
            </div>
            <p className="text-sm text-white/60">{description}</p>
        </div>
    );
}

export default function ApiPage() {
    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            {/* Navbar */}
            <nav className="border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <Link href="/developer" className="font-bold text-xl tracking-tight flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Code2 className="w-5 h-5 text-white" />
                            </div>
                            Dialogy <span className="text-white/40 font-normal">API</span>
                        </Link>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link href="/developer" className="text-sm font-medium text-white/60 hover:text-white">Voltar para Developer Hub</Link>
                    </div>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row gap-12">
                {/* Sidebar */}
                <aside className="w-full md:w-64 shrink-0 space-y-8 sticky top-24 h-fit">
                    <div>
                        <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4">Recursos</h3>
                        <div className="space-y-1">
                            <Link href="#messages" className="block px-3 py-2 rounded-lg bg-blue-600/10 text-blue-400 font-medium text-sm">Mensagens</Link>
                            <Link href="#contacts" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Contatos</Link>
                            <Link href="#webhooks" className="block px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors text-sm">Webhooks</Link>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 max-w-3xl">
                    <div className="mb-12">
                        <h1 className="text-4xl font-bold mb-6">Referência da API</h1>
                        <p className="text-xl text-white/60 leading-relaxed mb-8">
                            A API do Dialogy é organizada em torno de REST. Nossa API tem URLs orientadas a recursos, aceita corpos de solicitação codificados em formulário, retorna respostas codificadas em JSON e usa códigos de resposta HTTP padrão, autenticação e verbos.
                        </p>

                        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-200 text-sm">
                            <strong>Base URL:</strong> <code className="text-white">https://api.dialogy.com/v1</code>
                        </div>
                    </div>

                    <section id="messages" className="mb-16">
                        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                            Mensagens <span className="text-sm font-normal text-white/40 bg-white/5 px-2 py-0.5 rounded-full">Recurso</span>
                        </h2>
                        <p className="text-white/60 mb-6">
                            O recurso de mensagens permite que você envie e receba mensagens através de vários canais.
                        </p>

                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4">Endpoints</h3>
                                <Endpoint method="POST" path="/messages" description="Envia uma nova mensagem para um contato." />
                                <Endpoint method="GET" path="/messages" description="Lista todas as mensagens enviadas e recebidas." />
                                <Endpoint method="GET" path="/messages/:id" description="Recupera os detalhes de uma mensagem específica." />
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold mb-4">Exemplo de Requisição (Enviar Mensagem)</h3>
                                <CodeBlock code={`{
  "to": "+5511999999999",
  "channel": "whatsapp",
  "content": {
    "type": "text",
    "text": "Olá! Como posso ajudar você hoje?"
  }
}`} />
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold mb-4">Exemplo de Resposta</h3>
                                <CodeBlock code={`{
  "id": "msg_123456789",
  "status": "queued",
  "created_at": "2023-10-27T10:00:00Z"
}`} />
                            </div>
                        </div>
                    </section>

                    <section id="contacts" className="mb-16">
                        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                            Contatos <span className="text-sm font-normal text-white/40 bg-white/5 px-2 py-0.5 rounded-full">Recurso</span>
                        </h2>
                        <p className="text-white/60 mb-6">
                            Gerencie sua base de contatos e seus metadados.
                        </p>

                        <div className="space-y-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4">Endpoints</h3>
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
