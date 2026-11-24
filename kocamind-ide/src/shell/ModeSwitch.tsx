import { useRef, type KeyboardEvent } from 'react';
import { IconCode, IconConversation } from '../components/icons.tsx';

export type ShellMode = 'editor' | 'agent';

export function ModeSwitch({
  mode,
  onChange,
}: {
  mode: ShellMode;
  onChange: (next: ShellMode) => void;
}) {
  const editorBtnRef = useRef<HTMLButtonElement>(null);
  const agentBtnRef = useRef<HTMLButtonElement>(null);

  const selectAndFocus = (next: ShellMode) => {
    onChange(next);
    if (next === 'editor') {
      editorBtnRef.current?.focus();
    } else {
      agentBtnRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next: ShellMode = mode === 'editor' ? 'agent' : 'editor';
      selectAndFocus(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectAndFocus('editor');
    } else if (e.key === 'End') {
      e.preventDefault();
      selectAndFocus('agent');
    }
  };

  return (
    <div
      className="km-mode-switch"
      role="tablist"
      aria-label="Çalışma görünümü"
      onKeyDown={handleKeyDown}
    >
      <span
        className="km-mode-switch-thumb"
        style={{
          transform: mode === 'agent' ? 'translateX(100%)' : 'translateX(0%)',
        }}
        aria-hidden="true"
      />
      <button
        ref={editorBtnRef}
        type="button"
        role="tab"
        aria-selected={mode === 'editor'}
        tabIndex={mode === 'editor' ? 0 : -1}
        className={`km-mode-switch-tab ${mode === 'editor' ? 'active' : ''}`}
        onClick={() => onChange('editor')}
        title="Editör görünümü (Ctrl+1)"
      >
        <IconCode size={14} />
        <span>Editör</span>
      </button>
      <button
        ref={agentBtnRef}
        type="button"
        role="tab"
        aria-selected={mode === 'agent'}
        tabIndex={mode === 'agent' ? 0 : -1}
        className={`km-mode-switch-tab ${mode === 'agent' ? 'active' : ''}`}
        onClick={() => onChange('agent')}
        title="Ajan görünümü (Ctrl+2)"
      >
        <IconConversation size={14} />
        <span>Ajan</span>
      </button>
    </div>
  );
}
