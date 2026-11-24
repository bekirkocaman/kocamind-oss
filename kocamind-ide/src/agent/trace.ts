export type TraceEvent = {
  seq: number;
  at: string;
  type: string;
  [key: string]: unknown;
};

export type TraceTool = {
  callId: string;
  name: string;
  summary: string;
  ok: boolean | null;
  durationMs: number | null;
  approval: 'approved' | 'rejected' | null;
};

export type TraceStep = {
  step: number;
  startedAt: string;
  durationMs: number | null;
  text: string;
  tools: TraceTool[];
};

export type TraceTurn = {
  index: number;
  userText: string;
  startedAt: string;
  durationMs: number | null;
  status: string | null;
  limitReached: string | null;
  steps: TraceStep[];
  compacted: boolean;
  usage: { total_tokens: number } | null;
};

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function diffMs(startIso: unknown, endIso: unknown): number | null {
  if (typeof startIso !== 'string' || typeof endIso !== 'string') return null;
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

function extractToolSummary(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const obj = args as Record<string, unknown>;
  const raw = obj.path ?? obj.pattern ?? obj.command ?? obj.description;
  return clip(raw, 80);
}

export function buildTrace(events: TraceEvent[]): TraceTurn[] {
  const turns: TraceTurn[] = [];
  let currentTurn: TraceTurn | null = null;
  let currentStep: TraceStep | null = null;
  let toolsByCallId = new Map<string, { tool: TraceTool; startedAt: string }>();
  let approvalsByCallId = new Map<string, 'approved' | 'rejected'>();

  const closeCurrentTurn = () => {
    if (!currentTurn) return;
    turns.push(currentTurn);
    currentTurn = null;
    currentStep = null;
    toolsByCallId = new Map();
    approvalsByCallId = new Map();
  };

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const at = typeof ev.at === 'string' ? ev.at : '';

    if (ev.type === 'turn/start') {
      closeCurrentTurn();
      currentTurn = {
        index: turns.length + 1,
        userText: '',
        startedAt: at,
        durationMs: null,
        status: null,
        limitReached: null,
        steps: [],
        compacted: false,
        usage: null,
      };
      continue;
    }

    if (!currentTurn) continue;

    switch (ev.type) {
      case 'user/message': {
        currentTurn.userText = clip(ev.content, 200);
        break;
      }

      case 'context/compact': {
        currentTurn.compacted = true;
        break;
      }

      case 'step/start': {
        if (currentStep) {
          currentStep.durationMs = diffMs(currentStep.startedAt, at);
        }
        const stepNum = typeof ev.step === 'number' ? ev.step : currentTurn.steps.length + 1;
        currentStep = {
          step: stepNum,
          startedAt: at,
          durationMs: null,
          text: '',
          tools: [],
        };
        currentTurn.steps.push(currentStep);
        break;
      }

      case 'assistant/message': {
        if (currentStep && typeof ev.content === 'string') {
          currentStep.text = clip(ev.content, 300);
        }
        break;
      }

      case 'tool/start': {
        if (!currentStep) {
          currentStep = {
            step: currentTurn.steps.length + 1,
            startedAt: at,
            durationMs: null,
            text: '',
            tools: [],
          };
          currentTurn.steps.push(currentStep);
        }
        const callId = typeof ev.callId === 'string' ? ev.callId : '';
        const name = typeof ev.name === 'string' ? ev.name : '';
        const tool: TraceTool = {
          callId,
          name,
          summary: extractToolSummary(ev.args),
          ok: null,
          durationMs: null,
          approval: callId ? approvalsByCallId.get(callId) ?? null : null,
        };
        currentStep.tools.push(tool);
        if (callId) {
          toolsByCallId.set(callId, { tool, startedAt: at });
        }
        break;
      }

      case 'tool/result': {
        const callId = typeof ev.callId === 'string' ? ev.callId : '';
        const entry = callId ? toolsByCallId.get(callId) : undefined;
        if (entry) {
          entry.tool.ok = typeof ev.ok === 'boolean' ? ev.ok : Boolean(ev.ok);
          entry.tool.durationMs = diffMs(entry.startedAt, at);
        }
        break;
      }

      case 'approval/result': {
        const callId = typeof ev.callId === 'string' ? ev.callId : '';
        if (!callId) break;
        const status: 'approved' | 'rejected' = ev.approved ? 'approved' : 'rejected';
        approvalsByCallId.set(callId, status);
        const entry = toolsByCallId.get(callId);
        if (entry) {
          entry.tool.approval = status;
        }
        break;
      }

      case 'turn/end': {
        if (currentStep) {
          currentStep.durationMs = diffMs(currentStep.startedAt, at);
        }
        currentTurn.durationMs = diffMs(currentTurn.startedAt, at);
        currentTurn.status = typeof ev.status === 'string' ? ev.status : null;
        currentTurn.limitReached = typeof ev.limitReached === 'string' ? ev.limitReached : null;
        if (
          ev.usage &&
          typeof ev.usage === 'object' &&
          typeof (ev.usage as Record<string, unknown>).total_tokens === 'number'
        ) {
          currentTurn.usage = {
            total_tokens: (ev.usage as Record<string, unknown>).total_tokens as number,
          };
        }
        closeCurrentTurn();
        break;
      }
    }
  }

  closeCurrentTurn();
  return turns;
}
