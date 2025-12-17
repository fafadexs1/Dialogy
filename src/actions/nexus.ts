'use server';

import { db } from '@/lib/db';

export async function getNexusConfig(workspaceId: string) {
    try {
        const result = await db.query(
            'SELECT nexus_settings FROM workspaces WHERE id = $1',
            [workspaceId]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const settings = result.rows[0].nexus_settings;
        return settings || {};
    } catch (error) {
        console.error('Error fetching Nexus config:', error);
        return null;
    }
}
