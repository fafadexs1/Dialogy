import { buildPageMetadata } from '@/lib/seo/metadata';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { JsonLd, getBreadcrumbSchema } from '@/lib/seo/schema';

const updatedAtLabel = '20/03/2026';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/privacy' });
}

export default function PrivacyPolicyPage() {
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Politica de Privacidade', path: '/privacy' },
    ]);

    return (
        <div className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
            <JsonLd id="privacy-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/privacy" />
            <div className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-8 shadow-sm">
                <h1 className="mb-8 text-3xl font-bold text-foreground">Politica de Privacidade</h1>

                <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground sm:prose-base dark:prose-invert">
                    <p>Ultima atualizacao: {updatedAtLabel}</p>

                    <p>
                        A privacidade dos usuarios da Dialogy e importante. Esta politica explica como coletamos,
                        usamos, armazenamos e protegemos informacoes relacionadas ao uso da plataforma.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">1. Informacoes que coletamos</h2>
                    <p>Podemos coletar dados necessarios para operar o servico, incluindo:</p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>Informacoes de conta, como nome, email, telefone e credenciais protegidas.</li>
                        <li>Dados de uso, como acessos, logs e interacoes com a plataforma.</li>
                        <li>Dados de mensagens, contatos e arquivos trafegados pelos canais integrados.</li>
                    </ul>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">2. Como usamos os dados</h2>
                    <p>Usamos os dados para operar, manter, melhorar e proteger a plataforma, incluindo:</p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>entrega dos recursos contratados;</li>
                        <li>suporte tecnico e atendimento ao cliente;</li>
                        <li>seguranca, auditoria e prevencao de abuso;</li>
                        <li>melhoria do produto, analytics e comunicacoes operacionais.</li>
                    </ul>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">3. Compartilhamento de dados</h2>
                    <p>
                        A Dialogy nao vende dados pessoais. O compartilhamento ocorre apenas quando necessario para
                        prestar o servico, cumprir obrigacoes legais ou operar integracoes com terceiros, como Meta
                        e outros provedores de comunicacao.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">4. Direitos do titular</h2>
                    <p>Em linha com a LGPD, o titular pode solicitar, quando aplicavel:</p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>confirmacao e acesso aos dados;</li>
                        <li>correcao de dados incompletos ou desatualizados;</li>
                        <li>anonimizacao, bloqueio ou eliminacao de dados desnecessarios;</li>
                        <li>portabilidade, informacoes sobre compartilhamento e revogacao de consentimento.</li>
                    </ul>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">5. Seguranca</h2>
                    <p>
                        Empregamos medidas tecnicas e organizacionais razoaveis para proteger as informacoes
                        processadas. Ainda assim, nenhum metodo de transmissao ou armazenamento eletronico e
                        completamente infalivel.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">6. Retencao e alteracoes</h2>
                    <p>
                        Os dados sao mantidos pelo tempo necessario para cumprir finalidades operacionais, contratuais
                        e legais. Esta politica pode ser atualizada periodicamente, e a versao vigente sera publicada
                        nesta pagina.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">7. Contato</h2>
                    <p>
                        Em caso de duvidas sobre esta politica ou sobre o tratamento de dados, entre em contato com a
                        equipe responsavel pelos canais oficiais de suporte da Dialogy.
                    </p>
                </div>
            </div>
        </div>
    );
}
