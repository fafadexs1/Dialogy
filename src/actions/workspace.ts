
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const supabase = createClient();

  const workspaceName = formData.get('workspaceName') as string;
  const userId = formData.get('userId') as string;

  if (!workspaceName || !userId) {
    return 'O nome do workspace e o ID do usuário são obrigatórios.';
  }

  // Step 1: Create the workspace
  const { data: workspaceData, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: workspaceName })
    .select()
    .single();

  if (workspaceError || !workspaceData) {
    console.error('Error creating workspace:', workspaceError);
    return `Não foi possível criar o workspace: ${workspaceError?.message || 'Erro desconhecido.'}`;
  }

  // Step 2: Link the user to the new workspace
  const { error: userWorkspaceError } = await supabase
    .from('user_workspaces')
    .insert({
      user_id: userId,
      workspace_id: workspaceData.id,
    });

  if (userWorkspaceError) {
    console.error('Error linking user to workspace:', userWorkspaceError);
    // Optional: Attempt to clean up the created workspace if linking fails
    await supabase.from('workspaces').delete().eq('id', workspaceData.id);
    return `Não foi possível vincular o usuário ao workspace: ${userWorkspaceError.message}`;
  }

  // Revalidate the home page to reflect the new state
  revalidatePath('/');

  return null;
}
