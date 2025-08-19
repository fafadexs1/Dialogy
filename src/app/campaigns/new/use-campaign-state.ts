
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface CampaignContact {
    id: string; // Will be prefixed with 'crm-' or 'csv-'
    name: string;
    phone_number_jid?: string;
}

interface CampaignState {
    message: string;
    instanceName: string;
    contacts: CampaignContact[];
}

interface CampaignActions {
    setCampaignData: (updater: (state: CampaignState) => Partial<CampaignState>) => void;
    clearCampaignData: () => void;
}

const initialState: CampaignState = {
    message: '',
    instanceName: '',
    contacts: [],
};

export const useCampaignState = create<CampaignState & CampaignActions>()(
    persist(
        (set) => ({
            ...initialState,
            setCampaignData: (updater) => set((state) => ({ ...state, ...updater(state) })),
            clearCampaignData: () => {
                set(initialState);
                // Also clear from localStorage directly
                localStorage.removeItem('campaign-storage');
            },
        }),
        {
            name: 'campaign-storage', // name of the item in the storage (must be unique)
            storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
        }
    )
);
