'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, LockKeyhole } from 'lucide-react';
import { DialogyLogo } from '@/components/landing/v2/brand';
import { useI18n } from '@/i18n/i18n-provider';
import { AuthShowcase } from './auth-showcase';
import styles from './auth.module.css';

export function AuthShell({ children, mode, alternateHref }: {
  children: ReactNode;
  mode: 'login' | 'register';
  alternateHref: string;
}) {
  const { t } = useI18n();
  const isLogin = mode === 'login';

  return (
    <div className={`app-shell-light ${styles.shell}`}>
      <div className={styles.formSide}>
        <header className={styles.header}>
          <Link href="/" aria-label={t('Dialogy — página inicial')}><DialogyLogo /></Link>
          <Link href="/" className={styles.backLink}><ArrowLeft size={14} />{t('Voltar ao site')}</Link>
        </header>
        <main className={styles.main}>
          <div className={styles.formContent}>
            <div className={styles.eyebrow}><span />{t(isLogin ? 'SEU ESPAÇO DE CONEXÕES' : 'UM NOVO COMEÇO')}</div>
            <h1>{t(isLogin ? 'Bom ter você de volta.' : 'Grandes conversas começam aqui.')}</h1>
            <p className={styles.description}>{t(isLogin
              ? 'Entre na sua conta e continue de onde a conversa parou.'
              : 'Crie sua conta e aproxime sua equipe de cada cliente.')}</p>
            {children}
            <p className={styles.alternate}>
              {t(isLogin ? 'Ainda não tem uma conta?' : 'Já faz parte da Dialogy?')}{' '}
              <Link href={alternateHref}>{t(isLogin ? 'Criar minha conta' : 'Entrar na minha conta')}<ArrowUpRight size={14} /></Link>
            </p>
            <div className={styles.formNote}><LockKeyhole size={13} />{t('Seu próximo atendimento começa com uma conexão segura.')}</div>
          </div>
        </main>
        <footer className={styles.footer}><span>© {new Date().getFullYear()} Dialogy</span><span>{t('Feito para conectar.')}</span></footer>
      </div>
      <AuthShowcase mode={mode} />
    </div>
  );
}
