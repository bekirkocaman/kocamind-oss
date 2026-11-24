import { useCallback, useEffect, useReducer } from 'react';
import { getAgentApi } from './agentApi.ts';
import { agentReducer, initialAgentState } from './reducer.ts';
import { buildTrace, type TraceTurn } from './trace.ts';
import type { AgentMode, AgentSessionSummary, AgentState, IdeModel, ModelSelection } from './types.ts';

// Agent durumunu ve islemlerini yoneten kanca
export function useAgent(): {
  state: AgentState;
  available: boolean;
  send: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  approve: (callId: string, approved: boolean) => Promise<void>;
  newSession: () => Promise<void>;
  listSessions: () => Promise<{ sessions: AgentSessionSummary[] } | { error: string }>;
  resume: (sessionId: string) => Promise<boolean>;
  setMode: (mode: AgentMode) => void;
  revertLastTurn: () => Promise<void>;
  loadTrace: () => Promise<TraceTurn[]>;
  listModels: () => Promise<
    { models: IdeModel[]; default: { id: string; provider: string } | null; selected: ModelSelection | null } | { error: string }
  >;
  setModel: (selection: ModelSelection | null) => Promise<{ ok: true; selected: ModelSelection | null } | { error: string }>;
  notifyError: (text: string) => void;
} {
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);
  const api = getAgentApi();
  const available = api !== null;

  useEffect(() => {
    if (!api) return;

    const unsubEvent = api.onEvent((event) => {
      dispatch({ type: 'event', event });
    });
    const unsubDone = api.onDone((done) => {
      dispatch({ type: 'done', done });
    });

    return () => {
      unsubEvent();
      unsubDone();
    };
  }, [api]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || state.running) return;
      if (!api) return;

      dispatch({ type: 'send', text: trimmed });
      try {
        const res = await api.start(trimmed, state.mode);
        if ('error' in res) {
          dispatch({ type: 'startFailed', error: res.error });
        } else {
          dispatch({ type: 'started', turnId: res.turnId });
        }
      } catch (err) {
        dispatch({
          type: 'startFailed',
          error: (err as Error)?.message || 'Agent başlatılamadı.',
        });
      }
    },
    [api, state.running, state.mode]
  );

  const abort = useCallback(async () => {
    if (!api) return;
    try {
      await api.abort();
    } catch {
      // sessiz kal
    }
  }, [api]);

  const approve = useCallback(
    async (callId: string, approved: boolean) => {
      if (!api) return;
      try {
        await api.approve(callId, approved);
      } catch {
        // sessiz kal (olay akisi durumu zaten gunceller)
      }
    },
    [api]
  );

  const newSession = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.newSession();
      if ('ok' in res && res.ok) {
        dispatch({ type: 'reset' });
      }
    } catch {
      // sessiz kal
    }
  }, [api]);

  const listSessions = useCallback(async (): Promise<
    { sessions: AgentSessionSummary[] } | { error: string }
  > => {
    if (!api) return { sessions: [] };
    try {
      return await api.listSessions();
    } catch (err) {
      return { error: (err as Error)?.message || 'Oturumlar alınamadı.' };
    }
  }, [api]);

  const resume = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!api || state.running) return false;
      try {
        const res = await api.resume(sessionId, state.mode);
        if ('error' in res) {
          dispatch({ type: 'startFailed', error: res.error });
          return false;
        }
        dispatch({ type: 'resumed', plan: res.plan });
        return true;
      } catch (err) {
        dispatch({
          type: 'startFailed',
          error: (err as Error)?.message || 'Oturum açılamadı.',
        });
        return false;
      }
    },
    [api, state.running, state.mode]
  );

  const setMode = useCallback((mode: AgentMode) => {
    dispatch({ type: 'setMode', mode });
  }, []);

  const revertLastTurn = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.revertLastTurn();
      if ('error' in res) {
        dispatch({ type: 'notice', tone: 'error', text: res.error });
        return;
      }
      const files = Array.isArray(res.restored) ? res.restored : [];
      const shown = files.slice(0, 5).join(', ');
      const extra = files.length > 5 ? ` +${files.length - 5}` : '';
      const text =
        files.length > 0
          ? `Son turun değişiklikleri geri alındı: ${shown}${extra}`
          : 'Son turun değişiklikleri geri alındı.';
      dispatch({ type: 'notice', tone: 'info', text });
    } catch (err) {
      dispatch({
        type: 'notice',
        tone: 'error',
        text: (err as Error)?.message || 'Geri alma başarısız.',
      });
    }
  }, [api]);

  const loadTrace = useCallback(async (): Promise<TraceTurn[]> => {
    if (!api) return [];
    try {
      const res = await api.trace();
      if ('error' in res || !Array.isArray(res.events)) return [];
      return buildTrace(res.events);
    } catch {
      return [];
    }
  }, [api]);

  const notifyError = useCallback((text: string) => {
    dispatch({ type: 'notice', tone: 'error', text });
  }, []);

  const listModels = useCallback(async () => {
    if (!api) return { error: 'Asistan kullanılamıyor.' };
    try {
      return await api.listModels();
    } catch (err) {
      return { error: (err as Error)?.message || 'Modeller alınamadı.' };
    }
  }, [api]);

  const setModel = useCallback(
    async (selection: ModelSelection | null) => {
      if (!api) return { error: 'Asistan kullanılamıyor.' };
      try {
        const res = await api.setModel(selection);
        if ('error' in res) {
          dispatch({ type: 'notice', tone: 'error', text: res.error });
        }
        return res;
      } catch (err) {
        const msg = (err as Error)?.message || 'Model değiştirilemedi.';
        dispatch({ type: 'notice', tone: 'error', text: msg });
        return { error: msg };
      }
    },
    [api]
  );

  return {
    state,
    available,
    send,
    abort,
    approve,
    newSession,
    listSessions,
    resume,
    setMode,
    revertLastTurn,
    loadTrace,
    listModels,
    setModel,
    notifyError,
  };
}
