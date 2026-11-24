const { z } = require('zod');
const { watchChatCompletionUsage } = require('./chat');
const { scanMessage } = require('../skills/jailbreakGuard');
const {
  buildIdeResponsesPayload,
  pipeIdeResponsesAsChatCompletions,
  toIdeChatCompletion,
} = require('../ideResponses');

const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(64),
    arguments: z.string().max(400000),
  }).strict(),
  extra_content: z.object({ google: z.object({ thought_signature: z.string().max(20000) }).strict().optional() }).strict().optional(),
}).strict();

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(400000).nullable(),
  tool_calls: z.array(toolCallSchema).min(1).max(50).optional(),
  tool_call_id: z.string().min(1).max(200).optional(),
}).strict().superRefine((msg, ctx) => {
  if (msg.tool_calls !== undefined && msg.role !== 'assistant') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tool_calls yalnızca assistant rolünde geçerlidir.' });
  }
  if (msg.content === null && (msg.role !== 'assistant' || !msg.tool_calls?.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'content yalnızca assistant tool_calls mesajlarında null olabilir.' });
  }
  if (msg.role === 'tool' && !msg.tool_call_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tool rolünde tool_call_id zorunludur.' });
  }
  if (msg.role !== 'tool' && msg.tool_call_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tool_call_id yalnızca tool rolünde geçerlidir.' });
  }
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    description: z.string().max(4000),
    parameters: z.record(z.string(), z.unknown()).refine(
      val => val !== null && typeof val === 'object' && !Array.isArray(val),
      { message: 'parameters nesne olmalı.' },
    ),
  }).strict(),
}).strict();

const ideCompleteRequestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(400),
  tools: z.array(toolDefinitionSchema).max(40).optional(),
  tool_choice: z.enum(['auto', 'none']).optional().default('auto'),
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  stream: z.boolean().optional().default(true),
}).strict();

const ideWebSearchSchema = z.object({
  query: z.string().min(1).max(300),
}).strict();

