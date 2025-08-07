'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// Mock implementation, in a real scenario this would interact with your database.

export async function createWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const workspaceName = formData.get('workspaceName') as string;

  if (!workspaceName) {
    return 'O nome do workspace é obrigatório.';
  }

  console.log(`Mock: Creating workspace named "${workspaceName}"`);
  
  // In a real app, you would:
  // 1. Get the current user ID.
  // 2. Insert the new workspace into the 'workspaces' table.
  // 3. Create an entry in the 'user_workspaces' table to link the user.
  // 4. Switch the user's active workspace.

  revalidatePath('/', 'layout');
  revalidatePath('/settings/workspace');
  
  // No error means success in mock context
  return null;
}


export async function updateWorkspaceAction(
  prevState: string | null,
  formData: FormData
): Promise<string | null> {
    const workspaceId = formData.get('workspaceId') as string;
    const workspaceName = formData.get('workspaceName') as string;

    if (!workspaceName) {
        return 'O nome do workspace é obrigatório.';
    }
     if (!workspaceId) {
        return 'ID do workspace não encontrado.';
    }
    
    console.log(`Mock: Updating workspace ${workspaceId} to name "${workspaceName}"`);

    revalidatePath('/', 'layout');
    revalidatePath('/settings/workspace');

    return null;
}

export async function switchWorkspaceAction(workspaceId: string) {
    console.log(`Mock: Switching to workspace ${workspaceId}`);
    // In a real app, this would update the user's 'last_active_workspace_id'
    
    revalidatePath('/', 'layout');
}
