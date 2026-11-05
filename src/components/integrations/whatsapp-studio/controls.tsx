'use client';

import { useId, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { ImagePlus, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { uploadWhatsappStudioImage } from '@/actions/whatsapp-studio';
import {
  STUDIO_IMAGE_LIMIT,
  studioImageUrl,
  type StudioButton,
} from '@/lib/whatsapp/studio';
import styles from './studio.module.css';
import workspaceStyles from '@/app/team/team-page.module.css';

export type ButtonLayoutChange = {
  type: 'add' | 'remove' | 'type';
  index: number;
};
export function StudioImageField({
  workspaceId,
  imageKey,
  onChange,
  label,
}: {
  workspaceId: string;
  imageKey: string;
  onChange: (key: string) => void;
  label: string;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  async function upload(file?: File) {
    if (!file || busy) return;
    setError('');
    if (
      !['image/jpeg', 'image/png'].includes(file.type) ||
      file.size > STUDIO_IMAGE_LIMIT
    ) {
      setError('Escolha uma foto JPG ou PNG de até 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      const result = await uploadWhatsappStudioImage(workspaceId, form);
      if (!result.success) throw new Error(result.error);
      onChange(result.key);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Não foi possível carregar a foto.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.imageField}>
      <div className={styles.fieldHeading}>
        <Label htmlFor={id}>{label}</Label>
        {imageKey && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => onChange('')}
            disabled={busy}
          >
            <X size={13} /> Remover
          </button>
        )}
      </div>
      <label
        htmlFor={id}
        className={styles.uploadArea}
        data-dragging={dragging}
        data-filled={Boolean(imageKey)}
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files[0]);
        }}
      >
        {imageKey && (
          <Image
            src={studioImageUrl(imageKey)}
            alt={label}
            width={400}
            height={280}
            unoptimized
            className={styles.uploadedPhoto}
          />
        )}
        <span className={styles.uploadPrompt}>
          {busy ? (
            <Loader2 size={23} className="animate-spin" />
          ) : imageKey ? (
            <Upload size={19} />
          ) : (
            <ImagePlus size={25} />
          )}
          <strong>
            {busy
              ? 'Preparando sua foto…'
              : imageKey
                ? 'Trocar foto'
                : 'Uma boa foto faz a diferença'}
          </strong>
          <span>
            {imageKey
              ? 'Clique ou arraste outra imagem'
              : 'Arraste aqui ou clique para escolher'}
          </span>
          {!imageKey && <small>JPG ou PNG · até 5 MB</small>}
        </span>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png"
          className={styles.fileInput}
          disabled={busy}
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {error && (
        <p role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
    </div>
  );
}

export function StudioButtonsEditor({
  buttons,
  onChange,
  max = 3,
  shared = false,
}: {
  buttons: StudioButton[];
  onChange: (buttons: StudioButton[], layout?: ButtonLayoutChange) => void;
  max?: number;
  shared?: boolean;
}) {
  const id = useId();
  function update(
    index: number,
    patch: Partial<StudioButton>,
    layout?: ButtonLayoutChange,
  ) {
    onChange(
      buttons.map((button, i) =>
        i === index ? { ...button, ...patch } : button,
      ),
      layout,
    );
  }
  return (
    <div className={styles.buttonsEditor}>
      <div className={styles.fieldHeading}>
        <Label>O próximo passo da conversa</Label>
        <span>
          {buttons.length}/{max} botões
        </span>
      </div>
      {shared && (
        <p className={styles.hint}>
          O tipo e a posição se repetem nos cartões. O texto e o destino podem
          mudar em cada um.
        </p>
      )}
      {buttons.map((button, index) => (
        <div className={styles.buttonFields} key={button.id}>
          <div className={styles.buttonFieldTop}>
            <span>Botão {index + 1}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={'Remover botão ' + (index + 1)}
              onClick={() =>
                onChange(
                  buttons.filter((_, i) => i !== index),
                  { type: 'remove', index },
                )
              }
            >
              <Trash2 size={14} />
            </Button>
          </div>
          <div className={styles.buttonFieldGrid}>
            <div>
              <Label htmlFor={id + '-type-' + index}>Ao tocar</Label>
              <Select
                value={button.type}
                onValueChange={(value) =>
                  update(
                    index,
                    { type: value as StudioButton['type'], value: '' },
                    { type: 'type', index },
                  )
                }
              >
                <SelectTrigger id={id + '-type-' + index}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={workspaceStyles.surface}>
                  <SelectItem value="reply">Enviar uma resposta</SelectItem>
                  <SelectItem value="url">Abrir um link</SelectItem>
                  <SelectItem value="phone">Fazer uma ligação</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={id + '-text-' + index}>Texto do botão</Label>
              <Input
                id={id + '-text-' + index}
                maxLength={25}
                value={button.text}
                placeholder="Ex.: Quero conhecer"
                onChange={(event) =>
                  update(index, { text: event.target.value })
                }
              />
            </div>
          </div>
          {button.type !== 'reply' && (
            <div className={styles.buttonDestination}>
              <Label htmlFor={id + '-value-' + index}>
                {button.type === 'url'
                  ? 'Para qual endereço?'
                  : 'Qual telefone?'}
              </Label>
              <Input
                id={id + '-value-' + index}
                type={button.type === 'url' ? 'url' : 'tel'}
                value={button.value}
                placeholder={
                  button.type === 'url'
                    ? 'https://sualoja.com/produto'
                    : '+55 11 99999-9999'
                }
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
              />
            </div>
          )}
        </div>
      ))}
      {buttons.length < max && (
        <Button
          type="button"
          variant="outline"
          className={styles.addButton}
          onClick={() =>
            onChange(
              [
                ...buttons,
                {
                  id: uuidv4(),
                  type: 'reply',
                  text: buttons.length ? 'Mais informações' : 'Tenho interesse',
                  value: '',
                },
              ],
              { type: 'add', index: buttons.length },
            )
          }
        >
          <Plus size={14} /> Adicionar botão
        </Button>
      )}
      {!buttons.length && (
        <p className={styles.hint}>
          Ajude a pessoa a responder, abrir um link ou falar com sua equipe.
        </p>
      )}
    </div>
  );
}
