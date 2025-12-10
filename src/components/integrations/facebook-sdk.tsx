'use client';

import { useEffect, useRef } from 'react';
import Script from 'next/script';

interface FacebookSDKProps {
    appId: string;
    version?: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
}

declare global {
    interface Window {
        fbAsyncInit: () => void;
        FB: any;
    }
}

export function FacebookSDK({
    appId,
    version = 'v18.0',
    autoLogAppEvents = true,
    xfbml = true,
}: FacebookSDKProps) {
    const isLoaded = useRef(false);

    useEffect(() => {
        // Definir o callback de inicialização
        window.fbAsyncInit = function () {
            window.FB.init({
                appId: appId,
                cookie: true,
                xfbml: xfbml,
                version: version,
            });

            if (autoLogAppEvents) {
                window.FB.AppEvents.logPageView();
            }

            // Check login status on init
            window.FB.getLoginStatus(function (response: any) {
                console.log('Facebook SDK Initialized. Login Status:', response.status);
            });

            isLoaded.current = true;
        };
    }, [appId, version, autoLogAppEvents, xfbml]);

    return (
        <Script
            id="facebook-jssdk"
            src="https://connect.facebook.net/en_US/sdk.js"
            strategy="afterInteractive"
            onLoad={() => {
                // Fallback case: if cached or loaded by other means
                if (window.FB && !isLoaded.current) {
                    // Force re-init if needed or just mark as loaded
                    isLoaded.current = true;
                }
            }}
        />
    );
}

// Helper para verificar status globalmente se necessário
export const checkLoginState = (callback?: (response: any) => void) => {
    if (typeof window !== 'undefined' && window.FB) {
        window.FB.getLoginStatus((response: any) => {
            if (callback) callback(response);
        });
    } else {
        console.warn('Facebook SDK not loaded yet.');
    }
};
