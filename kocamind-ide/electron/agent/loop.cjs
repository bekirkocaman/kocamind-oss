'use strict';

const { deriveMessages } = require('./sessionLog.cjs');
const { estimateTokens, trimOldToolOutputs, summarizeHistory } = require('./compact.cjs');

const DEFAULT_MAX_STEPS = 25;
const DEFAULT_MAX_TOOL_CALLS = 60;
const DEFAULT_MAX_WALL_TIME_MS = 600000;
const DEFAULT_CONTEXT_MAX_TOKENS = 60000;
const DEFAULT_KEEP_RECENT_TURNS = 2;
const LIMIT_FALLBACK_TEXT =
  'Sınıra ulaştım ve net bir cevap çıkaramadım. Kaldığım yerden devam etmemi ister misin?';
const MAX_ERROR_LEN = 600;
const MAX_TOOL_JSON_LEN = 12000;
const TRUNCATED_TOOL_JSON_SLICE = 11000;
const READ_RETRY_DELAY_MS = 200;

function trimError(msg) {
  const s = typeof msg === 'string' && msg ? msg : 'Bilinmeyen hata.';
  return s.length > MAX_ERROR_LEN ? s.slice(0, MAX_ERROR_LEN) : s;
}

function serializeToolOutput(outputObj) {
  const json = JSON.stringify(outputObj);
  if (json.length <= MAX_TOOL_JSON_LEN) {
    return json;
  }
  return JSON.stringify({
    ok: Boolean(outputObj.ok),
    truncated: true,
    result: json.slice(0, TRUNCATED_TOOL_JSON_SLICE),
  });
}

