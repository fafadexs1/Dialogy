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
    version = 'v25.0',
    autoLogAppEvents = true,
    xfbml = true,
}: FacebookSDKProps) {
    const isLoaded = useRef(false);
    const canCheckLoginStatus = () => {
        if (typeof window === 'undefined') return false;
        return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    };

    useEffect(() => {
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

            if (canCheckLoginStatus()) {
                window.FB.getLoginStatus(function (response: any) {
                    console.log('Facebook SDK Initialized. Login Status:', response.status);
                });
            } else {
                console.warn('Skipping FB.getLoginStatus because page is not served over HTTPS.');
            }

            isLoaded.current = true;
        };
    }, [appId, version, autoLogAppEvents, xfbml]);

    return (
        <Script
            id="facebook-jssdk"
            src="https://connect.facebook.net/en_US/sdk.js"
            strategy="afterInteractive"
            onLoad={() => {
                if (typeof window === 'undefined') return;
                if (window.FB && !isLoaded.current) {
                    isLoaded.current = true;
                }
            }}
        />
    );
}

export const checkLoginState = (callback?: (response: any) => void) => {
    const canCheckLoginStatus = typeof window !== 'undefined' && (window.location.protocol === 'https:' || window.location.hostname === 'localhost');
    if (canCheckLoginStatus && typeof window !== 'undefined' && window.FB) {
        window.FB.getLoginStatus((response: any) => {
            if (callback) callback(response);
        });
    } else {
        console.warn('Facebook SDK not loaded yet or login status not available over HTTP.');
    }
};

