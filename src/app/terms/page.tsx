import React from 'react';

export default function TermsOfUsePage() {
    return (
        <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto bg-card p-8 rounded-lg shadow-sm border border-border">
                <h1 className="text-3xl font-bold text-foreground mb-8">Termos de Uso</h1>

                <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none text-muted-foreground space-y-6">
                    <p>
                        Última atualização: {new Date().toLocaleDateString('pt-BR')}
                    </p>

                    <p>
                        Bem-vindo ao Dialogy! Estes termos e condições descrevem as regras e regulamentos para o uso do nosso aplicativo e serviços.
                    </p>
                    <p>
                        Ao acessar este site e usar nossos serviços, presumimos que você aceita estes termos e condições na íntegra. Não continue a usar o Dialogy se você não aceitar todos os termos e condições declarados nesta página.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">1. Licença de Uso</h2>
                    <p>
                        Concedemos a você uma licença limitada, não exclusiva, intransferível e revogável para usar nossos serviços para fins pessoais ou comerciais internos, sujeito a estes Termos.
                    </p>
                    <p>
                        Você concorda em não:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>Modificar, copiar, preparar trabalhos derivados, descompilar ou fazer engenharia reversa de qualquer material e software contido neste site;</li>
                        <li>Remover quaisquer direitos autorais ou outras notações de propriedade dos materiais;</li>
                        <li>Transferir os materiais para outra pessoa ou "espelhar" os materiais em qualquer outro servidor;</li>
                        <li>Usar o serviço para qualquer finalidade ilegal ou não autorizada.</li>
                    </ul>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">2. Uso Aceitável (WhatsApp e Mensagens)</h2>
                    <p>
                        O Dialogy integra-se com serviços de terceiros, como o WhatsApp. Ao usar nossa plataforma, você concorda em cumprir estritamente as políticas desses terceiros.
                    </p>
                    <p>
                        É estritamente proibido:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>Enviar SPAM ou mensagens em massa não solicitadas;</li>
                        <li>Enviar conteúdo ofensivo, ameaçador, difamatório ou ilegal;</li>
                        <li>Violar a privacidade de terceiros;</li>
                        <li>Usar a plataforma para disseminar vírus ou malware.</li>
                    </ul>
                    <p>
                        A violação destas regras pode resultar na suspensão imediata ou encerramento da sua conta sem aviso prévio.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">3. Contas e Segurança</h2>
                    <p>
                        Para acessar a maioria dos recursos do Serviço, você deve registrar uma conta. Você é responsável por manter a confidencialidade das credenciais da sua conta e é totalmente responsável por todas as atividades que ocorrem sob sua conta. Você concorda em notificar imediatamente o Dialogy sobre qualquer uso não autorizado de sua conta ou qualquer outra violação de segurança.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">4. Isenção de Responsabilidade</h2>
                    <p>
                        Os materiais e serviços no site do Dialogy são fornecidos "como estão". O Dialogy não oferece garantias, expressas ou implícitas, e, por este meio, isenta e nega todas as outras garantias, incluindo, sem limitação, garantias implícitas ou condições de comercialização, adequação a um fim específico ou não violação de propriedade intelectual ou outra violação de direitos.
                    </p>
                    <p>
                        Além disso, o Dialogy não garante ou faz qualquer representação relativa à precisão, aos resultados prováveis ou à confiabilidade do uso dos materiais em seu site ou de outra forma relacionado a esses materiais ou em sites vinculados a este site.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">5. Limitação de Responsabilidade</h2>
                    <p>
                        Em nenhum caso o Dialogy ou seus fornecedores serão responsáveis por quaisquer danos (incluindo, sem limitação, danos por perda de dados ou lucro ou devido a interrupção dos negócios) decorrentes do uso ou da incapacidade de usar os materiais no Dialogy, mesmo que o Dialogy ou um representante autorizado do Dialogy tenha sido notificado oralmente ou por escrito da possibilidade de tais danos.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">6. Precisão dos Materiais</h2>
                    <p>
                        Os materiais exibidos no site do Dialogy podem incluir erros técnicos, tipográficos ou fotográficos. O Dialogy não garante que qualquer material em seu site seja preciso, completo ou atual. O Dialogy pode fazer alterações nos materiais contidos em seu site a qualquer momento, sem aviso prévio. No entanto, o Dialogy não se compromete a atualizar os materiais.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">7. Modificações</h2>
                    <p>
                        O Dialogy pode revisar estes termos de serviço do site a qualquer momento, sem aviso prévio. Ao usar este site, você concorda em ficar vinculado à versão atual desses termos de serviço.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">8. Lei Aplicável</h2>
                    <p>
                        Estes termos e condições são regidos e interpretados de acordo com as leis do Brasil e você se submete irrevogavelmente à jurisdição exclusiva dos tribunais naquele estado ou localidade.
                    </p>
                </div>
            </div>
        </div>
    );
}
