const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const express = require('express');
const request = require('supertest');

const { readStreamRound } = require('../llm/chatToolLoop');
const { readResponsesStream } = require('../llm/responsesToolLoop');
const { buildOpenAIResponsesPayload, pipeResponsesAsChatCompletions, toChatCompletion } = require('../openaiResponses');
const { pipeIdeResponsesAsChatCompletions } = require('../ideResponses');
const { registerChatRoutes, watchChatCompletionUsage } = require('../routes/chat');

const SAMPLE_TEXT = 'anlık ş ğ ü';

function splitMidChar(str, char = 'ı') {
  const buf = Buffer.from(str, 'utf8');
  const charBuf = Buffer.from(char, 'utf8');
  const idx = buf.indexOf(charBuf);
  assert.ok(idx >= 0 && charBuf.length >= 2, 'Bölünecek çok baytlı harf bulunamadı');
  return [buf.subarray(0, idx + 1), buf.subarray(idx + 1)];
}

function createFakeSseRes() {
  const chunks = [];
  return {
    chunks,
    write(data) { chunks.push(String(data)); },
    end() {},
    text() { return chunks.join(''); },
    deltaContent() {
      return chunks
        .join('')
        .split(/\r?\n/)
        .filter(line => line.startsWith('data: {'))
        .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '')
        .join('');
    },
  };
}

test('1. chatToolLoop.readStreamRound: bölünen çok baytlı UTF-8 harfleri bozmaz', async () => {
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: SAMPLE_TEXT, reasoning_content: SAMPLE_TEXT } }] })}\n\ndata: [DONE]\n\n`;
  const [part1, part2] = splitMidChar(sse, 'ı');

  let streamedContent = '';
  let streamedReasoning = '';
  const result = await readStreamRound(Readable.from([part1, part2]), {
    onContent: c => { streamedContent += c; },
    onReasoning: r => { streamedReasoning += r; },
  });

  assert.equal(result.content.includes('\uFFFD'), false);
  assert.equal(result.content, SAMPLE_TEXT);
  assert.equal(streamedContent, SAMPLE_TEXT);
  assert.equal(result.reasoning, SAMPLE_TEXT);
  assert.equal(streamedReasoning, SAMPLE_TEXT);
});

test('2. responsesToolLoop.readResponsesStream: bölünen çok baytlı UTF-8 harfleri bozmaz', async () => {
  const sse = [
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: SAMPLE_TEXT })}`,
    `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed' } })}`,
    '',
  ].join('\n\n');
  const [part1, part2] = splitMidChar(sse, 'ı');

  let streamedText = '';
  const result = await readResponsesStream(Readable.from([part1, part2]), {
    onText: t => { streamedText += t; },
    onReasoning: () => {},
  });

  assert.equal(result.failure, null);
  assert.equal(streamedText.includes('\uFFFD'), false);
  assert.equal(streamedText, SAMPLE_TEXT);
});

test('3. openaiResponses.pipeResponsesAsChatCompletions: bölünen çok baytlı UTF-8 harfleri bozmaz', async () => {
  const sse = [
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: SAMPLE_TEXT })}`,
    `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed' } })}`,
    '',
  ].join('\n\n');
  const [part1, part2] = splitMidChar(sse, 'ş');

  const res = createFakeSseRes();
  const result = await pipeResponsesAsChatCompletions(Readable.from([part1, part2]), res);

  assert.equal(result.ok, true);
  const content = res.deltaContent();
  assert.equal(content.includes('\uFFFD'), false);
  assert.equal(content, SAMPLE_TEXT);
});

test('4. ideResponses.pipeIdeResponsesAsChatCompletions: bölünen çok baytlı UTF-8 harfleri bozmaz', async () => {
  const sse = [
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: SAMPLE_TEXT })}`,
    `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } })}`,
    '',
  ].join('\n\n');
  const [part1, part2] = splitMidChar(sse, 'ğ');

  const res = createFakeSseRes();
  const result = await pipeIdeResponsesAsChatCompletions(Readable.from([part1, part2]), res);

  assert.equal(result.ok, true);
  const content = res.deltaContent();
  assert.equal(content.includes('\uFFFD'), false);
  assert.equal(content, SAMPLE_TEXT);
});

test('5. routes/chat.js (watchChatCompletionUsage ve /chat akışı): bölünen çok baytlı UTF-8 harfleri bozmaz', async () => {
  const sse = `data: ${JSON.stringify({
    choices: [{ delta: { content: SAMPLE_TEXT } }],
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9, note: SAMPLE_TEXT },
  })}\n\ndata: [DONE]\n\n`;
  const [part1, part2] = splitMidChar(sse, 'ı');

  const directStream = Readable.from([part1, part2]);
  const watcher = watchChatCompletionUsage(directStream);
  for await (const _ of directStream) { /* akışı tüket */ }
  assert.equal(watcher.usage().note.includes('\uFFFD'), false);
  assert.equal(watcher.usage().note, SAMPLE_TEXT);
  assert.equal(watcher.usage().total_tokens, 9);

  process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'test-key';
  const tracked = [];
  const server = express();
  server.use(express.json());
  registerChatRoutes(server, {
    enforceDailyQuota: () => (req, res, next) => next(),
    hasActivePlus: async () => false,
    DEFAULT_MODEL: { id: 'deepseek-chat', provider: 'deepseek' },
    PROVIDERS: {
      deepseek: { name: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://deepseek.test/v1/chat/completions' },
    },
    MODEL_CATALOG: [{ id: 'deepseek-chat', provider: 'deepseek' }],
    ACTIVE_PROVIDERS: new Set(['deepseek']),
    ASSISTANT_PROMPTS: { tiger: 'Türkçe cevap ver.' },
    buildOpenAIResponsesPayload,
    pipeResponsesAsChatCompletions,
    toChatCompletion,
    fetch: async () => ({
      ok: true,
      status: 200,
      body: Readable.from([part1, part2]),
    }),
    metrics: { track: item => tracked.push(item) },
    now: () => new Date('2026-10-12T12:00:00Z'),
  });

  const response = await request(server)
    .post('/chat')
    .send({ message: 'merhaba', provider: 'deepseek', model: 'deepseek-chat', stream: true, tools: false });

  assert.equal(response.status, 200);
  const streamedContent = response.text
    .split(/\r?\n/)
    .filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '')
    .join('');
  assert.equal(streamedContent.includes('\uFFFD'), false);
  assert.equal(streamedContent, SAMPLE_TEXT);
  assert.equal(tracked[0]?.usage?.note, SAMPLE_TEXT);
});
