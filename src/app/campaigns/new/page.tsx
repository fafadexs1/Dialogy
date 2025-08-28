
'use server';

import React from "react";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@/lib/types";
import NewCampaignPageClient from "@/components/campaigns/new-campaign-page";

async function fetchUser(userId: string): Promise<User | null> {
    // This is a simplified fetch, you might have a more complex one in your actions
    const { data: user, error } = await createClient(cookies())
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    if (error || !user) return null;
    return {
        id: user.id,
        name: user.full_name,
        email: user.email,
        avatar: user.avatar_url,
        activeWorkspaceId: user.last_active_workspace_id,
    } as User;
}

export default async function NewCampaignPage() {
    const supabase = createClient(cookies());
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
        redirect('/login');
    }

    const user = await fetchUser(authUser.id);

    return <NewCampaignPageClient user={user} />;
}
