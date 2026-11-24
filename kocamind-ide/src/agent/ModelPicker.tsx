import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconExpand, IconModels } from '../components/icons.tsx';
import type { IdeModel, ModelSelection } from './types.ts';

const STORAGE_KEY = 'kocamind_ide_model';
const MODEL_SYNC_EVENT = 'km:model-changed';

function readStoredSelection(): ModelSelection | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as ModelSelection).model === 'string' &&
      (parsed as ModelSelection).model &&
      typeof (parsed as ModelSelection).provider === 'string' &&
      (parsed as ModelSelection).provider
    ) {
      return {
        model: (parsed as ModelSelection).model,
        provider: (parsed as ModelSelection).provider,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredSelection(selection: ModelSelection | null): void {
  try {
    if (selection) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent(MODEL_SYNC_EVENT, { detail: selection }));
  } catch {
    // localStorage kullanilamiyorsa sessiz kal
  }
}

function sameSelection(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.model === b.model && a.provider === b.provider;
}

export function ModelPicker({
  disabled,
  listModels,
  setModel,
  onError,
  direction = 'up',
}: {
  disabled: boolean;
  listModels: () => Promise<
    | { models: IdeModel[]; default: { id: string; provider: string } | null; selected: ModelSelection | null }
    | { error: string }
  >;
  setModel: (
    selection: ModelSelection | null
  ) => Promise<{ ok: true; selected: ModelSelection | null } | { error: string }>;
  onError: (text: string) => void;
  direction?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<IdeModel[]>([]);
  const [defaultInfo, setDefaultInfo] = useState<{ id: string; provider: string } | null>(null);
  const [selected, setSelected] = useState<ModelSelection | null>(() => readStoredSelection());
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onSync = (e: Event) => {
      const custom = e as CustomEvent<ModelSelection | null>;
      setSelected(custom.detail ?? readStoredSelection());
    };
    window.addEventListener(MODEL_SYNC_EVENT, onSync);
    return () => window.removeEventListener(MODEL_SYNC_EVENT, onSync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = readStoredSelection();

    void (async () => {
      const res = await listModels();
      if (cancelled) return;
      if ('error' in res) {
        if (stored) {
          await setModel(stored);
        }
        return;
      }
      setModels(res.models);
      setDefaultInfo(res.default);
      if (stored) {
        const exists = res.models.some((m) => m.id === stored.model && m.provider === stored.provider);
        if (exists) {
          setSelected(stored);
          await setModel(stored);
        } else {
          setSelected(res.selected ?? null);
          writeStoredSelection(res.selected ?? null);
          await setModel(res.selected ?? null);
        }
      } else if (res.selected) {
        setSelected(res.selected);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listModels, setModel]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleToggle = async () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    const res = await listModels();
    setLoading(false);
    if ('error' in res) {
      setError(res.error);
      setModels([]);
      setDefaultInfo(null);
      onError(res.error);
    } else {
      setError(null);
      setModels(res.models);
      setDefaultInfo(res.default);
      if (
        selected &&
        !res.models.some((m) => m.id === selected.model && m.provider === selected.provider)
      ) {
        setSelected(null);
        writeStoredSelection(null);
        void setModel(null);
      }
    }
  };

  const handlePick = async (next: ModelSelection | null) => {
    const prev = selected;
    setOpen(false);
    setSelected(next);
    const res = await setModel(next);
    if ('error' in res) {
      setSelected(prev);
      return;
    }
    writeStoredSelection(next);
  };

  const defaultModel = defaultInfo
    ? models.find((m) => m.id === defaultInfo.id && m.provider === defaultInfo.provider) ?? null
    : null;
  const defaultLabel = defaultModel ? defaultModel.label : defaultInfo?.id ?? '';
  const selectedModel = selected
    ? models.find((m) => m.id === selected.model && m.provider === selected.provider) ?? null
    : null;

  let buttonLabel = 'Model seç';
  if (selected) {
    buttonLabel = selectedModel ? selectedModel.label : selected.model;
  }

  return (
    <div className="ag-agent-model-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ag-agent-btn-reset ag-composer-chip ${open ? 'active' : ''}`}
        onClick={() => void handleToggle()}
        disabled={disabled}
        title={selected ? buttonLabel : 'Model seç'}
        aria-label={`Model seç: ${buttonLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <IconModels size={12} />
        <span className="ag-agent-model-btn-label">{buttonLabel}</span>
        <IconExpand size={11} />
      </button>

      {open && (
        <div
          className={`ag-agent-model-popover ${direction === 'up' ? 'dir-up' : 'dir-down'}`}
          role="menu"
          aria-label="Model listesi"
        >
          {loading ? (
            <div className="ag-session-skeleton-list" aria-busy="true" aria-label="Modeller yükleniyor">
              <div className="ag-session-skeleton-row" />
              <div className="ag-session-skeleton-row short" />
            </div>
          ) : error ? (
            <div className="ag-agent-session-error">{error}</div>
          ) : (
            <div className="ag-agent-session-items">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={sameSelection(selected, null)}
                className={`ag-agent-model-item ${sameSelection(selected, null) ? 'active' : ''}`}
                onClick={() => void handlePick(null)}
              >
                <span className="ag-agent-model-item-main">
                  <span className="ag-agent-model-label">
                    {defaultLabel ? `Varsayılan (${defaultLabel})` : 'Varsayılan'}
                  </span>
                </span>
                {sameSelection(selected, null) && <IconCheck size={12} />}
              </button>

              {models.map((m) => {
                const candidate: ModelSelection = { model: m.id, provider: m.provider };
                const active = sameSelection(selected, candidate);
                return (
                  <button
                    key={`${m.provider}:${m.id}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`ag-agent-model-item ${active ? 'active' : ''}`}
                    onClick={() => void handlePick(candidate)}
                  >
                    <span className="ag-agent-model-item-main">
                      <span className="ag-agent-model-label">{m.label}</span>
                      <span className="ag-agent-model-provider">{m.provider}</span>
                    </span>
                    {active && <IconCheck size={12} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
