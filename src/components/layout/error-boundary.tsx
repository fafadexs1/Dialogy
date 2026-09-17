'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { reportClientError } from '@/lib/observability/client';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  resetKeys?: any[];
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
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) return;
    if (this.props.resetKeys && prevProps.resetKeys) {
      const hasChanged =
        this.props.resetKeys.length !== prevProps.resetKeys.length ||
        this.props.resetKeys.some((key, i) => !Object.is(key, prevProps.resetKeys![i]));
      if (hasChanged) {
        this.setState({ hasError: false, error: null });
      }
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
    reportClientError({
      message: error.message,
      stack: error.stack,
      component: 'ErrorBoundary',
      context: { info: errorInfo?.componentStack },
    });

    if (error.message.includes('Loading chunk') || error.name === 'ChunkLoadError') {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    }
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-muted/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border-2 border-destructive/50 bg-background p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="mt-4 text-2xl font-bold text-foreground">
              Ocorreu um erro na aplicacao
            </h1>
            <p className="mt-2 text-muted-foreground">
              Um erro inesperado do lado do cliente impediu a renderizacao desta pagina.
            </p>
            <div className="mt-6 text-left">
              <label className="text-sm font-medium text-foreground">Detalhes do erro:</label>
              <textarea
                readOnly
                className="mt-1 w-full rounded-md border bg-secondary p-3 font-mono text-sm text-destructive"
                rows={6}
                value={this.state.error?.stack || this.state.error?.message || 'Nenhum detalhe disponivel'}
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