function stableArgsKey(name, args) {
  const sorted = {};
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    for (const k of Object.keys(args).sort()) {
      sorted[k] = args[k];
    }
  }
  return `${name}:${JSON.stringify(sorted)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Son `keepRecentTurns` turdan önceki son olayın seq'i; yeterli tur yoksa null
function findCompactBoundary(events, keepRecentTurns) {
  const keep = Math.max(1, Math.floor(keepRecentTurns) || 1);
  const startIdx = [];
  events.forEach((ev, i) => {
    if (ev && ev.type === 'turn/start') startIdx.push(i);
  });
  if (startIdx.length < keep) return null;
  const boundaryIdx = startIdx[startIdx.length - keep];
  for (let i = boundaryIdx - 1; i >= 0; i--) {
    if (events[i] && typeof events[i].seq === 'number') return events[i].seq;
  }
  return null;
}

// Özetlenecek olaylar: sınıra kadarki olaylar + (varsa) sınırı aşmayan son özet
function eventsToSummarize(events, uptoSeq) {
  let prior = null;
  for (const ev of events) {
    if (ev && ev.type === 'context/compact' && typeof ev.uptoSeq === 'number' && ev.uptoSeq <= uptoSeq) {
      prior = ev;
    }
  }
  const subset = events.filter(
    (ev) => ev && ev.type !== 'context/compact' && typeof ev.seq === 'number' && ev.seq <= uptoSeq
  );
  if (prior) subset.push(prior);
  return subset;
}

function lastCompactUpto(events) {
  let upto = null;
  for (const ev of events) {
    if (ev && ev.type === 'context/compact' && typeof ev.uptoSeq === 'number') upto = ev.uptoSeq;
  }
  return upto;
}

async function runAgentTurn({
  model,
  registry,
  workspace,
  log,
  policy,
  session = { plan: [] },
  checkpoints = null,
  systemPrompt = '',
  userMessage = '',
  requestApproval = null,
  onEvent = () => {},
  signal = null,
  limits = {},
  context = {},
  now = () => Date.now(),
}) {
  const maxSteps = limits.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxToolCalls = limits.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const maxWallTimeMs = limits.maxWallTimeMs ?? DEFAULT_MAX_WALL_TIME_MS;
  const ctxOpts = context && typeof context === 'object' ? context : {};
  const contextMaxTokens = ctxOpts.maxTokens ?? DEFAULT_CONTEXT_MAX_TOKENS;
  const keepRecentTurns = ctxOpts.keepRecentTurns ?? DEFAULT_KEEP_RECENT_TURNS;

  const startTime = now();
  let steps = 0;
  let usedToolCalls = 0;
  let limitReached = null;
  let totalUsage = null;
  let lastText = '';
  let compactAttempted = false;
  const readCache = new Map();

  function emit(event) {
    const rec = log.append(event);
    try {
      onEvent(rec);
    } catch {}
    return rec;
  }

  function addUsage(u) {
    if (!u || typeof u !== 'object') return;
    if (!totalUsage) {
      totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }
    totalUsage.prompt_tokens += u.prompt_tokens || 0;
    totalUsage.completion_tokens += u.completion_tokens || 0;
    totalUsage.total_tokens += u.total_tokens || 0;
  }

  // Bağlam sınırı: önce eski araç çıktılarını kırp, yetmezse (turda bir kez) özetle.
  // Kayıt yeniden yazılmaz; özet yeni bir olay olarak eklenir.
  async function fitContext(messages) {
    if (estimateTokens(messages) <= contextMaxTokens) return messages;
    let fitted = trimOldToolOutputs(messages);
    if (estimateTokens(fitted) <= contextMaxTokens) return fitted;
    if (compactAttempted || (signal && signal.aborted)) return fitted;

    const events = log.read();
    const uptoSeq = findCompactBoundary(events, keepRecentTurns);
    if (uptoSeq === null) return fitted;
    const prevUpto = lastCompactUpto(events);
    if (prevUpto !== null && uptoSeq <= prevUpto) return fitted; // özetlenecek yeni bir şey yok

    compactAttempted = true;
    let result;
    try {
      result = await summarizeHistory({
        model,
        messages: deriveMessages(eventsToSummarize(events, uptoSeq)),
        signal,
      });
    } catch (err) {
      addUsage(err && err.usage ? err.usage : null);
      if (!(signal && signal.aborted)) {
        try {
          onEvent({
            type: 'context/compact_failed',
            error: trimError(err && err.message ? err.message : String(err)),
          });
        } catch {}
      }
      return fitted;
    }
    addUsage(result.usage);
    emit({ type: 'context/compact', summary: result.summary, uptoSeq });

    fitted = [{ role: 'system', content: systemPrompt }, ...deriveMessages(log.read())];
    if (estimateTokens(fitted) > contextMaxTokens) {
      fitted = trimOldToolOutputs(fitted);
    }
    return fitted;
  }

  function finishTurn(status, extra = {}) {
    let logError = false;
    try {
      emit({
        type: 'turn/end',
        status,
        steps,
        toolCalls: usedToolCalls,
        limitReached,
        usage: totalUsage,
      });
    } catch {
      logError = true;
    }
    const res = {
      status,
      text: lastText,
      steps,
      toolCalls: usedToolCalls,
      limitReached,
      usage: totalUsage,
    };
    if (logError) {
      res.logError = true;
    }
    if (extra.error !== undefined) {
      res.error = extra.error;
    }
    return res;
  }

  try {
    const startRec = emit({ type: 'turn/start' });
    emit({ type: 'user/message', content: userMessage });

    if (checkpoints && typeof checkpoints.begin === 'function') {
      const startSeq = typeof startRec?.seq === 'number' ? startRec.seq : 1;
      checkpoints.begin(`turn-${startSeq}`);
    }

    const modelTools = registry.toModelTools();

    while (true) {
      if (signal && signal.aborted) {
        return finishTurn('aborted');
      }

      steps += 1;
      const elapsed = now() - startTime;

      let finalStep = false;
      if (elapsed >= maxWallTimeMs) {
        finalStep = true;
        limitReached = 'time';
      } else if (usedToolCalls >= maxToolCalls) {
        finalStep = true;
        limitReached = 'tool_calls';
      } else if (steps >= maxSteps) {
        finalStep = true;
        limitReached = 'steps';
      }

      emit({ type: 'step/start', step: steps });

      const historyMessages = deriveMessages(log.read());
      const messages = await fitContext([
        { role: 'system', content: systemPrompt },
        ...historyMessages,
      ]);
      if (signal && signal.aborted) {
        return finishTurn('aborted');
      }
      const toolChoice = finalStep ? 'none' : 'auto';

      let modelResponse;
      try {
        modelResponse = await model.complete({
          messages,
          tools: modelTools,
          toolChoice,
          signal,
          onDelta(delta) {
            try {
              onEvent({ type: 'assistant/delta', delta });
            } catch {}
          },
        });
      } catch (err) {
        if (signal && signal.aborted) {
          return finishTurn('aborted');
        }
        const errMsg = trimError(err && err.message ? err.message : String(err));
        return finishTurn('failed', { error: errMsg });
      }

      if (signal && signal.aborted) {
        return finishTurn('aborted');
      }

      addUsage(modelResponse && modelResponse.usage ? modelResponse.usage : null);

      const rawContent =
        modelResponse && typeof modelResponse.content === 'string' ? modelResponse.content : '';
      const rawToolCalls =
        modelResponse && Array.isArray(modelResponse.toolCalls) ? modelResponse.toolCalls : [];

      if (finalStep || rawToolCalls.length === 0) {
        lastText =
          finalStep && rawToolCalls.length > 0 && rawContent.trim() === ''
            ? LIMIT_FALLBACK_TEXT
            : rawContent;

        emit({
          type: 'assistant/message',
          content: lastText,
        });

        return finishTurn('completed');
      }

      lastText = rawContent;
      const formattedToolCalls = rawToolCalls.map((tc) => {
        const out = {
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments ?? {}),
          },
        };
        if (tc.extra_content && typeof tc.extra_content === 'object' && !Array.isArray(tc.extra_content)) {
          out.extra_content = tc.extra_content;
        }
        return out;
      });

      emit({
        type: 'assistant/message',
        content: rawContent,
        tool_calls: formattedToolCalls,
      });

      // Adımdaki bütün çağrılar read riskliyse paralel, aksi halde sırayla
      const allRead = rawToolCalls.every((tc) => {
        const t = registry.get(tc.name);
        return t && t.risk === 'read';
      });

      const ctx = { workspace, signal, session };

      async function prepareAndExecuteCall(tc, deferResultEmit = false) {
        const callId = tc.id;
        const name = tc.name;

        let validatedArgs;
        try {
          validatedArgs = registry.validate(name, tc.arguments);
        } catch (err) {
          const out = { ok: false, error: trimError(`Geçersiz parametre: ${err.message}`) };
          const content = serializeToolOutput(out);
          emit({ type: 'tool/start', callId, name, args: {} });
          if (!deferResultEmit) {
            emit({ type: 'tool/result', callId, name, ok: false, content });
          }
          return { callId, name, ok: false, content };
        }

        if (usedToolCalls >= maxToolCalls) {
          const out = { ok: false, error: 'Araç çağrısı sınırına ulaşıldı.' };
          const content = serializeToolOutput(out);
          emit({ type: 'tool/start', callId, name, args: validatedArgs });
          if (!deferResultEmit) {
            emit({ type: 'tool/result', callId, name, ok: false, content });
          }
          return { callId, name, ok: false, content };
        }

        const tool = registry.get(name);
        const decision = policy.decide(tool, validatedArgs);
        let previewData = null;

        if (decision === 'deny') {
          const out = { ok: false, error: 'Bu modda bu işlem kapalı.' };
          const content = serializeToolOutput(out);
          emit({ type: 'tool/start', callId, name, args: validatedArgs });
          if (!deferResultEmit) {
            emit({ type: 'tool/result', callId, name, ok: false, content });
          }
          return { callId, name, ok: false, content };
        }

        if (decision === 'ask') {
          if (typeof tool.preview === 'function') {
            try {
              previewData = await tool.preview(validatedArgs, ctx);
            } catch (err) {
              const out = { ok: false, error: trimError(err.message) };
              const content = serializeToolOutput(out);
              emit({ type: 'tool/start', callId, name, args: validatedArgs });
              if (!deferResultEmit) {
                emit({ type: 'tool/result', callId, name, ok: false, content });
              }
              return { callId, name, ok: false, content };
            }
          }

          emit({
            type: 'approval/request',
            callId,
            name,
            args: validatedArgs,
            preview: previewData,
          });

          let approved = false;
          if (typeof requestApproval === 'function') {
            try {
              const approvalRes = await requestApproval({
                callId,
                tool: name,
                name,
                args: validatedArgs,
                preview: previewData,
              });
              approved = Boolean(approvalRes && approvalRes.approved);
            } catch (err) {
              if (signal && signal.aborted) {
                throw err;
              }
              approved = false;
            }
          }

          emit({ type: 'approval/result', callId, approved });

          if (!approved) {
            const out = { ok: false, error: 'Kullanıcı işlemi onaylamadı.' };
            const content = serializeToolOutput(out);
            emit({ type: 'tool/start', callId, name, args: validatedArgs });
            if (!deferResultEmit) {
              emit({ type: 'tool/result', callId, name, ok: false, content });
            }
            return { callId, name, ok: false, content };
          }
        }

        let callCtx = ctx;
        if (decision === 'ask' && previewData && previewData.beforeHash !== undefined) {
          callCtx = { ...ctx, expectedBeforeHash: previewData.beforeHash };
        }

        let out;
        if (tool.risk === 'read') {
          const cacheKey = stableArgsKey(name, validatedArgs);
          if (readCache.has(cacheKey)) {
            emit({ type: 'tool/start', callId, name, args: validatedArgs });
            out = await readCache.get(cacheKey);
          } else {
            usedToolCalls += 1;
            emit({ type: 'tool/start', callId, name, args: validatedArgs });
            const execPromise = (async () => {
              try {
                const result = await tool.execute(validatedArgs, ctx);
                return { ok: true, result };
              } catch {
                await sleep(READ_RETRY_DELAY_MS);
                try {
                  const result = await tool.execute(validatedArgs, ctx);
                  return { ok: true, result };
                } catch (secondErr) {
                  return { ok: false, error: trimError(secondErr.message) };
                }
              }
            })();
            readCache.set(cacheKey, execPromise);
            out = await execPromise;
          }
        } else {
          usedToolCalls += 1;
          emit({ type: 'tool/start', callId, name, args: validatedArgs });

          let preflightOk = true;
          if (decision !== 'ask' && (name === 'write_file' || name === 'edit_file')) {
            if (typeof tool.preview === 'function') {
              try {
                previewData = await tool.preview(validatedArgs, callCtx);
              } catch (err) {
                preflightOk = false;
                out = { ok: false, error: trimError(err.message) };
              }
            }
          }

          if (preflightOk) {
            if (
              (name === 'write_file' || name === 'edit_file') &&
              checkpoints &&
              typeof checkpoints.record === 'function' &&
              validatedArgs &&
              typeof validatedArgs.path === 'string'
            ) {
              try {
                const abs = workspace.resolve(validatedArgs.path);
                const rel = workspace.toRelative(abs);
                checkpoints.record(abs, rel);
              } catch {}
            }
            try {
              const result = await tool.execute(validatedArgs, callCtx);
              out = { ok: true, result };
            } catch (err) {
              out = { ok: false, error: trimError(err.message) };
            }
          }
        }

        const content = serializeToolOutput(out);
        if (!deferResultEmit) {
          emit({ type: 'tool/result', callId, name, ok: Boolean(out.ok), content });
        }
        return { callId, name, ok: Boolean(out.ok), content };
      }

      if (allRead && rawToolCalls.length > 1) {
        const tasks = [];
        for (const tc of rawToolCalls) {
          if (signal && signal.aborted) {
            return finishTurn('aborted');
          }
          tasks.push(prepareAndExecuteCall(tc, true));
        }
        const results = await Promise.all(tasks);
        for (const r of results) {
          emit({
            type: 'tool/result',
            callId: r.callId,
            name: r.name,
            ok: r.ok,
            content: r.content,
          });
        }
      } else {
        for (const tc of rawToolCalls) {
          if (signal && signal.aborted) {
            return finishTurn('aborted');
          }
          await prepareAndExecuteCall(tc, false);
        }
      }

      if (signal && signal.aborted) {
        return finishTurn('aborted');
      }
    }
  } catch (unexpectedErr) {
    if (signal && signal.aborted) {
      return finishTurn('aborted');
    }
    const errMsg = trimError(
      unexpectedErr && unexpectedErr.message ? unexpectedErr.message : String(unexpectedErr)
    );
    return finishTurn('failed', { error: errMsg });
  }
}

module.exports = { runAgentTurn };
