import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export function CopyProtocolButton({ protocol }: { protocol: string }) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = () => {
        if (!protocol) return;
        navigator.clipboard.writeText(protocol);
        setIsCopied(true);
        toast({ title: "Copiado!" });
        setTimeout(() => setIsCopied(false), 2000); // 2 seconds delay
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            className="relative z-10 h-6 w-6 rounded-md bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300 transition-colors"
            onClick={handleCopy}
            type="button"
        >
            {isCopied ? <Check className="h-3.5 w-3.5 animate-in zoom-in spin-in-90 duration-300" /> : <Copy className="h-3 w-3 animate-in zoom-in duration-300" />}
        </Button>
    );
}