const ideWebFetchSchema = z.object({
  url: z.string().max(2000).refine(val => {
    try {
      const parsed = new URL(val);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'Geçersiz URL' }),
}).strict();

function isActiveProvider(ACTIVE_PROVIDERS, providerId) {
  if (!ACTIVE_PROVIDERS) return false;
  if (typeof ACTIVE_PROVIDERS.has === 'function') return ACTIVE_PROVIDERS.has(providerId);
  if (Array.isArray(ACTIVE_PROVIDERS)) return ACTIVE_PROVIDERS.includes(providerId);
  return false;
}

function isEligibleIdeEntry({ providerId, catalogEntry, PROVIDERS, ACTIVE_PROVIDERS, env }) {
  if (!catalogEntry) return false;
  const provider = PROVIDERS[providerId];
  if (!provider) return false;
  if (!isActiveProvider(ACTIVE_PROVIDERS, providerId)) return false;
  if (provider.supportsTools === false) return false;
  if (!provider.envKey || !env[provider.envKey]) return false;
  return true;
}

function resolveIdeModels({ PROVIDERS = {}, MODEL_CATALOG = [], ACTIVE_PROVIDERS, env = process.env } = {}) {
  const models = [];
  const seen = new Set();

  if (env.IDE_MODELS !== undefined) {
    const items = String(env.IDE_MODELS).split(',').map(item => item.trim()).filter(Boolean);
    for (const item of items) {
      const colonIndex = item.indexOf(':');
      if (colonIndex <= 0 || colonIndex === item.length - 1) continue;
      const providerId = item.slice(0, colonIndex).trim();
      const modelId = item.slice(colonIndex + 1).trim();
      const key = `${providerId}:${modelId}`;
      if (seen.has(key)) continue;

      const catalogEntry = MODEL_CATALOG.find(m => m.id === modelId && m.provider === providerId);
      if (!isEligibleIdeEntry({ providerId, catalogEntry, PROVIDERS, ACTIVE_PROVIDERS, env })) continue;

      seen.add(key);
      models.push({
        id: catalogEntry.id,
        provider: catalogEntry.provider,
        label: catalogEntry.label || catalogEntry.id,
      });
    }
    return models;
  }

  let defaultModelIndex = -1;
  for (const catalogEntry of MODEL_CATALOG) {
    if (!catalogEntry || catalogEntry.hidden) continue;
    const providerId = catalogEntry.provider;
    const modelId = catalogEntry.id;
    const key = `${providerId}:${modelId}`;
    if (seen.has(key)) continue;
    if (!isEligibleIdeEntry({ providerId, catalogEntry, PROVIDERS, ACTIVE_PROVIDERS, env })) continue;

    seen.add(key);
    if (catalogEntry.isDefault && defaultModelIndex === -1) {
      defaultModelIndex = models.length;
    }
    models.push({
      id: catalogEntry.id,
      provider: catalogEntry.provider,
      label: catalogEntry.label || catalogEntry.id,
    });
  }

  if (defaultModelIndex > 0) {
    const [defaultEntry] = models.splice(defaultModelIndex, 1);
    models.unshift(defaultEntry);
  }

  return models;
}

function stripToolCallExtraContent(messages) {
  return messages.map(msg => {
    if (!Array.isArray(msg.tool_calls)) return msg;
    return {
      ...msg,
      tool_calls: msg.tool_calls.map(({ extra_content, ...rest }) => rest),
    };
  });
}

function registerIdeRoutes(app, {
  enforceDailyQuota = () => (_req, _res, next) => next(),
  PROVIDERS,
  MODEL_CATALOG,
  ACTIVE_PROVIDERS,
  fetch,
  metrics = { track() {} },
  env = process.env,
  toolRegistry = null,
}) {
  app.get('/ide/models', (_req, res) => {
    const models = resolveIdeModels({ PROVIDERS, MODEL_CATALOG, ACTIVE_PROVIDERS, env });
    res.json({
      models,
      default: models[0] ? { id: models[0].id, provider: models[0].provider } : null,
    });
  });

  const rejectIdeJailbreak = (req, res, next) => {
    const parsed = ideCompleteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'IDE isteği geçersiz.' } });
    }

    const rawMessages = parsed.data.messages;
    let lastAssistantIndex = -1;
    for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
      if (rawMessages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    for (let i = 0; i < rawMessages.length; i += 1) {
      const msg = rawMessages[i];
      const isActiveTurnUser = msg.role === 'user' && i > lastAssistantIndex;
      if ((msg.role === 'system' || isActiveTurnUser) && typeof msg.content === 'string') {
        const guard = scanMessage(msg.content, env);
        if (guard.blocked) {
          console.warn('Jailbreak filtresi (ide):', guard.rule);
          return res.status(400).json({
            error: {
              code: 'jailbreak_blocked',
              message: 'Bu mesaj güvenlik filtresine takıldı ve modele iletilmedi. Sorunu farklı şekilde sorabilirsin.',
            },
          });
        }
      }
    }

    // Önceki turlardaki engelli kullanıcı mesajları tool_calls / tool eşleşmesini bozmadan atılır.
    req.ideParsed = parsed.data;
    req.ideMessages = rawMessages.filter((msg, index) => !(
      index < lastAssistantIndex
      && msg.role === 'user'
      && typeof msg.content === 'string'
      && scanMessage(msg.content, env).blocked
    ));
    return next();
  };

  app.post('/ide/complete', rejectIdeJailbreak, (_req, res, next) => {
    res.locals.quotaCancelsOnClose = true;
    next();
  }, enforceDailyQuota('ide'), async (req, res) => {
    const availableModels = resolveIdeModels({ PROVIDERS, MODEL_CATALOG, ACTIVE_PROVIDERS, env });
    if (!availableModels.length) {
      return res.status(503).json({ error: { message: 'IDE modeli şu anda kullanılamıyor.' } });
    }

    const rawMessages = req.ideMessages;
    const { model: requestedModel, provider: requestedProvider, tool_choice, stream } = req.ideParsed;
    const tools = req.ideParsed.tools;

    let selected = null;
    if (!requestedModel && !requestedProvider) {
      selected = availableModels[0];
    } else {
      selected = availableModels.find(m =>
        (!requestedModel || m.id === requestedModel)
        && (!requestedProvider || m.provider === requestedProvider)
      ) || null;
    }

    if (!selected) {
      return res.status(400).json({ error: { message: 'Bu model IDE\'de kullanılamıyor.' } });
    }

    const messages = selected.provider === 'gemini'
      ? rawMessages
      : stripToolCallExtraContent(rawMessages);

    const provider = PROVIDERS[selected.provider];
    const apiKey = env[provider.envKey];

    res.setHeader('X-KocaMind-Provider', selected.provider);
    res.setHeader('X-KocaMind-Model', selected.id);

    const startedAt = Date.now();
    const controller = new AbortController();
    let tracked = false;
    const track = (ok, usage, status) => {
      if (tracked) return;
      tracked = true;
      metrics.track?.({
        uid: req.user?.uid,
        route: 'ide',
        provider: selected.provider,
        model: selected.id,
        ok,
        usage,
        status,
        latencyMs: Date.now() - startedAt,
      });
    };

    res.on('close', () => {
      if (!res.writableFinished) {
        controller.abort();
      }
    });

    const upstreamPayload = provider.nativeResponses
      ? buildIdeResponsesPayload({
        model: selected.id,
        messages,
        tools,
        tool_choice,
        stream,
        provider,
      })
      : {
        model: selected.id,
        messages,
        ...(tools?.length ? { tools, tool_choice } : {}),
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        ...(provider.defaultMaxTokens ? { max_tokens: provider.defaultMaxTokens } : {}),
        ...(provider.defaultTemperature !== undefined ? { temperature: provider.defaultTemperature } : {}),
      };

    try {
      const response = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(provider.extraHeaders || {}),
        },
        body: JSON.stringify(upstreamPayload),
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        track(false, null, 499);
        return;
      }

      if (!response.ok) {
        const upstream = typeof response.json === 'function'
          ? await response.json().catch(() => ({}))
          : {};
        track(false, null, response.status);
        console.error(
          'IDE sağlayıcı hatası:',
          selected.provider,
          selected.id,
          response.status,
          upstream?.error?.message || upstream?.error || '',
        );
        const isAuthError = response.status === 401 || response.status === 403;
        const status = isAuthError
          ? 500
          : response.status === 402 || response.status === 429
            ? response.status
            : 503;
        const message = isAuthError
          ? 'Bu modelin sağlayıcı anahtarı geçersiz ya da hesabı kapalı. Başka bir model seç ya da yöneticiye haber ver.'
          : status === 402
            ? 'Yapay zekâ sağlayıcısının bakiyesi yetersiz. Başka bir model seç ya da yöneticiye haber ver.'
            : status === 429
              ? 'Yapay zekâ servisi şu anda yoğun, biraz sonra tekrar dene.'
              : 'Yapay zekâ servisine şu anda ulaşılamıyor. Biraz sonra tekrar dene.';
        return res.status(status).json({ error: { message } });
      }

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        if (provider.nativeResponses) {
          res.on('close', () => {
            if (!res.writableFinished) {
              response.body.destroy?.();
              track(false, null, 499);
            }
          });
          const result = await pipeIdeResponsesAsChatCompletions(response.body, res);
          if (controller.signal.aborted) {
            track(false, result?.usage || null, 499);
          } else {
            const ok = result?.ok !== false;
            track(ok, result?.usage || null, ok ? 200 : 502);
          }
          return;
        }

        const usageWatcher = watchChatCompletionUsage(response.body);
        response.body.on('end', () => {
          if (controller.signal.aborted) {
            track(false, usageWatcher.usage(), 499);
          } else {
            track(true, usageWatcher.usage(), 200);
          }
        });
        response.body.on('error', () => {
          if (controller.signal.aborted) {
            track(false, usageWatcher.usage(), 499);
          } else {
            track(false, usageWatcher.usage(), 502);
          }
        });
        res.on('close', () => {
          if (!res.writableFinished) {
            response.body.destroy?.();
            track(false, usageWatcher.usage(), 499);
          }
        });
        response.body.pipe(res);
        return;
      }

      const data = await response.json();
      if (controller.signal.aborted) {
        track(false, null, 499);
        return;
      }
      track(true, data?.usage, 200);
      return res.json(provider.nativeResponses ? toIdeChatCompletion(data) : data);
    } catch (e) {
      if (controller.signal.aborted) {
        track(false, null, 499);
        return;
      }
      console.error('IDE vekil hatası:', e.message);
      return res.status(500).json({ error: { message: 'Sunucu hatası' } });
    }
  });

  app.post('/ide/web/search', enforceDailyQuota('ide'), async (req, res) => {
    const parsed = ideWebSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'IDE isteği geçersiz.' } });
    }

    const tool = toolRegistry?.get?.('web_search');
    if (!toolRegistry || !tool) {
      return res.status(503).json({ error: { message: 'Web araçları şu anda kullanılamıyor.' } });
    }

    const startedAt = Date.now();
    try {
      const result = await tool.execute({ query: parsed.data.query }, { userId: req.user?.uid });
      const results = result && result.results !== undefined ? result.results : result;
      metrics.track?.({
        uid: req.user?.uid,
        route: 'ide_web_search',
        ok: true,
        status: 200,
        latencyMs: Date.now() - startedAt,
      });
      return res.json({ results });
    } catch (e) {
      metrics.track?.({
        uid: req.user?.uid,
        route: 'ide_web_search',
        ok: false,
        status: 502,
        latencyMs: Date.now() - startedAt,
      });
      console.error('IDE web search hatası:', e?.message || 'Bilinmeyen hata');
      return res.status(502).json({ error: { message: 'Web isteği başarısız oldu.' } });
    }
  });

  app.post('/ide/web/fetch', enforceDailyQuota('ide'), async (req, res) => {
    const parsed = ideWebFetchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { message: 'IDE isteği geçersiz.' } });
    }

    const tool = toolRegistry?.get?.('scrape_website');
    if (!toolRegistry || !tool) {
      return res.status(503).json({ error: { message: 'Web araçları şu anda kullanılamıyor.' } });
    }

    const startedAt = Date.now();
    try {
      let page = await tool.execute({ url: parsed.data.url }, { userId: req.user?.uid });
      if (typeof page === 'string') {
        if (page.length > 60000) {
          page = { content: page.slice(0, 60000), truncated: true };
        } else {
          page = { content: page, truncated: false };
        }
      } else if (page && typeof page === 'object') {
        if (typeof page.content === 'string' && page.content.length > 60000) {
          page = { ...page, content: page.content.slice(0, 60000), truncated: true };
        }
      }
      metrics.track?.({
        uid: req.user?.uid,
        route: 'ide_web_fetch',
        ok: true,
        status: 200,
        latencyMs: Date.now() - startedAt,
      });
      return res.json({ page });
    } catch (e) {
      metrics.track?.({
        uid: req.user?.uid,
        route: 'ide_web_fetch',
        ok: false,
        status: 502,
        latencyMs: Date.now() - startedAt,
      });
      console.error('IDE web fetch hatası:', e?.message || 'Bilinmeyen hata');
      return res.status(502).json({ error: { message: 'Web isteği başarısız oldu.' } });
    }
  });
}

module.exports = { registerIdeRoutes, resolveIdeModels };
