
'use client';

import { cn } from '@/lib/utils';
import { MessageSquare, Users, CheckCircle } from 'lucide-react';
import Link from 'next/link';

const steps = [
    { id: 'message', name: 'Mensagem', icon: MessageSquare, href: '/campaigns/new/message' },
    { id: 'audience', name: 'Público', icon: Users, href: '/campaigns/new/audience' },
    { id: 'review', name: 'Revisão', icon: CheckCircle, href: '/campaigns/new/review' },
];

export function CampaignSteps({ currentStep }: { currentStep: 'message' | 'audience' | 'review' }) {
    const currentStepIndex = steps.findIndex(step => step.id === currentStep);

    return (
        <nav aria-label="Progress">
            <ol role="list" className="flex items-center">
                {steps.map((step, stepIdx) => (
                    <li key={step.name} className={cn('relative', stepIdx !== steps.length - 1 ? 'pr-8 sm:pr-20 flex-1' : '')}>
                        {stepIdx < currentStepIndex ? (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    <div className="h-0.5 w-full bg-primary" />
                                </div>
                                <Link href={step.href} className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary hover:bg-primary/90">
                                    <step.icon className="h-5 w-5 text-white" aria-hidden="true" />
                                    <span className="sr-only">{step.name}</span>
                                </Link>
                            </>
                        ) : stepIdx === currentStepIndex ? (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    <div className="h-0.5 w-full bg-gray-200" />
                                </div>
                                <div className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-background" aria-current="step">
                                    <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
                                    <span className="sr-only">{step.name}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    <div className="h-0.5 w-full bg-gray-200" />
                                </div>
                                <div className="pointer-events-none relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 bg-background">
                                    <step.icon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                                    <span className="sr-only">{step.name}</span>
                                </div>
                            </>
                        )}
                         <div className="absolute -bottom-6 text-center w-full">
                            <p className={cn("text-xs", stepIdx <= currentStepIndex ? "font-semibold text-primary" : "text-muted-foreground")}>
                                {step.name}
                            </p>
                        </div>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

