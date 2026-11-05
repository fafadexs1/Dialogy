'use client';

import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { DeveloperBrand } from '@/components/developer/developer-brand';

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
    const templateSendExample = `curl --location 'https://dialogy.klyraai.com.br/api/agent/templates/send' \\
  --header 'Content-Type: application/json' \\
  --header 'Authorization: Bearer TOKEN_DO_SYSTEM_AGENT' \\
  --data '{
    "numberid": "5561995215930",
    "instanceName": "zap7",
    "name": "fatura_velpro_clientes_2026_maio",
    "language": "pt_BR",
    "components": [
      {
        "type": "header",
        "parameters": [
          {
            "type": "image",
            "image": {
              "link": "https://velpro.net.br/uploads/site-assets/public/company-logo.png?t=1770142936029"
            }
          }
        ]
      },
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Nome do Cliente" },
          { "type": "text", "text": "123456" },
          { "type": "text", "text": "31/05/2026" },
          { "type": "text", "text": "99,90" },
          { "type": "text", "text": "78910" }
        ]
      },
      {
        "type": "button",
        "sub_type": "order_details",
        "index": 0,
        "parameters": [
          {
            "type": "action",
            "action": {
              "order_details": {
                "reference_id": "fatura_123456_78910",
                "type": "digital-goods",
                "payment_type": "br",
                "payment_settings": [
                  {
                    "type": "pix_dynamic_code",
                    "pix_dynamic_code": {
                      "code": "00020101021226860014br.gov.bcb.pix...",
                      "merchant_name": "VELPRO TELECOM",
                      "key": "00000000000000",
                      "key_type": "CNPJ"
                    }
                  }
                ],
                "currency": "BRL",
                "total_amount": {
                  "value": 9990,
                  "offset": 100
                },
                "order": {
                  "status": "pending",
                  "items": [
                    {
                      "retailer_id": "fatura_123456",
                      "name": "Fatura 123456",
                      "amount": {
                        "value": 9990,
                        "offset": 100
                      },
                      "quantity": 1
                    }
                  ],
                  "subtotal": {
                    "value": 9990,
                    "offset": 100
                  },
                  "tax": {
                    "value": 0,
                    "offset": 100
                  }
                }
              }
            }
          }
        ]
      }
    ]
  }'`;

    const templateSimpleExample = `{
  "numberid": "5561995215930",
  "instanceName": "zap7",
  "name": "nome_do_template_aprovado",
  "language": "pt_BR",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Primeira variavel" },
        { "type": "text", "text": "Segunda variavel" }
      ]
    }
  ]
}`;

    const templateResponseExample = `{
  "success": true,
  "message": "Template sent successfully.",
  "apiResponse": {
    "key": {
      "fromMe": true,
      "id": "wamid...",
      "remoteJid": "5561995215930@s.whatsapp.net"
    },
    "status": "PENDING"
  }
}`;

    return (
        <div className="min-h-screen bg-[#030712] text-white selection:bg-blue-500/30">
            <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#030712]/50 backdrop-blur-xl">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
                    <div className="flex items-center gap-8">
                        <DeveloperBrand />
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
                            <Link href="#agent-templates" className="block rounded-lg px-3 py-2 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white">Templates por Agente</Link>
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
                            <strong>Base URL:</strong> <code className="text-white">https://dialogy.klyraai.com.br</code>
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

                    <section id="agent-templates" className="mb-16">
                        <h2 className="mb-6 flex items-center gap-2 text-2xl font-bold">
                            Templates por Agente <span className="rounded-full bg-white/5 px-2 py-0.5 text-sm font-normal text-white/40">WhatsApp</span>
                        </h2>
                        <p className="mb-6 text-white/60">
                            Use este endpoint para enviar templates aprovados da Meta pelo WhatsApp Cloud API conectado na Dialogy. A Dialogy valida o token do agente, resolve o workspace do agente, localiza ou cria o contato/chat e repassa os componentes para a Evolution API.
                        </p>

                        <div className="space-y-8">
                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Endpoint</h3>
                                <Endpoint method="POST" path="/api/agent/templates/send" description="Envia um template aprovado pelo WhatsApp usando uma instancia conectada ao workspace do agente." />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Autenticacao</h3>
                                <p className="mb-4 text-sm leading-relaxed text-white/60">
                                    Envie o token de um system agent ativo no header <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">Authorization</code>. O token precisa pertencer ao mesmo workspace da instancia informada.
                                </p>
                                <CodeBlock language="bash" code={`Authorization: Bearer TOKEN_DO_SYSTEM_AGENT`} />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Corpo da Requisicao</h3>
                                <div className="overflow-hidden rounded-xl border border-white/10">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-white/5 text-white/70">
                                            <tr>
                                                <th className="px-4 py-3 font-semibold">Campo</th>
                                                <th className="px-4 py-3 font-semibold">Tipo</th>
                                                <th className="px-4 py-3 font-semibold">Obrigatorio</th>
                                                <th className="px-4 py-3 font-semibold">Descricao</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/10 text-white/60">
                                            <tr>
                                                <td className="px-4 py-3 font-mono text-white">numberid</td>
                                                <td className="px-4 py-3">string</td>
                                                <td className="px-4 py-3">Sim</td>
                                                <td className="px-4 py-3">Numero do destinatario com DDI e DDD. Exemplo: 5561995215930.</td>
                                            </tr>
                                            <tr>
                                                <td className="px-4 py-3 font-mono text-white">instanceName</td>
                                                <td className="px-4 py-3">string</td>
                                                <td className="px-4 py-3">Sim</td>
                                                <td className="px-4 py-3">Nome da instancia WhatsApp na Dialogy/Evolution. Exemplo: zap7.</td>
                                            </tr>
                                            <tr>
                                                <td className="px-4 py-3 font-mono text-white">name</td>
                                                <td className="px-4 py-3">string</td>
                                                <td className="px-4 py-3">Sim</td>
                                                <td className="px-4 py-3">Nome exato do template aprovado na Meta.</td>
                                            </tr>
                                            <tr>
                                                <td className="px-4 py-3 font-mono text-white">language</td>
                                                <td className="px-4 py-3">string</td>
                                                <td className="px-4 py-3">Sim</td>
                                                <td className="px-4 py-3">Codigo do idioma do template. Exemplo: pt_BR.</td>
                                            </tr>
                                            <tr>
                                                <td className="px-4 py-3 font-mono text-white">components</td>
                                                <td className="px-4 py-3">array</td>
                                                <td className="px-4 py-3">Sim</td>
                                                <td className="px-4 py-3">Componentes do template no mesmo formato aceito pela Evolution API: header, body e button.</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Template simples com variaveis no BODY</h3>
                                <p className="mb-4 text-sm leading-relaxed text-white/60">
                                    Para templates com variaveis posicionais, envie os parametros na mesma ordem dos marcadores do template: <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">{'{{1}}'}</code>, <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">{'{{2}}'}</code> e assim por diante.
                                </p>
                                <CodeBlock code={templateSimpleExample} />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Template ORDER_DETAILS com Pix</h3>
                                <p className="mb-4 text-sm leading-relaxed text-white/60">
                                    Templates com header de imagem precisam receber o componente <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">header</code> com uma URL publica HTTPS. Para botao de detalhes do pedido, use <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">sub_type: order_details</code> e parametro <code className="rounded bg-white/10 px-1.5 py-0.5 text-white">type: action</code>.
                                </p>
                                <CodeBlock language="bash" code={templateSendExample} />
                            </div>

                            <div>
                                <h3 className="mb-4 text-lg font-semibold">Resposta</h3>
                                <p className="mb-4 text-sm leading-relaxed text-white/60">
                                    Uma resposta de sucesso indica que a requisicao foi aceita pela Evolution/WhatsApp. O status inicial pode vir como PENDING; a entrega final depende dos eventos de status do provedor.
                                </p>
                                <CodeBlock code={templateResponseExample} />
                            </div>

                            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                                <h3 className="mb-2 text-sm font-semibold text-amber-200">Cuidados importantes</h3>
                                <ul className="space-y-2 text-sm leading-relaxed text-amber-100/80">
                                    <li>O template precisa estar aprovado na Meta e disponivel na instancia informada.</li>
                                    <li>Se o template tiver HEADER IMAGE, o envio deve incluir um header com imagem valida; caso contrario a Meta retorna erro de formato.</li>
                                    <li>Valores monetarios em order_details usam centavos com offset 100. Exemplo: R$ 99,90 deve ser enviado como value 9990 e offset 100.</li>
                                    <li>O valor do exemplo nao e um padrao: calcule total_amount, subtotal e o valor dos itens para cada fatura e confira o valor do codigo Pix gerado na origem. Divergencias identificadas impedem o envio.</li>
                                    <li>A chave Pix e o codigo Pix devem ser reais no ambiente de producao. Placeholders podem gerar falhas ou botoes sem acao util.</li>
                                </ul>
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
