'use client';

import { Bot, Check, CheckCheck, ChevronDown, LockKeyhole, Inbox, Layers2, MessageCircle, MoreHorizontal, Plus, Search, Send, Settings2, Sparkles, Users, Workflow } from 'lucide-react';
import { DialogyMark } from '@/components/landing/v2/brand';
import { useI18n } from '@/i18n/i18n-provider';
import styles from './auth.module.css';

/** Illustrative product preview; intentionally contains no live customer data or controls. */
export function AuthShowcase({ mode }: { mode: 'login' | 'register' }) {
  const { t } = useI18n();
  const isLogin = mode === 'login';
  const conversations = [
    { initials: 'AC', name: 'Ana Costa', message: t('Perfeito! Era o que eu precisava.'), time: '09:41', color: 'mint' },
    { initials: 'RM', name: 'Rafael Martins', message: t('Gostaria de conhecer os planos.'), time: '09:38', color: 'blue' },
    { initials: 'JL', name: 'Julia Lima', message: t('Obrigada pela atenção!'), time: '09:32', color: 'peach' },
  ];

  return (
    <aside className={styles.showcase} aria-label={t('Conheça o inbox da Dialogy')}>
      <div className={styles.showcaseTop}><span className={styles.productTag}><span />{t('CONVERSAS QUE APROXIMAM')}</span><DialogyMark className="h-6 w-6 text-slate-300" /></div>
      <div className={styles.showcaseBody}>
        <div className={styles.editorial}>
          <h2>{t(isLogin ? 'Tudo conectado.' : 'Mais proximidade.')}<br /><span>{t(isLogin ? 'Cada conversa importa.' : 'Novas possibilidades.')}</span></h2>
          <p>{t('Pessoas, canais e inteligência artificial em um só lugar. Para sua equipe atender melhor e ir mais longe.')}</p>
        </div>
        <div className={styles.previewStage}>
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewToolbar}><span className={styles.windowDots}><i /><i /><i /></span><span><LockKeyholeSmall />{t('Seu workspace')}</span><MoreHorizontal size={15} /></div>
            <div className={styles.previewWorkspace}>
              <div className={styles.rail}><DialogyMark className="h-6 w-6 text-slate-900" /><div className={styles.railTools}><span className={styles.railActive}><Inbox size={17} /></span><Users size={17} /><Workflow size={17} /><Layers2 size={17} /></div><Settings2 size={17} /><span className={styles.tinyAvatar}>M</span></div>
              <div className={styles.conversationList}>
                <div className={styles.listHeading}><strong>Inbox</strong><span><Plus size={11} />{t('Nova')}</span></div>
                <div className={styles.previewSearch}><Search size={12} />{t('Buscar conversa')}</div>
                <div className={styles.previewTabs}><b>{t('Todas')} <small>8</small></b><span>{t('Minhas')} <small>3</small></span></div>
                <div className={styles.listCaption}>{t('EM ATENDIMENTO')}<span>3</span></div>
                {conversations.map((contact, index) => (
                  <div key={contact.initials} className={`${styles.contact} ${index === 0 ? styles.contactSelected : ''}`}>
                    <span className={`${styles.avatar} ${styles[contact.color]}`}>{contact.initials}<i /></span>
                    <div><strong>{contact.name}</strong><p>{contact.message}</p></div><time>{contact.time}</time>
                  </div>
                ))}
                <div className={styles.listBottom}><span /><span /><span /></div>
              </div>
              <div className={styles.chat}>
                <div className={styles.chatHeading}><span className={`${styles.avatar} ${styles.mint}`}>AC</span><div><strong>Ana Costa</strong><small><span />{t('Em atendimento')}</small></div><MoreHorizontal size={16} /></div>
                <div className={styles.chatMessages}><span className={styles.today}>{t('Hoje')}</span><p className={styles.incoming}>{t('Olá! Pode me ajudar a escolher o melhor plano?')}<time>09:40</time></p><span className={styles.agentLabel}><Sparkles size={10} />{t('Você + Dialogy IA')}</span><p className={styles.outgoing}>{t('Claro, Ana! Vamos encontrar a melhor opção para você.')}<time>09:41 <CheckCheck size={11} /></time></p><p className={styles.incoming}>{t('Perfeito! Era o que eu precisava.')}<time>09:41</time></p></div>
                <div className={styles.composer}><span>{t('Escreva sua mensagem…')}</span><div><Plus size={12} /><span><Sparkles size={12} /><Send size={12} /></span></div></div>
              </div>
            </div>
          </div>
          <div className={styles.assistantCard}><span className={styles.assistantIcon}><Sparkles size={18} /></span><div><strong>{t('Mais contexto. Melhor atendimento.')}</strong><p>{t('Sua equipe e a IA, na mesma conversa.')}</p></div><span className={styles.assistantCheck}><Check size={13} /></span></div>
        </div>
        <div className={styles.benefits}>
          <div><span><MessageCircle size={17} /></span><strong>{t('Canais conectados')}</strong><p>{t('Uma única caixa de entrada.')}</p></div>
          <div><span><Users size={17} /></span><strong>{t('Equipe em sintonia')}</strong><p>{t('Contexto em cada conversa.')}</p></div>
          <div><span><Bot size={17} /></span><strong>{t('IA ao seu lado')}</strong><p>{t('Mais tempo para as pessoas.')}</p></div>
        </div>
      </div>
      <div className={styles.showcaseFooter}><span>{t('MENOS DISTÂNCIA. MAIS CONEXÃO.')}</span><span>{t('Uma prévia da sua próxima experiência')}<ChevronDown size={12} /></span></div>
    </aside>
  );
}

function LockKeyholeSmall() { return <LockKeyhole size={11} />; }
