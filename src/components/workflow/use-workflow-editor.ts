'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDefinition } from '@/services/workflow-runtime/types';
import { editorDefinitionKey, recordEditorChange, travelEditorHistory, type EditorHistory } from './workflow-editor-core';

export function useWorkflowHistory(definition: WorkflowDefinition, onChange: (next: WorkflowDefinition) => void) {
  const history = useRef<EditorHistory>({ past: [], present: definition, future: [] });
  const definitionKey = useMemo(() => editorDefinitionKey(definition), [definition]);
  const emittedKey = useRef(definitionKey);
  const lastEdit = useRef({ key: '', at: 0 });
  const [, refresh] = useState(0);
  const [externalRevision, setExternalRevision] = useState(0);
  useEffect(() => {
    const key = definitionKey;
    if (history.current.present.id !== definition.id || key !== emittedKey.current) {
      history.current = { past: [], present: definition, future: [] };
      lastEdit.current = { key: '', at: 0 };
      setExternalRevision((value) => value + 1);
      refresh((value) => value + 1);
    } else {
      history.current = { ...history.current, present: definition };
    }
    emittedKey.current = key;
  }, [definition, definitionKey]);
  const apply = useCallback((next: WorkflowDefinition, editKey = '') => {
    const now = Date.now();
    const merge = Boolean(editKey && editKey === lastEdit.current.key && now - lastEdit.current.at < 600);
    history.current = recordEditorChange(history.current, next, merge);
    lastEdit.current = { key: editKey, at: now };
    emittedKey.current = editorDefinitionKey(next);
    refresh((value) => value + 1);
    onChange(next);
  }, [onChange]);
  const travel = useCallback((direction: 'undo' | 'redo') => {
    const next = travelEditorHistory(history.current, direction);
    if (next === history.current) return;
    history.current = next;
    lastEdit.current = { key: '', at: 0 };
    emittedKey.current = editorDefinitionKey(next.present);
    refresh((value) => value + 1);
    onChange(next.present);
  }, [onChange]);
  const boundary = useCallback(() => { lastEdit.current = { key: '', at: 0 }; }, []);
  return { apply, undo: useCallback(() => travel('undo'), [travel]), redo: useCallback(() => travel('redo'), [travel]), canUndo: history.current.past.length > 0, canRedo: history.current.future.length > 0, boundary, externalRevision };
}

export type WorkflowEditorPreferences = { snap: boolean; minimap: boolean; favorites: string[]; recent: string[] };
const DEFAULTS: WorkflowEditorPreferences = { snap: true, minimap: false, favorites: [], recent: [] };
export function useWorkflowPreferences(storageKey: string) {
  const [preferences, setPreferences] = useState(DEFAULTS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setPreferences({ snap: typeof saved.snap === 'boolean' ? saved.snap : true, minimap: saved.minimap === true, favorites: Array.isArray(saved.favorites) ? saved.favorites.filter((value: unknown) => typeof value === 'string') : [], recent: Array.isArray(saved.recent) ? saved.recent.filter((value: unknown) => typeof value === 'string').slice(0, 10) : [] });
    } catch { setPreferences(DEFAULTS); }
  }, [storageKey]);
  const update = useCallback((patch: Partial<WorkflowEditorPreferences>) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Preferences remain usable in memory. */ }
      return next;
    });
  }, [storageKey]);
  return { preferences, update };
}
