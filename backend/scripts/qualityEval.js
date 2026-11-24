#!/usr/bin/env node
require('dotenv').config();
const { writeFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const items = require('../eval/turkceKaliteSeti.json');
const { runQualityEval, formatReport } = require('../eval/qualityEval');
const { buildOpenAIResponsesPayload, outputTextFromResponse } = require('../openaiResponses');
const { disabledProviders, isDisabledEndpoint } = require('../learning/providerAvailability');

// server.js kataloğunun model ve sağlayıcı eşleşmeleri. CLI backend'i başlatmadan çalışır.
const providers = [
  {
    models: ['deepseek-chat', 'deepseek-reasoner'],
    key: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/v1/chat/completions',
    urlEnv: 'DEEPSEEK_BASE_URL',
    temperature: 0.3,
  },
  {
    models: ['gpt-5.6-luna'],
    key: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/responses',
    api: 'responses',
  },
  {
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
    key: 'GROQ_API_KEY',
    url: 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
    key: 'GEMINI_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  },
  {
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    key: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/messages',
    api: 'messages',
  },
  {
    models: ['grok-3', 'grok-3-mini'],
    key: 'XAI_API_KEY',
    url: 'https://api.x.ai/v1/chat/completions',
  },
  {
    models: ['deepseek-v4.1-flash', 'glm-5.3', 'qwen3.8-flash-next', 'gemma-4-31b', 'mimo-v2.6-pro'],
    key: 'EVREN_LLM_API_KEY',
    url: 'https://evren-llmapi.ssyz.org.tr/v1/chat/completions',
  },
];

function createComplete(models, { env = process.env, fetch = require('node-fetch') } = {}) {
  const configuration = new Map();
  const disabled = disabledProviders(env);
  for (const model of models) {
    const provider = env.EVAL_BASE_URL
      ? { url: env.EVAL_BASE_URL, key: env.EVAL_API_KEY_ENV || 'DEEPSEEK_API_KEY', temperature: 0.3 }
      : providers.find(provider => provider.models.includes(model));
    if (!provider) throw new Error('Katalogda model bulunamadı: ' + model);
    const url = env[provider.urlEnv] || provider.url;
    if (isDisabledEndpoint(disabled, { url, envKey: provider.key })) return null;
    const apiKey = env[provider.key];
    if (!apiKey) throw new Error(model + ' için ' + provider.key + ' tanımlı değil.');
    configuration.set(model, { provider, apiKey, url });
  }

  return async ({ model, system, user }) => {
    const { provider, apiKey, url } = configuration.get(model);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
    let payload;
    if (provider.api === 'responses') {
      payload = buildOpenAIResponsesPayload({ model, systemPrompt: system, history: [], message: user, stream: false, reasoningSummary: false });
    } else if (provider.api === 'messages') {
      delete headers.Authorization;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      payload = { model, system, max_tokens: 4096, messages: [{ role: 'user', content: user }] };
    } else {
      payload = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (provider.temperature !== undefined) payload.temperature = provider.temperature;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      timeout: 120_000,
    });
    if (!response.ok) throw new Error('Model hatası: ' + response.status);
    const data = await response.json();
    if (provider.api === 'responses') return outputTextFromResponse(data);
    if (provider.api === 'messages') {
      return (data.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
    }
    return data.choices?.[0]?.message?.content || '';
  };
}

const USAGE = 'Kullanım: node scripts/qualityEval.js --models model1,model2 --judge model [--kategori matematik] [--limit 10] [--out rapor.md] [--evet]';

async function main(argv = process.argv.slice(2), { complete, log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      models: { type: 'string' },
      judge: { type: 'string' },
      kategori: { type: 'string' },
      limit: { type: 'string' },
      out: { type: 'string' },
      evet: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    log(USAGE);
    return;
  }
  const models = [...new Set((values.models || '').split(',').map(model => model.trim()).filter(Boolean))];
  const judgeModel = values.judge?.trim();
  if (!models.length || !judgeModel) throw new Error(USAGE);

  const filtered = values.kategori ? items.filter(item => item.kategori === values.kategori) : items;
  if (!filtered.length) throw new Error('Bilinmeyen kategori: ' + values.kategori);
  const limit = values.limit === undefined ? filtered.length : Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit pozitif bir tam sayı olmalı.');
  const selected = filtered.slice(0, limit);
  const answerCalls = selected.length * models.length;
  const judgeCalls = selected.filter(item => item.kontrol.tur === 'hakem').length * models.length;
  const completion = values.evet ? (complete || createComplete(judgeCalls ? [...new Set([...models, judgeModel])] : models)) : null;
  if (values.evet && !completion) {
    log('Kalite değerlendirmesi atlandı: model sağlayıcısı kapalı.');
    return;
  }
  log('Tahmini çağrı sayısı ' + (answerCalls + judgeCalls) + ' (' + answerCalls + ' yanıt, en fazla ' + judgeCalls + ' hakem).');
  if (!values.evet) {
    log('Çağrıları başlatmak için --evet ekleyin.');
    return;
  }

  const result = await runQualityEval({
    items: selected,
    models,
    judgeModel,
    complete: completion,
    onProgress: (done, total, { model, id, gecti, neden }) => {
      log(done + '/' + total + ' · ' + model + ' · ' + id + ' · ' + (gecti ? 'geçti' : 'kaldı') + ' · ' + neden);
    },
  });
  const report = formatReport(result);
  if (values.out) {
    writeFileSync(values.out, report, 'utf8');
    log('Rapor yazıldı — ' + values.out);
  } else {
    log(report);
  }
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error('Kalite değerlendirmesi çalışmadı:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, createComplete };
