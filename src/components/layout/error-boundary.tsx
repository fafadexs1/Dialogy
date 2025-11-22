
'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);

    // Auto-reload on ChunkLoadError (deployment version mismatch)
    if (error.message.includes('Loading chunk') || error.name === 'ChunkLoadError') {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-muted/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border-2 border-destructive/50 bg-background p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-foreground">
              Ocorreu um erro na aplicação
            </h1>
            <p className="mt-2 text-muted-foreground">
              Um erro inesperado do lado do cliente impediu a renderização desta página.
            </p>
            <div className="mt-6 text-left">
              <label className="text-sm font-medium text-foreground">Detalhes do Erro:</label>
              <textarea
                readOnly
                className="mt-1 w-full rounded-md border bg-secondary p-3 font-mono text-sm text-destructive"
                rows={6}
                value={this.state.error?.stack || this.state.error?.message || 'Nenhum detalhe disponível'}
              />
            </div>
            <Button
              className="mt-6"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Tentar Novamente
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
