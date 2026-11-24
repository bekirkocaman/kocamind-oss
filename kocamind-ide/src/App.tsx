import { useState, useRef, useEffect, useReducer, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  IconClose,
  IconDisclosure,
  IconFolder,
  IconNewFile,
  IconNewFolder,
  IconOpenFolder,
} from './components/icons.tsx';
import { fileIconFor } from './icons/index.ts';
import { AccountButton } from './agent/AccountButton.tsx';
import AgentPanel from './agent/AgentPanel.tsx';
import { useAgent } from './agent/useAgent.ts';
import { TerminalPanel } from './terminal/TerminalPanel.tsx';
import type { TreeNode } from './electron.d.ts';
import { initialTabsState, isDirty, tabsReducer, type Tab } from './editor/tabs.ts';
import { QuickOpen } from './editor/QuickOpen.tsx';
import { TreeMenu, type TreeMenuAction, type TreeMenuTarget } from './editor/TreeMenu.tsx';
import { LogoMark } from './shell/LogoMark.tsx';
import { TitleBar } from './shell/TitleBar.tsx';
import { AgentWorkspace } from './shell/AgentWorkspace.tsx';
import type { ShellMode } from './shell/ModeSwitch.tsx';
import './editor/editor.css';
import './shell/shell.css';
import './App.css';

const MODE_STORAGE_KEY = 'km.mode';

function readStoredShellMode(): ShellMode {
  try {
    const val = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (val === 'agent' || val === 'editor') return val;
    return 'editor';
  } catch {
    return 'editor';
  }
}

function writeStoredShellMode(mode: ShellMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage kullanilamiyorsa sessiz kal
  }
}

type InlinePromptState =
  | { mode: 'newFile' | 'newFolder'; parentPath: string; value: string }
  | { mode: 'rename'; targetPath: string; value: string };

function InlineTreeInput({
  level,
  initialValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  level: number;
  initialValue: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);
  const initialValueRef = useRef(initialValue);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const init = initialValueRef.current;
    if (init) {
      const dotIdx = init.lastIndexOf('.');
      el.setSelectionRange(0, dotIdx > 0 ? dotIdx : init.length);
    }
  }, []);

  const commit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const trimmed = value.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <div
      className="ag-tree-inline-row"
      style={{ paddingLeft: `${8 + level * 12}px` }}
    >
      <input
        ref={inputRef}
        type="text"
        className="ag-tree-inline-input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            submittedRef.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (!submittedRef.current) onCancel();
        }}
      />
    </div>
  );
}

const FileTreeItem = ({
  node,
  level,
  onFileClick,
  onContextMenu,
  activeFilePath,
  inlinePrompt,
  onInlineSubmit,
  onInlineCancel,
}: {
  node: TreeNode;
  level: number;
  onFileClick: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  activeFilePath?: string;
  inlinePrompt: InlinePromptState | null;
  onInlineSubmit: (value: string) => void;
  onInlineCancel: () => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const isFolder = node.type === 'folder';
  const FileIcon = isFolder ? null : fileIconFor(node.name);
  const isActive = !isFolder && node.path === activeFilePath;
  const isRenaming =
    inlinePrompt?.mode === 'rename' && inlinePrompt.targetPath === node.path;
  const isCreatingHere =
    isFolder &&
    (inlinePrompt?.mode === 'newFile' || inlinePrompt?.mode === 'newFolder') &&
    inlinePrompt.parentPath === node.path;

  useEffect(() => {
    if (isCreatingHere && !isOpen) {
      setIsOpen(true);
    }
  }, [isCreatingHere, isOpen]);

  const handleActivate = () => {
    if (isFolder) setIsOpen((v) => !v);
    else onFileClick(node.path, node.name);
  };

  return (
    <div className="ag-tree-node">
      {isRenaming ? (
        <InlineTreeInput
          level={level}
          initialValue={inlinePrompt.value}
          placeholder="Yeni ad..."
          onSubmit={onInlineSubmit}
          onCancel={onInlineCancel}
        />
      ) : (
        <div
          role="treeitem"
          aria-expanded={isFolder ? isOpen : undefined}
          aria-selected={isActive}
          tabIndex={0}
          className={`ag-tree-item ${isFolder ? 'folder' : 'file'} ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${8 + level * 12}px` }}
          onClick={handleActivate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleActivate();
            }
          }}
          onContextMenu={(e) => onContextMenu(e, node)}
          title={node.path}
        >
          {isFolder ? (
            <span className="ag-tree-icon-wrapper folder" aria-hidden="true">
              <IconDisclosure
                size={13}
                className={`chevron ${isOpen ? 'open' : ''}`}
              />
              <IconFolder size={13} className="folder-icon" />
            </span>
          ) : (
            <span
              className="ag-tree-icon-wrapper file"
              style={{ paddingLeft: '17px' }}
              aria-hidden="true"
            >
              {FileIcon && <FileIcon size={13} strokeWidth={1.5} className="file-icon" />}
            </span>
          )}
          <span className="ag-tree-name">{node.name}</span>
        </div>
      )}
      {isFolder && isOpen && (
        <div
          className="ag-tree-children"
          role="group"
          style={{ '--tree-guide-x': `${14 + level * 12}px` } as React.CSSProperties}
        >
          {isCreatingHere && (
            <InlineTreeInput
              level={level + 1}
              initialValue=""
              placeholder={
                inlinePrompt.mode === 'newFile' ? 'dosya.ts' : 'klasor-adi'
              }
              onSubmit={onInlineSubmit}
              onCancel={onInlineCancel}
            />
          )}
          {node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              onFileClick={onFileClick}
              onContextMenu={onContextMenu}
              activeFilePath={activeFilePath}
              inlinePrompt={inlinePrompt}
              onInlineSubmit={onInlineSubmit}
              onInlineCancel={onInlineCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const getLanguageFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.cjs') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.kt')) return 'kotlin';
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c';
  if (lower.endsWith('.cpp') || lower.endsWith('.hpp')) return 'cpp';
  if (lower.endsWith('.cs')) return 'csharp';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.sh')) return 'shell';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.xml')) return 'xml';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  return 'plaintext';
};

