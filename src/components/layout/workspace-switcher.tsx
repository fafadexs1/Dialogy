
'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  CheckIcon,
  PlusCircledIcon,
} from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { User } from '@/lib/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { createWorkspaceAction } from '@/actions/workspace';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';

type PopoverTriggerProps = React.ComponentPropsWithoutRef<
  typeof PopoverTrigger
>;

interface WorkspaceSwitcherProps extends PopoverTriggerProps {
    user: User;
    activeWorkspaceId: string;
    onWorkspaceChange: (workspaceId: string) => void;
}

function CreateWorkspaceForm({ setOpen }: { setOpen: (open: boolean) => void }) {
    const [errorMessage, formAction] = useActionState(createWorkspaceAction, null);
    const { pending } = useFormStatus();
    const formRef = React.useRef<HTMLFormElement>(null);
    const [submitted, setSubmitted] = React.useState(false);

    React.useEffect(() => {
        if (submitted && !errorMessage && !pending) {
            setOpen(false);
        }
        if(errorMessage) {
            setSubmitted(false);
        }
    }, [errorMessage, pending, setOpen, submitted]);


    const handleFormSubmit = (formData: FormData) => {
        setSubmitted(true);
        formAction(formData);
    }

    return (
        <form ref={formRef} action={handleFormSubmit}>
            <DialogHeader>
                <DialogTitle>Criar Workspace</DialogTitle>
                <DialogDescription>
                    Crie um novo workspace para colaborar com sua equipe.
                </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2 pb-4">
                <div className="space-y-2">
                    <Label htmlFor="workspaceName">Nome do Workspace</Label>
                    <Input id="workspaceName" name="workspaceName" placeholder="Ex: Acme Inc." autoFocus required/>
                </div>
                 {errorMessage && (
                    <Alert variant="destructive" className="mt-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Erro ao criar workspace</AlertTitle>
                        <AlertDescription>{errorMessage}</AlertDescription>
                    </Alert>
                )}
            </div>
            <DialogFooter className='pt-4'>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {pending ? 'Criando...' : 'Criar Workspace'}
                </Button>
            </DialogFooter>
        </form>
    )
}

export function WorkspaceSwitcher({
  className,
  user,
  activeWorkspaceId,
  onWorkspaceChange,
}: WorkspaceSwitcherProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  
  const activeWorkspace = user.workspaces?.find(ws => ws.id === activeWorkspaceId);

  if (!activeWorkspace) {
    return null;
  }

  return (
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                      <Button
                          variant="ghost"
                          role="combobox"
                          aria-expanded={popoverOpen}
                          aria-label="Select a workspace"
                          className={cn('h-10 w-10 p-0', className)}
                      >
                          <Avatar className="h-8 w-8">
                              <AvatarImage
                                  src={activeWorkspace.avatar}
                                  alt={activeWorkspace.name}
                                  data-ai-hint="logo"
                              />
                              <AvatarFallback>
                                  {activeWorkspace.name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                          </Avatar>
                      </Button>
                      </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{activeWorkspace.name}</p>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>

          <PopoverContent className="w-[200px] p-0">
            <Command>
              <CommandList>
                <CommandInput placeholder="Buscar workspace..." />
                <CommandEmpty>Nenhum workspace encontrado.</CommandEmpty>
                <CommandGroup heading="Workspaces">
                  {user.workspaces?.map((ws) => (
                    <CommandItem
                      key={ws.id}
                      onSelect={() => {
                        onWorkspaceChange(ws.id);
                        setPopoverOpen(false);
                      }}
                      className="text-sm"
                    >
                      <Avatar className="mr-2 h-5 w-5">
                        <AvatarImage
                          src={ws.avatar}
                          alt={ws.name}
                        />
                        <AvatarFallback>{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      {ws.name}
                      <CheckIcon
                        className={cn(
                          'ml-auto h-4 w-4',
                          activeWorkspaceId === ws.id
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
              <CommandSeparator />
               <CommandItem
                onSelect={() => {
                  setPopoverOpen(false);
                  setDialogOpen(true);
                }}
              >
                <PlusCircledIcon className="mr-2 h-5 w-5" />
                Criar Workspace
              </CommandItem>
            </Command>
          </PopoverContent>
        </Popover>
         <DialogContent>
          <CreateWorkspaceForm setOpen={setDialogOpen} />
        </DialogContent>
      </Dialog>
  );
}
