import React from 'react';

export default function PrivacyPolicyPage() {
    return (
        <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto bg-card p-8 rounded-lg shadow-sm border border-border">
                <h1 className="text-3xl font-bold text-foreground mb-8">Política de Privacidade</h1>

                <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none text-muted-foreground space-y-6">
                    <p>
                        Última atualização: {new Date().toLocaleDateString('pt-BR')}
                    </p>

                    <p>
                        A sua privacidade é importante para nós. É política do Dialogy respeitar a sua privacidade em relação a qualquer informação sua que possamos coletar no site Dialogy, e outros sites que possuímos e operamos.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">1. Informações que coletamos</h2>
                    <p>
                        Solicitamos informações pessoais apenas quando realmente precisamos delas para lhe fornecer um serviço. Fazemo-lo por meios justos e legais, com o seu conhecimento e consentimento. Também informamos por que estamos coletando e como será usado.
                    </p>
                    <p>
                        Podemos coletar os seguintes tipos de informações:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li><strong>Informações da Conta:</strong> Nome, endereço de e-mail, número de telefone e senha criptografada.</li>
                        <li><strong>Dados de Uso:</strong> Informações sobre como você usa nosso serviço, logs de acesso, e interações com a plataforma.</li>
                        <li><strong>Dados de Mensagens:</strong> Para fornecer o serviço de chat, processamos e armazenamos mensagens, contatos e arquivos de mídia trafegados através da nossa plataforma.</li>
                    </ul>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">2. Uso das Informações</h2>
                    <p>
                        Apenas retemos as informações coletadas pelo tempo necessário para fornecer o serviço solicitado. Quando armazenamos dados, protegemos dentro de meios comercialmente aceitáveis para evitar perdas e roubos, bem como acesso, divulgação, cópia, uso ou modificação não autorizados.
                    </p>
                    <p>
                        Usamos suas informações para:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>Fornecer, operar e manter nosso serviço;</li>
                        <li>Melhorar, personalizar e expandir nosso serviço;</li>
                        <li>Entender e analisar como você usa nosso serviço;</li>
                        <li>Desenvolver novos produtos, serviços, recursos e funcionalidades;</li>
                        <li>Comunicar com você, diretamente ou através de um dos nossos parceiros, inclusive para atendimento ao cliente, para fornecer atualizações e outras informações relacionadas ao serviço, e para fins de marketing e promoção.</li>
                    </ul>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">3. Compartilhamento de Dados</h2>
                    <p>
                        Não compartilhamos informações de identificação pessoal publicamente ou com terceiros, exceto quando exigido por lei ou para a prestação do serviço (ex: integração com WhatsApp/Meta).
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">4. Seus Direitos (LGPD)</h2>
                    <p>
                        Você é livre para recusar a nossa solicitação de informações pessoais, entendendo que talvez não possamos fornecer alguns dos serviços desejados.
                    </p>
                    <p>
                        De acordo com a Lei Geral de Proteção de Dados (LGPD), você tem direito a:
                    </p>
                    <ul className="list-disc pl-5 space-y-2">
                        <li>Acessar seus dados;</li>
                        <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
                        <li>Solicitar a anonimização, bloqueio ou eliminação de dados desnecessários;</li>
                        <li>Solicitar a portabilidade dos dados;</li>
                        <li>Revogar o consentimento a qualquer momento.</li>
                    </ul>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">5. Segurança</h2>
                    <p>
                        Valorizamos sua confiança em nos fornecer suas informações pessoais, portanto, estamos nos empenhando para usar meios comercialmente aceitáveis de protegê-las. Mas lembre-se que nenhum método de transmissão pela internet, ou método de armazenamento eletrônico é 100% seguro e confiável, e não podemos garantir sua segurança absoluta.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">6. Links para Outros Sites</h2>
                    <p>
                        Nosso serviço pode conter links para outros sites que não são operados por nós. Se você clicar em um link de terceiros, você será direcionado para o site desse terceiro. Aconselhamos fortemente que reveja a Política de Privacidade de cada site que visita.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">7. Alterações nesta Política de Privacidade</h2>
                    <p>
                        Podemos atualizar nossa Política de Privacidade de tempos em tempos. Assim, aconselhamos que reveja esta página periodicamente para quaisquer alterações. Notificaremos sobre quaisquer alterações publicando a nova Política de Privacidade nesta página.
                    </p>

                    <h2 className="text-xl font-semibold text-foreground mt-6 mb-4">8. Contato</h2>
                    <p>
                        Se você tiver alguma dúvida ou sugestão sobre nossa Política de Privacidade, não hesite em nos contatar através do suporte na plataforma.
                    </p>
                </div>
            </div>
        </div>
    );
}
