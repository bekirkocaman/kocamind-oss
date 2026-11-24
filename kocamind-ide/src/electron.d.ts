export type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
};

export type WorkspaceTree = {
  root: string;
  name: string;
  nodes: TreeNode[];
  truncated: boolean;
};

export type WorkspaceError = {
  error: string;
};

export type WorkspaceReadFileResult = {
  path: string;
  content: string;
};

export type WorkspaceWriteFileResult = {
  path: string;
  bytes: number;
};

export type WorkspacePathResult = {
  path: string;
};

export type WorkspaceRenameResult = {
  from: string;
  to: string;
};

export type WorkspaceListFilesResult = {
  files: string[];
  truncated: boolean;
};

export type AgentMode = 'ask' | 'auto-edit' | 'read-only';

export type PlanItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

export type AgentEvent = {
  type: string;
  turnId: string;
  [key: string]: unknown;
};

export type AgentUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type AgentDone = {
  turnId: string;
  status: 'completed' | 'aborted' | 'failed';
  text?: string;
  steps?: number;
  toolCalls?: number;
  limitReached?: 'time' | 'tool_calls' | 'steps' | null;
  usage?: AgentUsage | null;
  error?: string;
};

export type IdeModel = {
  id: string;
  provider: string;
  label: string;
};

export type ModelSelection = {
  model: string;
  provider: string;
};

export type AgentState = {
  running: boolean;
  turnId: string | null;
  sessionId: string | null;
  mode: AgentMode | null;
  plan: PlanItem[];
  model: ModelSelection | null;
};

export type AgentStartResult = {
  turnId: string;
  sessionId: string;
};

export type AgentOk = {
  ok: true;
};

export type AgentError = {
  error: string;
};

export type AgentSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
  turns: number;
};

export type AgentTraceEvent = {
  seq: number;
  at: string;
  type: string;
  [key: string]: unknown;
};

export type AgentRevertResult = {
  turnId: string;
  restored: string[];
};

export type AuthUser = {
  uid: string;
  email: string | null;
};

export type AuthLoginResult =
  | { ok: true; user: AuthUser }
  | { error: string };

export type AuthLogoutResult =
  | { ok: true }
  | { error: string };

export type AuthState =
  | { loggedIn: boolean; email: string | null; persisted: boolean }
  | { error: string };

export type TerminalRunResult = { runId: string } | { error: string };
export type TerminalKillResult = { ok: true } | { error: string };
export type TerminalStateResult = { running: boolean; runId: string | null } | { error: string };

export type TerminalDataEvent = {
  runId: string;
  stream: 'stdout' | 'stderr';
  text: string;
};

export type TerminalExitEvent = {
  runId: string;
  code: number | null;
  signal: string | null;
  durationMs: number;
  killed: boolean;
};

export interface ElectronAPI {
  windowControls: (action: 'minimize' | 'maximize' | 'close') => void;
  workspace: {
    open: () => Promise<WorkspaceTree | WorkspaceError | null>;
    refresh: () => Promise<WorkspaceTree | WorkspaceError | null>;
    readFile: (relPath: string) => Promise<WorkspaceReadFileResult | WorkspaceError>;
    writeFile: (relPath: string, content: string) => Promise<WorkspaceWriteFileResult | WorkspaceError>;
    createFile: (relPath: string) => Promise<WorkspacePathResult | WorkspaceError>;
    createFolder: (relPath: string) => Promise<WorkspacePathResult | WorkspaceError>;
    rename: (from: string, to: string) => Promise<WorkspaceRenameResult | WorkspaceError>;
    delete: (relPath: string) => Promise<WorkspacePathResult | WorkspaceError>;
    listFiles: () => Promise<WorkspaceListFilesResult | WorkspaceError>;
  };
  auth: {
    login: () => Promise<AuthLoginResult>;
    logout: () => Promise<AuthLogoutResult>;
    state: () => Promise<AuthState>;
  };
  agent: {
    start: (message: string, mode?: AgentMode) => Promise<AgentStartResult | AgentError>;
    approve: (callId: string, approved: boolean) => Promise<AgentOk | AgentError>;
    abort: () => Promise<AgentOk | AgentError>;
    newSession: () => Promise<AgentOk | AgentError>;
    listSessions: () => Promise<{ sessions: AgentSessionSummary[] } | { error: string }>;
    resume: (sessionId: string, mode: AgentMode) => Promise<{ sessionId: string; plan: PlanItem[] } | { error: string }>;
    state: () => Promise<AgentState | AgentError>;
    revertLastTurn: () => Promise<AgentRevertResult | AgentError>;
    trace: () => Promise<{ events: AgentTraceEvent[] } | AgentError>;
    listModels: () => Promise<{ models: IdeModel[]; default: { id: string; provider: string } | null; selected: ModelSelection | null } | AgentError>;
    setModel: (selection: ModelSelection | null) => Promise<{ ok: true; selected: ModelSelection | null } | AgentError>;
    onEvent: (callback: (event: AgentEvent) => void) => () => void;
    onDone: (callback: (done: AgentDone) => void) => () => void;
  };
  terminal: {
    run: (command: string) => Promise<TerminalRunResult>;
    kill: () => Promise<TerminalKillResult>;
    state: () => Promise<TerminalStateResult>;
    onData: (callback: (event: TerminalDataEvent) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
