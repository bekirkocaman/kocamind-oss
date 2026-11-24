const { z } = require('zod');

const RISK_LEVELS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

// OpenAI strict şemalarında isteğe bağlı alan `type: ['x', 'null']` + required ile yazılır.
// Bazı /chat/completions sağlayıcıları birleşik tipi reddeder; onlara tek tip ve
// isteğe bağlı alan olarak gönderilir.
function relaxNullableTypes(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = { ...schema };
  const nullable = new Set();
  if (result.properties && typeof result.properties === 'object') {
    result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, value]) => {
      const relaxed = relaxNullableTypes(value);
      if (Array.isArray(value?.type) && value.type.includes('null')) {
        const types = value.type.filter(type => type !== 'null');
        relaxed.type = types.length === 1 ? types[0] : types;
        nullable.add(key);
      }
      return [key, relaxed];
    }));
  }
  if (Array.isArray(result.required)) result.required = result.required.filter(key => !nullable.has(key));
  if (result.items) result.items = relaxNullableTypes(result.items);
  return result;
}

function normalizeTool(definition) {
  if (!definition?.name || typeof definition.execute !== 'function') {
    throw new Error('Araç adı ve execute fonksiyonu zorunludur.');
  }
  const tool = {
    riskLevel: RISK_LEVELS.LOW,
    requiresConfirmation: false,
    timeoutMs: 15000,
    retries: 0,
    enabled: () => true,
    ...definition,
  };
  // Onay isteyen bir araç, onay ekranı olmayan sohbet için kendi onay adımını taşıyan
  // bir varyant verebilir (ör. install_skill: önizle → kullanıcı yeni mesajla onaylar).
  if (definition.chatVariant) {
    tool.chatVariant = normalizeTool({
      riskLevel: tool.riskLevel,
      timeoutMs: tool.timeoutMs,
      enabled: tool.enabled,
      ...definition.chatVariant,
      name: tool.name,
      requiresConfirmation: false,
    });
  }
  return tool;
}

// Sohbette çalışacak tanım: onay isteyen araç yalnızca sohbet varyantı varsa verilir.
function chatToolFor(tool) {
  if (!tool) return null;
  if (!tool.requiresConfirmation) return tool;
  return tool.chatVariant || null;
}

// Kullanıcıya özel araçlar (ör. bağlı Notion hesabının araçları) ortak depoya
// yazılmaz; her istekte `context.extraTools` olarak verilir.
function prepareExtraTools(definitions = []) {
  const tools = new Map();
  for (const definition of definitions) {
    const tool = normalizeTool(definition);
    if (!tools.has(tool.name)) tools.set(tool.name, tool);
  }
  return tools;
}

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition) {
    const tool = normalizeTool(definition);
    if (this.tools.has(tool.name)) {
      throw new Error(`Araç zaten kayıtlı: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  // Ortak araç her zaman önceliklidir; ek araç ortak bir aracın adını ezemez.
  get(name, context = {}) {
    return this.tools.get(name) || context?.extraTools?.get?.(name);
  }

  list(context = {}, requestedNames) {
    const allow = Array.isArray(requestedNames) && requestedNames.length
      ? new Set(requestedNames)
      : null;
    const extras = context?.extraTools instanceof Map
      ? [...context.extraTools.values()].filter(tool => !this.tools.has(tool.name))
      : [];
    return [...this.tools.values(), ...extras].filter(tool =>
      (!allow || allow.has(tool.name)) && tool.enabled(context)
    );
  }

  toOpenAITools(context = {}, requestedNames) {
    return this.list(context, requestedNames).map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
      // Dış (MCP) araç şemaları OpenAI strict kurallarına uymayabilir.
      strict: tool.strict !== false,
    }));
  }

  // OpenAI uyumlu /chat/completions formatı (DeepSeek, Groq, Gemini, xAI ...).
  // Sohbette onay ekranı olmadığı için onay isteyen araçlar yalnızca sohbet varyantıyla verilir.
  toChatCompletionsTools(context = {}, requestedNames) {
    return this.list(context, requestedNames)
      .map(chatToolFor)
      .filter(Boolean)
      .map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: relaxNullableTypes(tool.jsonSchema),
        },
      }));
  }

  validate(name, rawArguments, context = {}, tool = this.get(name, context)) {
    if (!tool) throw new Error(`Bilinmeyen araç: ${name}`);
    const parsed = typeof rawArguments === 'string'
      ? JSON.parse(rawArguments || '{}')
      : (rawArguments || {});
    return tool.inputSchema.parse(parsed);
  }
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

async function executeWithRetry(tool, args, context, { timeoutMs = tool.timeoutMs, delayMs = 300 } = {}) {
  const maxRetries = tool.requiresConfirmation === true ? 0 : Math.max(0, Number(tool.retries) || 0);
  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${tool.name} zaman aşımına uğradı.`));
    }, timeoutMs);
  });
  timeoutPromise.catch(() => {});

  const runAttempts = async () => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (timedOut) break;
      try {
        return await Promise.resolve(tool.execute(args, context));
      } catch (error) {
        lastError = error;
        if (timedOut || attempt >= maxRetries) break;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  };

  try {
    return await Promise.race([runAttempts(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ToolRegistry, RISK_LEVELS, objectSchema, prepareExtraTools, chatToolFor, executeWithRetry, z };
