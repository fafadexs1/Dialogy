
'use server';

import React from "react";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CampaignsPageClient from "@/components/campaigns/campaigns-list-page";

export default async function CampaignsPage() {
    const supabase = createClient(cookies());
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect('/login');
    }

    return <CampaignsPageClient user={{ id: user.id, activeWorkspaceId: '' }} />;
}
