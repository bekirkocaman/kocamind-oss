// Agent arayuz ve veri tipleri

export type AgentMode = 'ask' | 'auto-edit' | 'read-only';

export type PlanItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

export type AgentEvent =
  | { turnId: string; type: 'turn/start' }
  | { turnId: string; type: 'user/message'; content: string }
  | { turnId: string; type: 'step/start'; step: number }
  | { turnId: string; type: 'assistant/delta'; delta: string }
  | { turnId: string; type: 'assistant/message'; content: string; tool_calls?: unknown }
  | { turnId: string; type: 'tool/start'; callId: string; name: string; args: unknown }
  | { turnId: string; type: 'tool/result'; callId: string; name: string; ok: boolean; content: string }
  | {
      turnId: string;
      type: 'approval/request';
      callId: string;
      name: string;
      args: unknown;
      preview: { path: string; before: string | null; after: string } | null;
    }
  | { turnId: string; type: 'approval/result'; callId: string; approved: boolean }
  | {
      turnId: string;
      type: 'turn/end';
      status?: string;
      steps?: number;
      toolCalls?: number;
      limitReached?: 'steps' | 'tool_calls' | 'time' | null;
      usage?: unknown;
    };

export type AgentDone = {
  turnId: string;
  status: 'completed' | 'aborted' | 'failed';
  text?: string;
  steps?: number;
  toolCalls?: number;
  limitReached?: 'steps' | 'tool_calls' | 'time' | null;
  error?: string;
};

export type AgentSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
  turns: number;
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

export interface AgentApi {
  start(message: string, mode: AgentMode): Promise<{ turnId: string; sessionId: string } | { error: string }>;
  approve(callId: string, approved: boolean): Promise<{ ok: true } | { error: string }>;
  abort(): Promise<{ ok: true }>;
  newSession(): Promise<{ ok: true } | { error: string }>;
  listSessions(): Promise<{ sessions: AgentSessionSummary[] } | { error: string }>;
  resume(sessionId: string, mode: AgentMode): Promise<{ sessionId: string; plan: PlanItem[] } | { error: string }>;
  state(): Promise<{
    running: boolean;
    turnId: string | null;
    sessionId: string | null;
    mode: AgentMode | null;
    plan: PlanItem[];
    model: ModelSelection | null;
  }>;
  revertLastTurn(): Promise<{ turnId: string; restored: string[] } | { error: string }>;
  trace(): Promise<{ events: Array<{ seq: number; at: string; type: string; [key: string]: unknown }> } | { error: string }>;
  listModels(): Promise<{ models: IdeModel[]; default: { id: string; provider: string } | null; selected: ModelSelection | null } | { error: string }>;
  setModel(selection: ModelSelection | null): Promise<{ ok: true; selected: ModelSelection | null } | { error: string }>;
  onEvent(cb: (event: AgentEvent) => void): () => void;
  onDone(cb: (done: AgentDone) => void): () => void;
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      callId: string;
      name: string;
      args: unknown;
      status: 'running' | 'ok' | 'failed';
      error?: string;
    }
  | {
      kind: 'approval';
      id: string;
      callId: string;
      name: string;
      args: unknown;
      preview: { path: string; before: string | null; after: string } | null;
      status: 'pending' | 'approved' | 'rejected';
    }
  | { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string };

export type AgentState = {
  items: ChatItem[];
  running: boolean;
  turnId: string | null;
  plan: PlanItem[];
  mode: AgentMode;
};

export type AgentAction =
  | { type: 'send'; text: string }
  | { type: 'started'; turnId: string }
  | { type: 'startFailed'; error: string }
  | { type: 'event'; event: AgentEvent }
  | { type: 'done'; done: AgentDone }
  | { type: 'setMode'; mode: AgentMode }
  | { type: 'resumed'; plan: PlanItem[] }
  | { type: 'notice'; tone: 'info' | 'error'; text: string }
  | { type: 'reset' };
