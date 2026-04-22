"use client";

import * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export interface FAQItem {
  question: string;
  answer: string;
}

interface FAQSectionProps {
  title: string;
  subtitle: string;
  description?: string;
  buttonLabel?: string;
  buttonHref?: string;
  faqsLeft: FAQItem[];
  faqsRight: FAQItem[];
}

export function FAQSection({
  title,
  subtitle,
  description,
  buttonLabel,
  buttonHref = "/pricing",
  faqsLeft,
  faqsRight,
}: FAQSectionProps) {
  return (
    <div className="w-full mt-16 pt-16 border-t border-white/10">
        <div className="flex flex-col md:flex-row justify-between gap-10 mb-12">
          <div className="max-w-2xl">
            <h4 className="text-brand-green font-semibold tracking-[0.2em] text-xs uppercase mb-3">
              {subtitle}
            </h4>
            <h2 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-4">
              {title}
            </h2>
            {description && (
              <p className="text-white/50 text-base leading-relaxed">
                {description}
              </p>
            )}
          </div>
          {buttonLabel && (
            <div className="flex items-end shrink-0">
              <Link
                href={buttonHref}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white text-black font-bold hover:bg-zinc-200 transition-colors shadow-lg"
              >
                {buttonLabel}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-x-8 gap-y-4 items-start">
          <Accordion type="single" collapsible className="w-full space-y-4">
            {faqsLeft.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`left-${index}`}
                className="border border-white/10 bg-white/5 px-6 py-1 rounded-[24px] data-[state=open]:bg-white/10 data-[state=open]:border-brand-green/30 transition-all duration-300"
              >
                <AccordionTrigger className="text-white text-left font-bold text-lg hover:no-underline hover:text-brand-green [&[data-state=open]]:text-brand-green py-5">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base pb-6">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <Accordion type="single" collapsible className="w-full space-y-4">
            {faqsRight.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`right-${index}`}
                className="border border-white/10 bg-white/5 px-6 py-1 rounded-[24px] data-[state=open]:bg-white/10 data-[state=open]:border-brand-green/30 transition-all duration-300"
              >
                <AccordionTrigger className="text-white text-left font-bold text-lg hover:no-underline hover:text-brand-green [&[data-state=open]]:text-brand-green py-5">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-white/60 leading-relaxed text-base pb-6">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
    </div>
  );
}
