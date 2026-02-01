import { subDays } from 'date-fns';
import { cacheService } from './cache-service';

const DAYS_TO_KEEP = 5;

/**
 * Run cache cleanup for old messages
 * Can optionally clear a specific workspace (for workspace switching)
 */
export async function runCacheCleanup(previousWorkspaceId?: string): Promise<void> {
    try {
        const cutoffDate = subDays(new Date(), DAYS_TO_KEEP);
        await cacheService.clearOldMessages(cutoffDate);

        if (previousWorkspaceId) {
            await cacheService.clearWorkspace(previousWorkspaceId);
        }
    } catch (error) {
        console.error('[CacheCleanup] Error during cleanup:', error);
    }
}

/**
 * Schedule cleanup during idle time to avoid startup IO spike
 */
export function scheduleCacheCleanupOnIdle(): void {
    if (typeof window === 'undefined') return;

    if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(
            () => {
                runCacheCleanup();
            },
            { timeout: 30000 } // Max 30s before forced execution
        );
    } else {
        // Fallback for Safari
        setTimeout(() => {
            runCacheCleanup();
        }, 5000);
    }
}
