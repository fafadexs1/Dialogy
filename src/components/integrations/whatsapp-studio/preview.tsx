'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  LockKeyhole,
  MoreVertical,
  Phone,
  Reply,
  Video,
} from 'lucide-react';
import {
  previewBody,
  studioImageUrl,
  studioScrollBehavior,
  type StudioButton,
  type StudioDraft,
} from '@/lib/whatsapp/studio';
import styles from './studio.module.css';

export function StudioPreview({
  draft,
  businessName,
  activeCardId,
  onSelectCard,
}: {
  draft: StudioDraft;
  businessName: string;
  activeCardId?: string;
  onSelectCard?: (id: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [interaction, setInteraction] = useState('');
  const activeIndex = Math.max(
    0,
    draft.cards.findIndex((card) => card.id === activeCardId),
  );
  useEffect(() => {
    setInteraction('');
  }, [draft]);
  useEffect(() => {
    const element = track.current?.children[activeIndex] as
      HTMLElement | undefined;
    if (element && track.current)
      track.current.scrollTo({
        left: element.offsetLeft - 12,
        behavior: studioScrollBehavior(),
      });
    setPosition(activeIndex);
  }, [activeIndex, draft.cards.length]);
  const image = (key: string, label: string) =>
    key ? (
      <Image
        src={studioImageUrl(key)}
        alt={label}
        width={320}
        height={230}
        unoptimized
      />
    ) : (
      <div className={styles.previewPhotoEmpty}>
        <ImagePlus size={27} strokeWidth={1.3} />
        <span>Sua foto aparece aqui</span>
      </div>
    );
  function previewButton(button: StudioButton) {
    return (
      <button
        type="button"
        key={button.id}
        onClick={() =>
          setInteraction(
            button.type === 'reply'
              ? 'A pessoa responderá: “' + button.text + '”'
              : button.type === 'url'
                ? 'Este botão abrirá: ' +
                  (button.value || 'o link que você escolher')
                : 'Este botão ligará para: ' +
                  (button.value || 'o telefone que você escolher'),
          )
        }
      >
        {button.type === 'url' ? (
          <ArrowUpRight size={14} />
        ) : button.type === 'phone' ? (
          <Phone size={13} />
        ) : (
          <Reply size={13} />
        )}
        {button.text || 'Texto do botão'}
      </button>
    );
  }
  const isOtp = draft.category === 'AUTHENTICATION';
  return (
    <aside
      className={styles.previewPanel}
      aria-label="Prévia da mensagem no WhatsApp"
    >
      <div className={styles.previewHeading}>
        <span>
          <Eye size={15} /> PRÉVIA AO VIVO
        </span>
        <span className={styles.liveDot} />
      </div>
      <p className={styles.previewIntro}>Cada ajuste já ganha vida aqui.</p>
      <div className={styles.phone}>
        <div className={styles.phoneTop}>
          <span className={styles.speaker} />
          <span />
        </div>
        <div className={styles.phoneHeader}>
          <ArrowLeft size={17} />
          <div className={styles.phoneAvatar}>
            {businessName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <strong>{businessName}</strong>
            <span>Conta comercial</span>
          </div>
          <Video size={17} />
          <Phone size={15} />
          <MoreVertical size={18} />
        </div>
        <div className={styles.phoneConversation}>
          <span className={styles.previewDay}>Hoje</span>
          <p className={styles.encryption}>
            <LockKeyhole size={10} /> Uma prévia da sua próxima conversa
          </p>
          <div className={styles.messageBubble}>
            {draft.kind === 'message' && draft.headerImageKey && (
              <div className={styles.messagePhoto}>
                {image(draft.headerImageKey, 'Foto do cabeçalho')}
              </div>
            )}
            <div className={styles.bubbleCopy}>
              {draft.kind === 'message' && draft.header && !isOtp && (
                <strong>{draft.header}</strong>
              )}
              <p>
                {isOtp
                  ? (draft.authenticationCode || '123456') +
                    ' é o seu código de verificação. Para sua segurança, não compartilhe este código.'
                  : previewBody(draft) ||
                    'Escreva sua mensagem. Vamos mostrar como ela chega para a pessoa do outro lado.'}
              </p>
              {draft.kind === 'message' && draft.footer && !isOtp && (
                <small>{draft.footer}</small>
              )}
              {isOtp && <small>Este código expira em 10 minutos.</small>}
              <span className={styles.messageTime}>
                Agora <CheckCheck size={12} />
              </span>
            </div>
            {draft.kind === 'message' && (
              <div className={styles.previewButtons}>
                {isOtp ? (
                  <button
                    type="button"
                    onClick={() =>
                      setInteraction(
                        'A pessoa poderá copiar o código recebido.',
                      )
                    }
                  >
                    <Reply size={13} />
                    Copiar código
                  </button>
                ) : (
                  draft.buttons.map(previewButton)
                )}
              </div>
            )}
          </div>
          {draft.kind === 'carousel' && (
            <>
              <div
                className={styles.previewCarousel}
                ref={track}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const first = element.children[0] as HTMLElement | undefined;
                  if (first)
                    setPosition(
                      Math.round(element.scrollLeft / (first.offsetWidth + 8)),
                    );
                }}
              >
                {draft.cards.map((card, index) => (
                  <article
                    className={styles.previewCard}
                    key={card.id}
                    aria-label={'Prévia do cartão ' + (index + 1)}
                  >
                    <div className={styles.carouselPhoto}>
                      {image(
                        card.imageKey,
                        card.title || 'Foto do cartão ' + (index + 1),
                      )}
                    </div>
                    <div className={styles.carouselCopy}>
                      <strong>{card.title || 'Um título que convida'}</strong>
                      <p>
                        {card.body || 'Conte o que torna esta opção especial.'}
                      </p>
                    </div>
                    <div className={styles.previewButtons}>
                      {card.buttons.map(previewButton)}
                    </div>
                  </article>
                ))}
              </div>
              <div className={styles.carouselNavigation}>
                <button
                  type="button"
                  aria-label="Ver cartão anterior na prévia"
                  disabled={position <= 0}
                  onClick={() => onSelectCard?.(draft.cards[position - 1].id)}
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {Math.min(position + 1, draft.cards.length)} de{' '}
                  {draft.cards.length}
                  <span>
                    {draft.cards.map((card, index) => (
                      <button
                        type="button"
                        key={card.id}
                        aria-label={'Ver cartão ' + (index + 1) + ' na prévia'}
                        data-active={index === position}
                        onClick={() => onSelectCard?.(card.id)}
                      />
                    ))}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Ver próximo cartão na prévia"
                  disabled={position >= draft.cards.length - 1}
                  onClick={() => onSelectCard?.(draft.cards[position + 1].id)}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}
          {interaction && (
            <p className={styles.previewInteraction} role="status">
              {interaction}
            </p>
          )}
        </div>
        <div className={styles.phoneBottom}>
          <span>Mensagem</span>
          <span>＋</span>
        </div>
      </div>
      <p className={styles.previewFootnote}>
        Toque nos botões e deslize os cartões para experimentar. A aparência
        pode variar entre versões do WhatsApp.
      </p>
    </aside>
  );
}
