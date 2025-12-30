'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Facebook, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface FacebookLoginButtonProps {
    appId: string;
    onLoginSuccess: (response: facebook.AuthResponse) => void;
    onLoginFailure?: (error: any) => void;
    scope?: string;
    label?: string;
    className?: string;
}

// Simple type definition for the FB SDK 
declare global {
    interface Window {
        FB: any;
        fbAsyncInit: () => void;
    }
}

namespace facebook {
    export interface AuthResponse {
        accessToken: string;
        expiresIn: string;
        signedRequest: string;
        userID: string;
        graphDomain: string;
        data_access_expiration_time: number;
    }
}

export function FacebookLoginButton({
    appId,
    onLoginSuccess,
    onLoginFailure,
    scope = 'public_profile,email,pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages,business_management',
    label = 'Continuar com Facebook',
    className
}: FacebookLoginButtonProps) {
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const handleLogin = () => {
        if (!window.FB) {
            toast({ title: 'SDK não carregado', description: 'Aguarde o carregamento do Facebook SDK.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            window.FB.login((response: any) => {
                setIsLoading(false);
                if (response.authResponse) {
                    onLoginSuccess(response.authResponse);
                } else {
                    if (onLoginFailure) onLoginFailure(response);
                    console.log('User cancelled login or did not fully authorize.');
                }
            }, { scope });
        } catch (error: any) {
            setIsLoading(false);
            console.error("FB Login Error:", error);
            if (window.location.protocol !== 'https:') {
                toast({
                    title: 'Erro de Protocolo (HTTPS)',
                    description: 'O Facebook requer HTTPS. Tente usar uma ferramenta de túnel (ex: ngrok) ou configure HTTPS localmente.',
                    variant: 'destructive',
                    duration: 10000
                });
            } else {
                toast({ title: 'Erro no Login', description: 'Ocorreu um erro ao tentar iniciar o login com Facebook.', variant: 'destructive' });
            }
        }
    };

    return (
        <Button
            type="button"
            onClick={handleLogin}
            className={`bg-[#1877F2] hover:bg-[#1864D9] text-white ${className}`}
            disabled={isLoading || !appId}
        >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
            {label}
        </Button>
    );
}
