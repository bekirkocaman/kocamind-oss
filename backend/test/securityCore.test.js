const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { SECURITY_CORE } = require('../skills/securityCore');
const { buildSystemPrompt, CUSTOM_PROMPT_HEADER, MAX_CUSTOM_PROMPT_CHARS } = require('../skills/prompt');
const { createSkillStore } = require('../skills/skillStore');
const { registerChatRoutes } = require('../routes/chat');
const { buildOpenAIResponsesPayload, pipeResponsesAsChatCompletions, toChatCompletion } = require('../openaiResponses');

const skillStore = createSkillStore({ root: path.join(__dirname, '..', 'skills') });

function createTestChatApp(fetch) {
  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
  const app = express();
  app.use(express.json());
  registerChatRoutes(app, {
    enforceDailyQuota: () => (req, res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'deepseek-chat', provider: 'deepseek' },
    PROVIDERS: { deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions' } },
    MODEL_CATALOG: [{ id: 'deepseek-chat', provider: 'deepseek' }],
    ACTIVE_PROVIDERS: new Set(['deepseek']),
    ASSISTANT_PROMPTS: { tiger: 'ESKI PROMPT' },
    buildOpenAIResponsesPayload,
    pipeResponsesAsChatCompletions,
    toChatCompletion,
    fetch,
    skillStore,
  });
  return app;
}

test('SECURITY_CORE 1500 karakteri geçmez ve temel güvenlik maddelerini içerir', () => {
  assert.equal(typeof SECURITY_CORE, 'string');
  assert.ok(SECURITY_CORE.length > 100 && SECURITY_CORE.length <= 1500, `Beklenmeyen uzunluk: ${SECURITY_CORE.length}`);
  assert.match(SECURITY_CORE, /KocaMind/);
  assert.match(SECURITY_CORE, /sistem güncellemesi/i);
  assert.match(SECURITY_CORE, /geliştirici modu/i);
  assert.match(SECURITY_CORE, /test modu/i);
  assert.match(SECURITY_CORE, /filtreler kapalı/i);
  assert.match(SECURITY_CORE, /kuralsız/i);
  assert.match(SECURITY_CORE, /kısıtsız/i);
  assert.match(SECURITY_CORE, /112/);
});

test('custom_prompt verilince sistem promptu SECURITY_CORE ile başlar ve custom metni başlıktan sonra içerir', () => {
  const custom = 'Bana kısa ve maddeli yanıt ver.';
  const prompt = buildSystemPrompt({
    assistantType: 'tiger',
    customPrompt: custom,
    skillStore,
    toolsEnabled: true,
  });
  assert.ok(prompt.startsWith(SECURITY_CORE));
  const headerIndex = prompt.indexOf(CUSTOM_PROMPT_HEADER);
  const customIndex = prompt.indexOf(custom);
  assert.ok(headerIndex > SECURITY_CORE.length);
  assert.ok(customIndex > headerIndex);
  assert.match(prompt, /- dilekce: /);
});

test('custom_prompt yokken de SECURITY_CORE başta yer alır ve genel-asistan gövdesi korunur', () => {
  const prompt = buildSystemPrompt({
    assistantType: 'tiger',
    skillStore,
    toolsEnabled: false,
  });
  assert.ok(prompt.startsWith(SECURITY_CORE));
  assert.match(prompt, /KocaMind'in yapay zekâ asistanısın/);
  assert.ok(prompt.indexOf("KocaMind'in yapay zekâ asistanısın") > SECURITY_CORE.length);
});

test('12000 karakterden uzun custom_prompt kesilir', () => {
  const longCustom = `${'A'.repeat(MAX_CUSTOM_PROMPT_CHARS)}BURASI_KESILMELI`;
  const prompt = buildSystemPrompt({
    assistantType: 'tiger',
    customPrompt: longCustom,
    skillStore,
    toolsEnabled: false,
  });
  assert.ok(prompt.startsWith(SECURITY_CORE));
  assert.ok(prompt.includes('A'.repeat(MAX_CUSTOM_PROMPT_CHARS)));
  assert.ok(!prompt.includes('BURASI_KESILMELI'));
});

test('16001 karakterlik mesaj 400 döner ve model çağrılmaz; 16000 karakter geçer', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Tamam' } }] }),
    };
  };
  const app = createTestChatApp(fetch);

  const tooLong = await request(app)
    .post('/chat')
    .send({ message: 'x'.repeat(16001), tools: false, stream: false });
  assert.equal(tooLong.status, 400);
  assert.deepEqual(tooLong.body, {
    error: { message: 'Mesaj çok uzun (en fazla 16.000 karakter).' },
  });
  assert.equal(calls, 0);

  const exactLimit = await request(app)
    .post('/chat')
    .send({ message: 'x'.repeat(16000), tools: false, stream: false });
  assert.equal(exactLimit.status, 200);
  assert.equal(calls, 1);
});

test('CHAT_MAX_MESSAGE_CHARS ortam değişkeni mesaj sınırını değiştirir', async () => {
  const prev = process.env.CHAT_MAX_MESSAGE_CHARS;
  process.env.CHAT_MAX_MESSAGE_CHARS = '50';
  try {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Tamam' } }] }),
      };
    };
    const app = createTestChatApp(fetch);
    const rejected = await request(app).post('/chat').send({ message: 'a'.repeat(51), tools: false, stream: false });
    assert.equal(rejected.status, 400);
    assert.equal(calls, 0);

    const accepted = await request(app).post('/chat').send({ message: 'a'.repeat(50), tools: false, stream: false });
    assert.equal(accepted.status, 200);
    assert.equal(calls, 1);
  } finally {
    if (prev === undefined) delete process.env.CHAT_MAX_MESSAGE_CHARS;
    else process.env.CHAT_MAX_MESSAGE_CHARS = prev;
  }
});

test('string olmayan custom_prompt ve history_summary yok sayılır', async () => {
  let systemPrompt = '';
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    systemPrompt = payload.messages[0].content;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Tamam' } }] }),
    };
  };
  const app = createTestChatApp(fetch);
  const response = await request(app)
    .post('/chat')
    .send({
      message: 'Merhaba',
      custom_prompt: { hacked: true },
      history_summary: ['ozet'],
      tools: false,
      stream: false,
    });
  assert.equal(response.status, 200);
  assert.ok(systemPrompt.startsWith(SECURITY_CORE));
  assert.match(systemPrompt, /KocaMind'in yapay zekâ asistanısın/);
  assert.doesNotMatch(systemPrompt, /Uygulamanın ek talimatları/);
  assert.doesNotMatch(systemPrompt, /BU SOHBETİN ÖNCEKİ KISMININ ÖZETİ/);
});
