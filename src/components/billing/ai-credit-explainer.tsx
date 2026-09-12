import { ChevronDown } from 'lucide-react';

const quantities = [100, 1_000, 10_000];

export function AiCreditExplainer({ creditValueBrl }: { creditValueBrl: number }) {
  if (!Number.isFinite(creditValueBrl) || creditValueBrl <= 0) return null;
  const money = (value: number) => value.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6,
  });

  return <div className="space-y-4">
    <h3 className="text-base font-semibold">Quanto vale um crédito de IA?</h3>
    <p className="text-sm"><strong>1 crédito de IA equivale a {money(creditValueBrl)}</strong> de saldo para usar os recursos inteligentes da Dialogy.</p>
    <table className="w-full max-w-lg text-left text-sm">
      <caption className="pb-2 text-left text-sm text-muted-foreground">Equivalência de créditos</caption>
      <thead><tr className="border-b"><th scope="col" className="py-2 pr-4">Créditos</th><th scope="col" className="py-2 text-right">Valor</th></tr></thead>
      <tbody>{quantities.map(quantity=><tr key={quantity} className="border-b last:border-0">
        <td className="py-2 pr-4 tabular-nums">{quantity.toLocaleString('pt-BR')}</td>
        <td className="py-2 text-right tabular-nums">{money(quantity * creditValueBrl)}</td>
      </tr>)}</tbody>
    </table>
    <details className="group border-t pt-4 text-sm text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-foreground [&::-webkit-details-marker]:hidden">Como os créditos são utilizados<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
      <div className="mt-3 space-y-3 text-xs leading-relaxed">
      <p>O consumo varia conforme o volume de informações processadas e das respostas geradas. Isso inclui as instruções do agente, o histórico e o contexto analisado, além da mensagem enviada.</p>
      <p>Um atendimento pode envolver várias etapas de processamento. Por isso, um crédito não equivale a uma quantidade fixa de mensagens. O consumo pode ser fracionado, sem descontar um crédito inteiro a cada interação.</p>
      <p>Durante o processamento, parte do saldo pode ficar reservada. Uma reserva não é uma cobrança concluída: o consumo confirmado aparece no extrato, e o valor reservado não utilizado volta a ficar disponível. Reservas pendentes de conferência continuam em processamento até a conclusão.</p>
      </div>
    </details>
  </div>;
}
