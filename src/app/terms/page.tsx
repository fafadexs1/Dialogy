import { buildPageMetadata } from '@/lib/seo/metadata';
import { StoredSeoJsonLd } from '@/components/seo/stored-json-ld';
import { JsonLd, getBreadcrumbSchema } from '@/lib/seo/schema';

const updatedAtLabel = '20/03/2026';

export async function generateMetadata() {
    return buildPageMetadata({ pathname: '/terms' });
}

export default function TermsOfUsePage() {
    const breadcrumbSchema = getBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Termos de Uso', path: '/terms' },
    ]);

    return (
        <div className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
            <JsonLd id="terms-breadcrumb-schema" data={breadcrumbSchema} />
            <StoredSeoJsonLd pathname="/terms" />
            <div className="mx-auto max-w-4xl rounded-lg border border-border bg-card p-8 shadow-sm">
                <h1 className="mb-8 text-3xl font-bold text-foreground">Termos de Uso</h1>

                <div className="prose prose-sm max-w-none space-y-6 text-muted-foreground sm:prose-base dark:prose-invert">
                    <p>Ultima atualizacao: {updatedAtLabel}</p>

                    <p>
                        Estes Termos de Uso regulam o acesso e a utilizacao da plataforma Dialogy. Ao usar o servico,
                        o usuario declara que leu e concorda com as regras aqui descritas.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">1. Licenca de uso</h2>
                    <p>
                        A Dialogy concede uma licenca limitada, nao exclusiva, intransferivel e revogavel para uso da
                        plataforma conforme os planos contratados e as politicas aplicaveis.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">2. Uso aceitavel</h2>
                    <p>Ao utilizar a plataforma, o usuario se compromete a nao:</p>
                    <ul className="list-disc space-y-2 pl-5">
                        <li>enviar spam, mensagens em massa nao solicitadas ou conteudo ilegal;</li>
                        <li>violar politicas de terceiros integrados, como Meta e provedores de comunicacao;</li>
                        <li>tentar acessar areas, dados ou recursos sem autorizacao;</li>
                        <li>usar a plataforma para distribuir malware, fraudes ou abuso operacional.</li>
                    </ul>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">3. Contas e seguranca</h2>
                    <p>
                        O usuario e responsavel pelas credenciais de acesso e por todas as atividades realizadas em sua
                        conta. Qualquer uso indevido ou suspeita de comprometimento deve ser comunicado imediatamente.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">4. Integracoes e terceiros</h2>
                    <p>
                        A Dialogy depende de integracoes com terceiros para parte da operacao. A disponibilidade,
                        limites e politicas desses terceiros podem impactar o servico, sem que isso represente violacao
                        contratual automatica pela plataforma.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">5. Isencao e limitacao de responsabilidade</h2>
                    <p>
                        O servico e fornecido conforme disponibilidade e escopo contratado. Na extensao maxima permitida
                        pela legislacao aplicavel, a Dialogy nao sera responsavel por danos indiretos, lucros cessantes
                        ou perdas decorrentes de uso indevido, indisponibilidade de terceiros ou descumprimento das
                        regras aqui previstas.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">6. Alteracoes e encerramento</h2>
                    <p>
                        A Dialogy pode atualizar estes termos, funcionalidades e regras operacionais sempre que
                        necessario. O uso continuado da plataforma apos a publicacao de nova versao representa aceite
                        das alteracoes.
                    </p>

                    <h2 className="mb-4 mt-6 text-xl font-semibold text-foreground">7. Lei aplicavel</h2>
                    <p>
                        Estes termos sao regidos pelas leis brasileiras. Eventuais disputas serao tratadas no foro
                        competente, observadas as disposicoes legais aplicaveis.
                    </p>
                </div>
            </div>
        </div>
    );
}
