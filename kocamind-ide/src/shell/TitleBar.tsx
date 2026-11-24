import {
  IconCloseRightPanel,
  IconOpenRightPanel,
  IconTerminal,
} from '../components/icons.tsx';
import {
  WinClose,
  WinMaximize,
  WinMinimize,
} from '../icons/index.ts';
import { LogoMark } from './LogoMark.tsx';
import { ModeSwitch, type ShellMode } from './ModeSwitch.tsx';

export function TitleBar({
  mode,
  onModeChange,
  projectName,
  isTerminalOpen,
  onToggleTerminal,
  isChatOpen,
  onToggleChat,
  isAgentRunning = false,
}: {
  mode: ShellMode;
  onModeChange: (next: ShellMode) => void;
  projectName: string | null;
  isTerminalOpen: boolean;
  onToggleTerminal: () => void;
  isChatOpen: boolean;
  onToggleChat: () => void;
  isAgentRunning?: boolean;
}) {
  return (
    <header className="km-titlebar">
      <div className="km-titlebar-left">
        <div className="km-brand" aria-label="KocaMind IDE">
          <LogoMark size={18} state={isAgentRunning ? 'think' : 'idle'} />
          <span className="km-brand-name">KocaMind</span>
        </div>

        <ModeSwitch mode={mode} onChange={onModeChange} />
      </div>

      <div className="km-titlebar-center">
        {projectName && (
          <span className="km-titlebar-project" title={projectName}>
            {projectName}
          </span>
        )}
      </div>

      <div className="km-titlebar-right">
        {mode === 'editor' && (
          <div className="km-titlebar-toggles">
            <button
              type="button"
              className={`km-titlebar-tool-btn ${isTerminalOpen ? 'active' : ''}`}
              onClick={onToggleTerminal}
              title="Terminali aç/kapat (Ctrl+`)"
              aria-label="Terminali aç veya kapat"
              aria-pressed={isTerminalOpen}
            >
              <IconTerminal size={15} />
            </button>

            <button
              type="button"
              className={`km-titlebar-tool-btn ${isChatOpen ? 'active' : ''}`}
              onClick={onToggleChat}
              title="Asistan panelini aç/kapat"
              aria-label="Asistan panelini aç veya kapat"
              aria-pressed={isChatOpen}
            >
              {isChatOpen ? <IconCloseRightPanel size={15} /> : <IconOpenRightPanel size={15} />}
            </button>
          </div>
        )}

        <div className="km-window-controls">
          <button
            type="button"
            className="km-win-btn"
            onClick={() => window.electron?.windowControls('minimize')}
            title="Küçült"
            aria-label="Pencereyi küçült"
          >
            <WinMinimize size={16} />
          </button>
          <button
            type="button"
            className="km-win-btn"
            onClick={() => window.electron?.windowControls('maximize')}
            title="Büyüt"
            aria-label="Pencereyi büyüt"
          >
            <WinMaximize size={16} />
          </button>
          <button
            type="button"
            className="km-win-btn close"
            onClick={() => window.electron?.windowControls('close')}
            title="Kapat"
            aria-label="Pencereyi kapat"
          >
            <WinClose size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
