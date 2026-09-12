import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CreditCard,
  ScanLine,
  Barcode,
  Sparkles,
} from "lucide-react";
import { planHighlights, type OfferedPlan } from "@/lib/billing-catalog";
import styles from "./plan-offers.module.css";

export function PlanOffers({ plans }: { plans: OfferedPlan[] }) {
  return (
    <section
      id="planos"
      className={styles.section}
      aria-labelledby="plans-title"
    >
      <div className={styles.inner}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>
            <Sparkles size={14} /> PLANOS PARA CADA FASE
          </span>
          <h2 id="plans-title">
            Sua próxima fase
            <br />
            <span>começa com uma conversa.</span>
          </h2>
          <p>
            Uma equipe inteira. Um só lugar. Escolha os recursos e o volume de
            conversas que sua operação precisa.
          </p>
        </div>
        <div className={styles.grid}>
          {plans
            .filter((p) => p.id !== "enterprise")
            .map((plan) => (
              <article
                key={plan.id}
                className={`${styles.card} ${plan.highlighted ? styles.featured : ""}`}
              >
                <div className={styles.cardTop}>
                  <span>{plan.label}</span>
                  {plan.highlighted && (
                    <span className={styles.badge}>Mais escolhido</span>
                  )}
                </div>
                <p className={styles.description}>{plan.description}</p>
                <div className={styles.price}>
                  {plan.price.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                    maximumFractionDigits: 2,
                  })}
                  <small>/mês</small>
                </div>
                <p className={styles.trial}>
                  {plan.trialDays} dias para experimentar · Sem fidelidade
                </p>
                <Link
                  className={styles.cta}
                  href={`/register?next=${encodeURIComponent(`/settings/billing?plan=${plan.id}`)}`}
                >
                  Começar com {plan.label}
                  <ArrowUpRight size={17} />
                </Link>
                <div className={styles.divider} />
                <ul>
                  {planHighlights(plan.limits).map((feature) => (
                    <li key={feature}>
                      <Check size={16} />
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
        </div>
        {plans.find((p) => p.id === "enterprise") && (
          <div className={styles.enterprise}>
            <div>
              <span className={styles.eyebrow}>PARA IR ALÉM</span>
              <h3>
                {plans.find((p) => p.id === "enterprise")!.label}{" "}
                <span>Sob consulta</span>
              </h3>
              <p>{plans.find((p) => p.id === "enterprise")!.description}</p>
            </div>
            <a
              href="https://wa.me/551151994714"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.enterpriseLink}
            >
              Conversar com vendas <ArrowUpRight size={17} />
            </a>
          </div>
        )}
        {!plans.length && (
          <p role="status">
            Nenhum plano disponível para contratação no momento.
          </p>
        )}
        <div className={styles.payments}>
          <span>Pagamento pelo ASAAS</span>
          <span>
            <ScanLine size={17} /> PIX
          </span>
          <span>
            <Barcode size={17} /> Boleto
          </span>
          <span>
            <CreditCard size={17} /> Cartão de crédito
          </span>
        </div>
        <p className={styles.note}>
          Cobranças mensais. PIX e boleto são pagos a cada vencimento; cartão
          permite recorrência. Tarifas da Meta e consumo de créditos de IA são
          cobrados separadamente.
        </p>
      </div>
    </section>
  );
}