function getParentDir(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(0, idx) : '';
}

function getBaseName(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(idx + 1) : relPath;
}

function App() {
  const [shellMode, setShellMode] = useState<ShellMode>(() => readStoredShellMode());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: light)').matches
    ) {
      return 'light';
    }
    return 'dark';
  });
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [tabsState, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isQuickOpen, setIsQuickOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<TreeMenuTarget | null>(null);
  const [inlinePrompt, setInlinePrompt] = useState<InlinePromptState | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Paylaşılan asistan durumu (tek örnek — mod değiştiğinde sıfırlanmaz, olaylar çift işlenmez)
  const agent = useAgent();
  const [agentInput, setAgentInput] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const handleModeChange = useCallback((next: ShellMode) => {
    setShellMode(next);
    writeStoredShellMode(next);
  }, []);

  const handleAgentNewSession = useCallback(async () => {
    await agent.newSession();
    setActiveSessionId(null);
  }, [agent]);

  const handleAgentResumeSession = useCallback(
    async (sessionId: string) => {
      const ok = await agent.resume(sessionId);
      if (ok) {
        setActiveSessionId(sessionId);
      }
      return ok;
    },
    [agent]
  );

  const tabsStateRef = useRef(tabsState);
  useEffect(() => {
    tabsStateRef.current = tabsState;
  }, [tabsState]);

  const projectNameRef = useRef(projectName);
  useEffect(() => {
    projectNameRef.current = projectName;
  }, [projectName]);

  const toastTimerRef = useRef<number | null>(null);

  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null;
  const isModified = Boolean(activeTab && isDirty(activeTab));

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 3000);
  }, []);

  const refreshTree = useCallback(async () => {
    const workspaceApi = window.electron?.workspace;
    if (!workspaceApi) return;
    try {
      const tree = await workspaceApi.refresh();
      if (tree && !('error' in tree)) {
        setFileTree(tree.nodes);
      }
    } catch {
      // sessiz kal
    }
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    if (activeTab) {
      dispatch({ type: 'update', id: activeTab.id, content: value || '' });
    }
  };

  const handleOpenFolder = useCallback(async () => {
    if (!window.electron) {
      showToast('Klasör açmak için masaüstü uygulamasını kullan.');
      return;
    }
    if (tabsStateRef.current.tabs.some(isDirty)) {
      const proceed = window.confirm('Kaydedilmemiş değişiklikler var. Yine de başka klasör açılsın mı?');
      if (!proceed) return;
    }
    const result = await window.electron.workspace.open();
    if (!result) return;
    if ('error' in result) {
      showToast(result.error);
      return;
    }
    dispatch({ type: 'closeAll' });
    setProjectName(result.name);
    setFileTree(result.nodes);
    showToast(`Klasör açıldı: ${result.name}`);
    if (result.truncated) {
      setTimeout(() => {
        showToast('Klasör çok büyük, ilk 5000 öğe gösteriliyor.');
      }, 1000);
    }
  }, [showToast]);

  const openFilePath = useCallback(async (filePath: string, fileName?: string) => {
    const existing = tabsStateRef.current.tabs.find((t) => t.id === filePath);
    if (existing) {
      dispatch({ type: 'activate', id: filePath });
      return;
    }

    if (!window.electron) {
      showToast('Klasör açmak için masaüstü uygulamasını kullan.');
      return;
    }

    const res = await window.electron.workspace.readFile(filePath);
    if ('error' in res) {
      showToast(res.error);
      return;
    }

    const name = fileName ?? getBaseName(filePath);
    dispatch({
      type: 'open',
      tab: {
        id: filePath,
        name,
        content: res.content,
        savedContent: res.content,
        language: getLanguageFromFilename(name),
      },
    });
  }, [showToast]);

  const closeTab = useCallback((tab: Tab) => {
    if (isDirty(tab)) {
      const proceed = window.confirm('Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?');
      if (!proceed) return;
    }
    dispatch({ type: 'close', id: tab.id });
  }, []);

  const handleSave = useCallback(async () => {
    const state = tabsStateRef.current;
    const current = state.tabs.find((t) => t.id === state.activeId);
    if (!current || !isDirty(current)) return;

    if (!window.electron) {
      showToast('Klasör açmak için masaüstü uygulamasını kullan.');
      return;
    }

    const res = await window.electron.workspace.writeFile(current.id, current.content);
    if ('error' in res) {
      showToast(res.error);
      return;
    }

    dispatch({ type: 'saved', id: current.id, content: current.content });
    showToast('Kaydedildi');
  }, [showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (e.key === '1' || e.code === 'Digit1') {
        e.preventDefault();
        handleModeChange('editor');
        return;
      }
      if (e.key === '2' || e.code === 'Digit2') {
        e.preventDefault();
        handleModeChange('agent');
        return;
      }
      if (key === 's') {
        e.preventDefault();
        void handleSave();
      } else if (key === 'w') {
        e.preventDefault();
        const state = tabsStateRef.current;
        const current = state.tabs.find((t) => t.id === state.activeId);
        if (current) closeTab(current);
      } else if (key === 'p') {
        e.preventDefault();
        if (projectNameRef.current !== null) {
          setIsQuickOpen(true);
        }
      } else if (e.key === '`' || e.code === 'Backquote') {
        e.preventDefault();
        setIsTerminalOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, closeTab, handleModeChange]);

  useEffect(() => {
    const agentApi = window.electron?.agent;
    const workspaceApi = window.electron?.workspace;
    if (!agentApi || !workspaceApi) return;

    const callPaths = new Map<string, string>();
    const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

    const unsubscribe = agentApi.onEvent(async (event) => {
      if (event.type === 'tool/start') {
        const callId = typeof event.callId === 'string' ? event.callId : null;
        const args = event.args as Record<string, unknown> | null | undefined;
        const filePath = args && typeof args.path === 'string' ? args.path : null;
        if (callId && filePath) {
          callPaths.set(callId, filePath);
        }
        return;
      }

      if (event.type === 'tool/result') {
        const callId = typeof event.callId === 'string' ? event.callId : null;
        const filePath = callId ? callPaths.get(callId) : undefined;
        if (callId) callPaths.delete(callId);

        if (
          event.ok === true &&
          (event.name === 'write_file' || event.name === 'edit_file')
        ) {
          void refreshTree();
          const normFilePath = filePath ? normalizePath(filePath) : null;
          if (!normFilePath) return;

          const matchingTab = tabsStateRef.current.tabs.find(
            (t) => normalizePath(t.id) === normFilePath
          );
          if (matchingTab) {
            if (!isDirty(matchingTab)) {
              const res = await workspaceApi.readFile(matchingTab.id);
              if (!('error' in res)) {
                dispatch({ type: 'reload', id: matchingTab.id, content: res.content });
              }
            } else {
              showToast('Asistan bu dosyayı değiştirdi; kaydedilmemiş değişikliklerin var.');
            }
          }
        }
        return;
      }

      if (event.type === 'turn/end') {
        callPaths.clear();
        void refreshTree();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [refreshTree, showToast]);

  const handleTreeItemContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuTarget({
      x: e.clientX,
      y: e.clientY,
      path: node.path,
      name: node.name,
      type: node.type,
    });
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (projectName === null) return;
    setMenuTarget({
      x: e.clientX,
      y: e.clientY,
      path: '',
      name: projectName,
      type: 'root',
    });
  };

  const handleMenuAction = async (action: TreeMenuAction) => {
    const target = menuTarget;
    setMenuTarget(null);
    if (!target) return;

    if (action === 'newFile' || action === 'newFolder') {
      const parentPath =
        target.type === 'root'
          ? ''
          : target.type === 'folder'
            ? target.path
            : getParentDir(target.path);
      setInlinePrompt({ mode: action, parentPath, value: '' });
      return;
    }

    if (action === 'rename') {
      setInlinePrompt({
        mode: 'rename',
        targetPath: target.path,
        value: target.name,
      });
      return;
    }

    if (action === 'delete') {
      const api = window.electron?.workspace;
      if (!api) return;
      const confirmed = window.confirm(`${target.name} çöp kutusuna taşınsın mı?`);
      if (!confirmed) return;
      const res = await api.delete(target.path);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      dispatch({ type: 'removeUnder', path: target.path });
      await refreshTree();
    }
  };

  const handleInlineSubmit = async (enteredName: string) => {
    const prompt = inlinePrompt;
    setInlinePrompt(null);
    if (!prompt) return;

    const api = window.electron?.workspace;
    if (!api) {
      showToast('Klasör açmak için masaüstü uygulamasını kullan.');
      return;
    }

    if (prompt.mode === 'newFile') {
      const fullPath = prompt.parentPath
        ? `${prompt.parentPath}/${enteredName}`
        : enteredName;
      const res = await api.createFile(fullPath);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      await refreshTree();
      await openFilePath(res.path);
      return;
    }

    if (prompt.mode === 'newFolder') {
      const fullPath = prompt.parentPath
        ? `${prompt.parentPath}/${enteredName}`
        : enteredName;
      const res = await api.createFolder(fullPath);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      await refreshTree();
      return;
    }

    if (prompt.mode === 'rename') {
      const parent = getParentDir(prompt.targetPath);
      const toPath = parent ? `${parent}/${enteredName}` : enteredName;
      if (toPath === prompt.targetPath) return;
      const res = await api.rename(prompt.targetPath, toPath);
      if ('error' in res) {
        showToast(res.error);
        return;
      }
      dispatch({ type: 'rename', fromPath: res.from, toPath: res.to });
      await refreshTree();
    }
  };

  return (
    <div className="ag-ide-container">
      {/* Gerçek Üst Çubuk (TitleBar) */}
      <TitleBar
        mode={shellMode}
        onModeChange={handleModeChange}
        projectName={projectName}
        isTerminalOpen={isTerminalOpen}
        onToggleTerminal={() => setIsTerminalOpen((v) => !v)}
        isChatOpen={isChatOpen}
        onToggleChat={() => setIsChatOpen((v) => !v)}
        isAgentRunning={agent.state.running}
      />

      {/* Toast Bildirimi */}
      <div
        className={`ag-toast ${toastMsg ? 'visible' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toastMsg}
      </div>

      {/* Hızlı Dosya Açma (Quick Open) */}
      <QuickOpen
        isOpen={isQuickOpen}
        onClose={() => setIsQuickOpen(false)}
        onSelect={(filePath) => {
          handleModeChange('editor');
          void openFilePath(filePath);
        }}
        showToast={showToast}
      />

      {/* Ağaç Sağ Tık Menüsü */}
      <TreeMenu
        target={menuTarget}
        onClose={() => setMenuTarget(null)}
        onAction={(action) => void handleMenuAction(action)}
      />

      {/* İki Modlu Sahne (Editör & Ajan — durum kaybolmaz) */}
      <div className="km-stage">
        {/* 1. Editör Katmanı */}
        <div
          className={`km-mode-layer editor-layer ${
            shellMode === 'editor' ? 'is-active' : 'is-inactive'
          }`}
          aria-hidden={shellMode !== 'editor'}
        >
          <div className="ag-ide-layout">
            {/* SOL KENAR: Dosya Gezgini */}
            <aside className="ag-explorer-pane" aria-label="Dosyalar">
              <div className="ag-explorer-header">
                <span className="ag-explorer-title">Dosyalar</span>
                <div className="ag-explorer-actions">
                  {projectName !== null && (
                    <>
                      <button
                        type="button"
                        className="ag-icon-btn small"
                        onClick={() => setInlinePrompt({ mode: 'newFile', parentPath: '', value: '' })}
                        title="Yeni dosya"
                        aria-label="Yeni dosya oluştur"
                      >
                        <IconNewFile size={14} />
                      </button>
                      <button
                        type="button"
                        className="ag-icon-btn small"
                        onClick={() => setInlinePrompt({ mode: 'newFolder', parentPath: '', value: '' })}
                        title="Yeni klasör"
                        aria-label="Yeni klasör oluştur"
                      >
                        <IconNewFolder size={14} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="ag-icon-btn small"
                    onClick={() => void handleOpenFolder()}
                    title="Klasör aç"
                    aria-label="Klasör aç"
                  >
                    <IconOpenFolder size={14} />
                  </button>
                </div>
              </div>

              <div className="ag-explorer-scroll" role="tree" aria-label="Proje dosyaları">
                {projectName === null ? (
                  <div className="ag-explorer-empty">
                    <p>Henüz bir çalışma klasörü açmadın.</p>
                    <button
                      type="button"
                      className="ag-secondary-btn"
                      onClick={() => void handleOpenFolder()}
                    >
                      Klasör aç
                    </button>
                  </div>
                ) : (
                  <div className="ag-tree-root">
                    <div
                      role="treeitem"
                      aria-selected={false}
                      tabIndex={0}
                      className="ag-tree-item root-item"
                      onContextMenu={handleRootContextMenu}
                    >
                      <IconFolder size={13} className="folder-icon" />
                      <span className="ag-tree-name">{projectName}</span>
                    </div>
                    {(inlinePrompt?.mode === 'newFile' || inlinePrompt?.mode === 'newFolder') &&
                      inlinePrompt.parentPath === '' && (
                        <InlineTreeInput
                          level={0}
                          initialValue=""
                          placeholder={
                            inlinePrompt.mode === 'newFile' ? 'dosya.ts' : 'klasor-adi'
                          }
                          onSubmit={(val) => void handleInlineSubmit(val)}
                          onCancel={() => setInlinePrompt(null)}
                        />
                      )}
                    {fileTree.map((node) => (
                      <FileTreeItem
                        key={node.path}
                        node={node}
                        level={0}
                        onFileClick={(p, n) => void openFilePath(p, n)}
                        onContextMenu={handleTreeItemContextMenu}
                        activeFilePath={activeTab?.id}
                        inlinePrompt={inlinePrompt}
                        onInlineSubmit={(val) => void handleInlineSubmit(val)}
                        onInlineCancel={() => setInlinePrompt(null)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="ag-explorer-footer">
                <AccountButton />
              </div>
            </aside>

            {/* ORTA ALAN: Sekmeler, Monaco Editör ve Terminal */}
            <div className="ag-editor-pane">
              <div className="ag-editor-topbar">
                {tabsState.tabs.length > 0 ? (
                  <div className="ag-tabs-bar" role="tablist" aria-label="Açık dosyalar">
                    {tabsState.tabs.map((tab) => {
                      const active = tab.id === activeTab?.id;
                      const dirty = isDirty(tab);
                      const TabIcon = fileIconFor(tab.name);
                      return (
                        <div
                          key={tab.id}
                          role="tab"
                          aria-selected={active}
                          tabIndex={0}
                          className={`ag-tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}`}
                          title={tab.id}
                          onClick={() => dispatch({ type: 'activate', id: tab.id })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              dispatch({ type: 'activate', id: tab.id });
                            }
                          }}
                          onMouseDown={(e) => {
                            if (e.button === 1) {
                              e.preventDefault();
                              closeTab(tab);
                            }
                          }}
                        >
                          <TabIcon size={13} className="file-icon" aria-hidden="true" />
                          <span className="ag-tab-name">{tab.name}</span>
                          {dirty && (
                            <span
                              className="ag-tab-dirty"
                              aria-label="Kaydedilmemiş değişiklik"
                            >
                              ●
                            </span>
                          )}
                          <button
                            type="button"
                            className="ag-tab-close"
                            title="Kapat (Ctrl+W)"
                            aria-label={`${tab.name} sekmesini kapat`}
                            onClick={(e) => {
                              e.stopPropagation();
                              closeTab(tab);
                            }}
                          >
                            <IconClose size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="ag-editor-breadcrumb placeholder">
                    Açık dosya yok
                  </div>
                )}

                <div className="ag-editor-actions">
                  {activeTab && isModified && (
                    <button
                      type="button"
                      className="ag-save-btn"
                      onClick={() => void handleSave()}
                      title="Kaydet (Ctrl+S)"
                    >
                      Kaydet
                    </button>
                  )}
                </div>
              </div>

              <div className="ag-editor-content">
                {activeTab ? (
                  <Editor
                    height="100%"
                    path={activeTab.id}
                    language={activeTab.language}
                    theme={theme === 'light' ? 'kocamind-light' : 'kocamind-dark'}
                    value={activeTab.content}
                    onChange={handleEditorChange}
                    options={{
                      fontFamily:
                        '"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Code", Consolas, monospace',
                      fontSize: 13,
                      minimap: { enabled: false },
                      padding: { top: 16 },
                      scrollBeyondLastLine: false,
                      lineNumbers: 'on',
                      renderLineHighlight: 'all',
                      wordWrap: 'on',
                      unicodeHighlight: { ambiguousCharacters: false, nonBasicASCII: false },
                    }}
                  />
                ) : (
                  <div className="ag-editor-empty">
                    <div className="ag-editor-empty-mark">
                      <LogoMark size={40} state={agent.state.running ? 'think' : 'idle'} />
                    </div>
                    <h2 className="ag-editor-empty-title">KocaMind Editör</h2>
                    <p className="ag-editor-empty-desc">
                      {projectName === null
                        ? 'Başlamak için bir çalışma klasörü aç veya kısayolları kullan.'
                        : 'Dosyalar panelinden bir dosya seç veya hızlıca aramak için kısayolları kullan.'}
                    </p>

                    {projectName === null && (
                      <button
                        type="button"
                        className="ag-primary-btn empty-cta"
                        onClick={() => void handleOpenFolder()}
                      >
                        Klasör aç
                      </button>
                    )}

                    <div className="ag-editor-shortcuts" aria-label="Klavye kısayolları">
                      <div className="ag-shortcut-row">
                        <span className="ag-shortcut-label">Dosya aç</span>
                        <kbd className="ag-kbd">Ctrl+P</kbd>
                      </div>
                      <div className="ag-shortcut-row">
                        <span className="ag-shortcut-label">Terminal</span>
                        <kbd className="ag-kbd">Ctrl+`</kbd>
                      </div>
                      <div className="ag-shortcut-row">
                        <span className="ag-shortcut-label">Ajan modu</span>
                        <kbd className="ag-kbd">Ctrl+2</kbd>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <TerminalPanel
                isOpen={isTerminalOpen}
                hasWorkspace={projectName !== null}
                onClose={() => setIsTerminalOpen(false)}
              />
            </div>

            {/* SAĞ KENAR: Asistan Paneli (dar görünüm) */}
            {isChatOpen && (
              <aside className="ag-chat-pane" aria-label="Asistan paneli">
                <AgentPanel
                  variant="panel"
                  agent={agent}
                  input={agentInput}
                  onInputChange={setAgentInput}
                  projectName={projectName}
                  onOpenFolder={() => void handleOpenFolder()}
                  activeSessionId={activeSessionId}
                  onSessionSelect={handleAgentResumeSession}
                  onNewSession={handleAgentNewSession}
                />
              </aside>
            )}
          </div>
        </div>

        {/* 2. Ajan Katmanı */}
        <div
          className={`km-mode-layer agent-layer ${
            shellMode === 'agent' ? 'is-active' : 'is-inactive'
          }`}
          aria-hidden={shellMode !== 'agent'}
        >
          <AgentWorkspace
            agent={agent}
            input={agentInput}
            onInputChange={setAgentInput}
            projectName={projectName}
            onOpenFolder={() => void handleOpenFolder()}
            activeSessionId={activeSessionId}
            onSessionSelect={handleAgentResumeSession}
            onNewSession={handleAgentNewSession}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
