import type { AgentAction, AgentState, ChatItem, PlanItem } from './types.ts';

// Baslangic durumu
export const initialAgentState: AgentState = {
  items: [],
  running: false,
  turnId: null,
  plan: [],
  mode: 'ask',
};

// Saf durum yoneticisi
export function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'send': {
      const userItem: ChatItem = {
        kind: 'user',
        id: `user-${state.items.length}`,
        text: action.text,
      };
      return {
        ...state,
        items: [...state.items, userItem],
        running: true,
        turnId: null,
      };
    }

    case 'started': {
      return {
        ...state,
        turnId: action.turnId,
      };
    }

    case 'startFailed': {
      const noticeItem: ChatItem = {
        kind: 'notice',
        id: `notice-${state.items.length}`,
        tone: 'error',
        text: action.error,
      };
      return {
        ...state,
        running: false,
        items: [...state.items, noticeItem],
      };
    }

    case 'event': {
      const { event } = action;
      if (state.turnId !== null && event.turnId !== state.turnId) {
        return state;
      }
      const turnId = state.turnId ?? event.turnId;

      switch (event.type) {
        case 'turn/start':
        case 'user/message':
        case 'turn/end':
          return state.turnId === turnId ? state : { ...state, turnId };

        case 'step/start': {
          let hasStreaming = false;
          const items = state.items.map(item => {
            if (item.kind === 'assistant' && item.streaming) {
              hasStreaming = true;
              return { ...item, streaming: false };
            }
            return item;
          });
          if (!hasStreaming && state.turnId === turnId) return state;
          return { ...state, turnId, items };
        }

        case 'assistant/delta': {
          const lastItem = state.items[state.items.length - 1];
          let items: ChatItem[];
          if (lastItem && lastItem.kind === 'assistant' && lastItem.streaming) {
            items = [
              ...state.items.slice(0, -1),
              { ...lastItem, text: lastItem.text + event.delta },
            ];
          } else {
            items = [
              ...state.items,
              {
                kind: 'assistant',
                id: `asst-${state.items.length}`,
                text: event.delta,
                streaming: true,
              },
            ];
          }
          return { ...state, turnId, items };
        }

        case 'assistant/message': {
          const streamingIndex = state.items.findLastIndex(
            item => item.kind === 'assistant' && item.streaming
          );

          let items = state.items;
          if (streamingIndex >= 0) {
            const streamingItem = state.items[streamingIndex] as ChatItem & { kind: 'assistant' };
            if (event.content.length > 0) {
              items = state.items.map((item, idx) =>
                idx === streamingIndex
                  ? { ...item, text: event.content, streaming: false }
                  : item
              );
            } else {
              if (streamingItem.text.length === 0) {
                items = state.items.filter((_, idx) => idx !== streamingIndex);
              } else {
                items = state.items.map((item, idx) =>
                  idx === streamingIndex ? { ...item, streaming: false } : item
                );
              }
            }
          } else {
            if (event.content.length > 0) {
              items = [
                ...state.items,
                {
                  kind: 'assistant',
                  id: `asst-${state.items.length}`,
                  text: event.content,
                  streaming: false,
                },
              ];
            }
          }
          return { ...state, turnId, items };
        }

        case 'tool/start': {
          const exists = state.items.some(
            item => item.kind === 'tool' && item.callId === event.callId
          );
          if (exists) {
            return state.turnId === turnId ? state : { ...state, turnId };
          }
          const toolItem: ChatItem = {
            kind: 'tool',
            id: `tool-${event.callId}`,
            callId: event.callId,
            name: event.name,
            args: event.args,
            status: 'running',
          };
          return { ...state, turnId, items: [...state.items, toolItem] };
        }

        case 'tool/result': {
          let parsedError: string | undefined;
          let newPlan: PlanItem[] | null = null;
          try {
            const parsed = JSON.parse(event.content);
            if (parsed && typeof parsed === 'object') {
              if (!event.ok && typeof parsed.error === 'string') {
                parsedError = parsed.error;
              }
              if (
                event.name === 'update_plan' &&
                event.ok &&
                parsed.result &&
                Array.isArray(parsed.result.items)
              ) {
                newPlan = parsed.result.items as PlanItem[];
              }
            }
          } catch {
            // parse edilemezse yok
          }

          const toolIndex = state.items.findIndex(
            item => item.kind === 'tool' && item.callId === event.callId
          );
          let items: ChatItem[];
          if (toolIndex >= 0) {
            items = state.items.map((item, idx) => {
              if (idx === toolIndex && item.kind === 'tool') {
                return {
                  ...item,
                  status: event.ok ? ('ok' as const) : ('failed' as const),
                  ...(parsedError ? { error: parsedError } : {}),
                };
              }
              return item;
            });
          } else {
            const newItem: ChatItem = {
              kind: 'tool',
              id: `tool-${event.callId}`,
              callId: event.callId,
              name: event.name,
              args: undefined,
              status: event.ok ? 'ok' : 'failed',
              ...(parsedError ? { error: parsedError } : {}),
            };
            items = [...state.items, newItem];
          }

          return {
            ...state,
            turnId,
            items,
            plan: newPlan ?? state.plan,
          };
        }

        case 'approval/request': {
          const approvalItem: ChatItem = {
            kind: 'approval',
            id: `approval-${event.callId}`,
            callId: event.callId,
            name: event.name,
            args: event.args,
            preview: event.preview,
            status: 'pending',
          };
          return {
            ...state,
            turnId,
            items: [...state.items, approvalItem],
          };
        }

        case 'approval/result': {
          const items = state.items.map(item => {
            if (item.kind === 'approval' && item.callId === event.callId) {
              return {
                ...item,
                status: event.approved ? ('approved' as const) : ('rejected' as const),
              };
            }
            return item;
          });
          return { ...state, turnId, items };
        }
      }
      break;
    }

    case 'done': {
      if (state.turnId !== null && action.done.turnId !== state.turnId) {
        return state;
      }

      let items = state.items.map(item => {
        if (item.kind === 'assistant' && item.streaming) {
          return { ...item, streaming: false };
        }
        if (item.kind === 'approval' && item.status === 'pending') {
          return { ...item, status: 'rejected' as const };
        }
        if (item.kind === 'tool' && item.status === 'running') {
          return { ...item, status: 'failed' as const };
        }
        return item;
      });

      if (action.done.status === 'aborted') {
        items = [
          ...items,
          {
            kind: 'notice',
            id: `notice-${items.length}`,
            tone: 'info',
            text: 'Durduruldu.',
          },
        ];
      } else if (action.done.status === 'failed') {
        items = [
          ...items,
          {
            kind: 'notice',
            id: `notice-${items.length}`,
            tone: 'error',
            text: action.done.error || 'Bir hata oluştu.',
          },
        ];
      } else if (action.done.status === 'completed') {
        if (action.done.limitReached) {
          let limitText = '';
          if (action.done.limitReached === 'steps') {
            limitText = 'Adım sınırına ulaşıldı.';
          } else if (action.done.limitReached === 'tool_calls') {
            limitText = 'Araç sınırına ulaşıldı.';
          } else if (action.done.limitReached === 'time') {
            limitText = 'Süre sınırına ulaşıldı.';
          }

          if (limitText) {
            items = [
              ...items,
              {
                kind: 'notice',
                id: `notice-${items.length}`,
                tone: 'info',
                text: limitText,
              },
            ];
          }
        }

        const lastUserIdx = items.findLastIndex(i => i.kind === 'user');
        const hasAssistantInTurn =
          lastUserIdx >= 0
            ? items.slice(lastUserIdx).some(i => i.kind === 'assistant')
            : items.some(i => i.kind === 'assistant');

        if (!hasAssistantInTurn && action.done.text) {
          items = [
            ...items,
            {
              kind: 'assistant',
              id: `asst-${items.length}`,
              text: action.done.text,
              streaming: false,
            },
          ];
        }
      }

      return {
        ...state,
        running: false,
        items,
      };
    }

    case 'setMode': {
      if (state.running) return state;
      return { ...state, mode: action.mode };
    }

    case 'resumed': {
      if (state.running) return state;
      return {
        ...initialAgentState,
        mode: state.mode,
        plan: action.plan,
        items: [
          {
            kind: 'notice',
            id: 'notice-0',
            tone: 'info',
            text: 'Önceki oturum açıldı. Kaldığın yerden devam edebilirsin.',
          },
        ],
      };
    }

    case 'notice': {
      const noticeItem: ChatItem = {
        kind: 'notice',
        id: `notice-${state.items.length}`,
        tone: action.tone,
        text: action.text,
      };
      return {
        ...state,
        items: [...state.items, noticeItem],
      };
    }

    case 'reset': {
      if (state.running) return state;
      return { ...initialAgentState, mode: state.mode };
    }
  }

  return state;
}
