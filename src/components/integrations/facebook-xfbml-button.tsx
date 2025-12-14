'use client';

import { useEffect } from 'react';

declare global {
    interface Window {
        FB: any;
        checkLoginState: () => void;
    }
}

interface FacebookXFBMLButtonProps {
    onLogin?: (response: any) => void;
    size?: 'small' | 'medium' | 'large' | 'xlarge';
    buttonText?: string;
    layout?: 'rounded' | 'button' | 'icon' | 'box_count' | 'button_count';
    autoLogoutLink?: boolean;
    useContinueAs?: boolean;
}

export function FacebookXFBMLButton({
    onLogin,
    size = 'large',
    layout = 'rounded',
    autoLogoutLink = false,
    useContinueAs = true
}: FacebookXFBMLButtonProps) {

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const canCheckLoginStatus = window.location.protocol === 'https:' || window.location.hostname === 'localhost';

        window.checkLoginState = () => {
            if (!canCheckLoginStatus) {
                console.warn('Skipping FB.getLoginStatus on non-HTTPS environment.');
                return;
            }
            if (window.FB) {
                window.FB.getLoginStatus((response: any) => {
                    console.log('XFBML Content Login Status:', response);
                    if (onLogin) {
                        onLogin(response);
                    }
                });
            }
        };

        if (canCheckLoginStatus && window.FB) {
            window.FB.XFBML.parse();
        }
    }, [onLogin]);

    return (
        <div className="fb-login-button"
            data-width=""
            data-size={size}
            data-button-type={layout}
            data-layout={layout}
            data-auto-logout-link={autoLogoutLink}
            data-use-continue-as={useContinueAs}
            // @ts-ignore - onlogin is a custom attribute for XFBML
            onlogin="checkLoginState();"
        >
        </div>
    );
}

