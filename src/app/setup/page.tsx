
'use client';

import { useState } from 'react';
import { initializeDatabase } from '@/actions/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Server, AlertCircle, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function SetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleInitialize = async () => {
    setLoading(true);
    setResult(null);
    const response = await initializeDatabase();
    setResult(response);
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server />
            Configuração do Banco de Dados
          </CardTitle>
          <CardDescription>
            Este assistente irá configurar as tabelas e estruturas necessárias no seu banco de dados PostgreSQL, incluindo permissões padrão. Clique no botão abaixo para começar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleInitialize} disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? 'Inicializando...' : 'Verificar e Configurar Banco de Dados'}
          </Button>

          {result && (
            <div className={`mt-4 p-4 rounded-md text-sm flex items-start gap-3 ${result.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {result.success ? <CheckCircle className="h-5 w-5 flex-shrink-0" /> : <AlertCircle className="h-5 w-5 flex-shrink-0" />}
              <div>
                <p className="font-semibold">{result.success ? 'Sucesso!' : 'Erro!'}</p>
                <p>{result.message}</p>
                 {result.success && <p className="mt-2">Você pode agora <Link href="/register" className="underline font-bold">ir para a página de registro</Link>.</p>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
