import Stripe from 'stripe';
import { getSystemSettingsAction } from '@/actions/system-settings';

// Helper to get a Stripe instance with keys from DB or Env
export async function getStripe() {
    // Try to get from DB first (if running on server)
    let secretKey = process.env.STRIPE_SECRET_KEY;

    try {
        // Use internal function to bypass auth check (webhooks have no user session)
        const { getSystemSettings } = await import('@/actions/system-settings');
        const settings = await getSystemSettings(['stripe_secret_key']);
        if (settings['stripe_secret_key']) {
            secretKey = settings['stripe_secret_key'];
        }
    } catch (e) {
        // Fallback or error logging
        console.warn("Failed to fetch Stripe key from DB, using env if available.");
    }

    if (!secretKey) {
        throw new Error("Stripe Secret Key not found. Please configure it in Settings > Billing.");
    }

    return new Stripe(secretKey, {
        typescript: true,
    });
}
