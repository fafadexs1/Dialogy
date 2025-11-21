import { getInviteDetails } from '@/actions/invites';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2, ArrowRight, LogIn, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/db';
import { JoinForm } from '@/components/invites/join-form';

interface JoinPageProps {
    params: Promise<{
        code: string;
    }>;
}

export default async function JoinPage({ params }: JoinPageProps) {
    const { code } = await params;
    const inviteDetails = await getInviteDetails(code);

    if ('error' in inviteDetails) {
        return (
            <div className="min-h-screen bg-[#020617] text-white flex items-center justify-center p-4">
                <Card className="w-full max-w-md bg-white/5 border-white/10 text-white">
                    <CardHeader>
                        <CardTitle className="text-red-400 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            Convite Inválido
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-white/60">{inviteDetails.error}</p>
                    </CardContent>
                    <CardFooter>
                        <Link href="/" className="w-full">
                            <Button variant="outline" className="w-full bg-white/5 border-white/10 hover:bg-white/10 hover:text-white text-white">
                                Voltar para Home
                            </Button>
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    const { workspaceName, inviterName, workspaceId } = inviteDetails;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let isMember = false;
    if (user) {
        const memberCheck = await db.query(
            'SELECT 1 FROM user_workspace_roles WHERE user_id = $1 AND workspace_id = $2',
            [user.id, workspaceId]
        );
        isMember = (memberCheck.rowCount ?? 0) > 0;
    }

    return (
        <div className="min-h-screen bg-[#020617] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-20" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/10 blur-[120px] rounded-full" />
            </div>

            <Card className="w-full max-w-md bg-white/5 border-white/10 backdrop-blur-xl shadow-2xl relative z-10">
                <CardHeader className="text-center">
                    <div className="mx-auto w-12 h-12 bg-blue-600/20 rounded-full flex items-center justify-center mb-4">
                        <UserPlus className="h-6 w-6 text-blue-400" />
                    </div>
                    <CardTitle className="text-2xl font-bold text-white">Convite para Workspace</CardTitle>
                    <CardDescription className="text-white/60">
                        <span className="font-semibold text-white">{inviterName}</span> convidou você para entrar no workspace <span className="font-semibold text-white">{workspaceName}</span>.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {user ? (
                        isMember ? (
                            <Alert className="bg-green-500/10 border-green-500/20 text-green-400">
                                <CheckCircle2 className="h-4 w-4" />
                                <AlertTitle>Você já é membro!</AlertTitle>
                                <AlertDescription>
                                    Você já faz parte deste workspace.
                                </AlertDescription>
                            </Alert>
                        ) : (
                            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                <p className="text-sm text-blue-200 text-center">
                                    Você está logado como <span className="font-semibold text-white">{user.email}</span>
                                </p>
                            </div>
                        )
                    ) : (
                        <div className="space-y-3">
                            <Link href={`/login?next=/join/${code}`} className="w-full block">
                                <Button className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white">
                                    <LogIn className="mr-2 h-4 w-4" />
                                    Fazer Login para Entrar
                                </Button>
                            </Link>
                            <div className="relative flex items-center py-2">
                                <div className="flex-grow border-t border-white/10"></div>
                                <span className="flex-shrink-0 mx-4 text-white/40 text-xs uppercase">Ou</span>
                                <div className="flex-grow border-t border-white/10"></div>
                            </div>
                            <Link href={`/register?next=/join/${code}`} className="w-full block">
                                <Button variant="outline" className="w-full h-11 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white text-white">
                                    Criar Nova Conta
                                </Button>
                            </Link>
                        </div>
                    )}
                </CardContent>
                <CardFooter>
                    {user && isMember ? (
                        <Link href="/inbox" className="w-full">
                            <Button className="w-full bg-white/10 hover:bg-white/20 text-white border-white/10">
                                Ir para o Workspace
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </Link>
                    ) : user ? (
                        <JoinForm inviteCode={code} />
                    ) : null}
                </CardFooter>
            </Card>
        </div>
    );
}
