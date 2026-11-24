/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { agentReducer, initialAgentState } from './reducer.ts';

test('1. send kullanici ogesi ekler ve running olur', () => {
  const state = agentReducer(initialAgentState, { type: 'send', text: 'Merhaba' });
  assert.equal(state.running, true);
  assert.equal(state.turnId, null);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].kind, 'user');
  assert.equal((state.items[0] as { text: string }).text, 'Merhaba');
});

test('2. assistant/delta parcalari tek balonda birlesir; step/start sonrasi yeni balon acilir', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/delta', delta: 'Mer' },
  });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/delta', delta: 'haba' },
  });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].kind, 'assistant');
  assert.equal((state.items[0] as { text: string }).text, 'Merhaba');
  assert.equal((state.items[0] as { streaming: boolean }).streaming, true);

  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'step/start', step: 2 },
  });
  assert.equal((state.items[0] as { streaming: boolean }).streaming, false);

  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/delta', delta: 'Dunya' },
  });
  assert.equal(state.items.length, 2);
  assert.equal((state.items[1] as { text: string }).text, 'Dunya');
  assert.equal((state.items[1] as { streaming: boolean }).streaming, true);
});

test('3. assistant/message akan balonun metnini degistirir ve akisi kapatir; akan balon yokken yeni balon ekler', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/delta', delta: 'taslak' },
  });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/message', content: 'tam metin' },
  });
  assert.equal(state.items.length, 1);
  assert.equal((state.items[0] as { text: string }).text, 'tam metin');
  assert.equal((state.items[0] as { streaming: boolean }).streaming, false);

  // Akan balon yokken
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'assistant/message', content: 'ikinci mesaj' },
  });
  assert.equal(state.items.length, 2);
  assert.equal((state.items[1] as { text: string }).text, 'ikinci mesaj');
  assert.equal((state.items[1] as { streaming: boolean }).streaming, false);
});

test('4. tool/start + tool/result durumu ok / failed yapar ve error\'u JSON\'dan okur', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });

  // ok durumu
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/start',
      callId: 'c1',
      name: 'read_file',
      args: { path: 'a.txt' },
    },
  });
  assert.equal(state.items[0].kind, 'tool');
  assert.equal((state.items[0] as { status: string }).status, 'running');

  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/result',
      callId: 'c1',
      name: 'read_file',
      ok: true,
      content: '{"ok":true,"result":"icerik"}',
    },
  });
  assert.equal((state.items[0] as { status: string }).status, 'ok');

  // failed durumu ve error
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/start',
      callId: 'c2',
      name: 'run_command',
      args: { command: 'ls' },
    },
  });
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/result',
      callId: 'c2',
      name: 'run_command',
      ok: false,
      content: '{"ok":false,"error":"Komut bulunamadi"}',
    },
  });
  const c2 = state.items[1] as { kind: string; status: string; error?: string };
  assert.equal(c2.status, 'failed');
  assert.equal(c2.error, 'Komut bulunamadi');
});

test('5. basarili update_plan sonucu plan\'i gunceller; bozuk JSON\'da plan degismez', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  const validItems = [{ content: 'Adim 1', status: 'completed' as const }];
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/result',
      callId: 'c1',
      name: 'update_plan',
      ok: true,
      content: JSON.stringify({ ok: true, result: { items: validItems } }),
    },
  });
  assert.deepStrictEqual(state.plan, validItems);

  // Bozuk JSON
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'tool/result',
      callId: 'c2',
      name: 'update_plan',
      ok: true,
      content: 'bozuk json{',
    },
  });
  assert.deepStrictEqual(state.plan, validItems);
});

test('6. approval/request + approval/result durumu gunceller', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'approval/request',
      callId: 'a1',
      name: 'edit_file',
      args: { path: 'x.ts' },
      preview: { path: 'x.ts', before: 'a', after: 'b' },
    },
  });
  assert.equal(state.items[0].kind, 'approval');
  assert.equal((state.items[0] as { status: string }).status, 'pending');

  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'approval/result', callId: 'a1', approved: true },
  });
  assert.equal((state.items[0] as { status: string }).status, 'approved');

  // reject testi
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'approval/request',
      callId: 'a2',
      name: 'run_command',
      args: { command: 'rm' },
      preview: null,
    },
  });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'approval/result', callId: 'a2', approved: false },
  });
  assert.equal((state.items[1] as { status: string }).status, 'rejected');
});

test('7. baska turnId\'li olay ve done yok sayilir', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  const stateBefore = state;

  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't2', type: 'assistant/delta', delta: 'yabanci' },
  });
  assert.strictEqual(state, stateBefore);

  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't2', status: 'completed' },
  });
  assert.strictEqual(state, stateBefore);
});

test('8. done aborted: not Durduruldu., bekleyen onay rejected, calisan arac failed', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'event',
    event: { turnId: 't1', type: 'tool/start', callId: 'c1', name: 'run_command', args: {} },
  });
  state = agentReducer(state, {
    type: 'event',
    event: {
      turnId: 't1',
      type: 'approval/request',
      callId: 'a1',
      name: 'write_file',
      args: {},
      preview: null,
    },
  });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't1', status: 'aborted' },
  });

  assert.equal(state.running, false);
  const toolItem = state.items.find(i => i.kind === 'tool') as { status: string };
  assert.equal(toolItem.status, 'failed');
  const appItem = state.items.find(i => i.kind === 'approval') as { status: string };
  assert.equal(appItem.status, 'rejected');
  const noticeItem = state.items.find(i => i.kind === 'notice') as { tone: string; text: string };
  assert.equal(noticeItem.tone, 'info');
  assert.equal(noticeItem.text, 'Durduruldu.');
});

test('9. done failed: hata notu; limitReached uc deger icin dogru not', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't1', status: 'failed', error: 'Ozel hata mesaji' },
  });
  let notice = state.items[state.items.length - 1] as { kind: string; tone: string; text: string };
  assert.equal(notice.tone, 'error');
  assert.equal(notice.text, 'Ozel hata mesaji');

  // limitReached: steps
  state = agentReducer(initialAgentState, { type: 'started', turnId: 't2' });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't2', status: 'completed', limitReached: 'steps' },
  });
  notice = state.items[state.items.length - 1] as { kind: string; tone: string; text: string };
  assert.equal(notice.text, 'Adım sınırına ulaşıldı.');

  // limitReached: tool_calls
  state = agentReducer(initialAgentState, { type: 'started', turnId: 't3' });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't3', status: 'completed', limitReached: 'tool_calls' },
  });
  notice = state.items[state.items.length - 1] as { kind: string; tone: string; text: string };
  assert.equal(notice.text, 'Araç sınırına ulaşıldı.');

  // limitReached: time
  state = agentReducer(initialAgentState, { type: 'started', turnId: 't4' });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't4', status: 'completed', limitReached: 'time' },
  });
  notice = state.items[state.items.length - 1] as { kind: string; tone: string; text: string };
  assert.equal(notice.text, 'Süre sınırına ulaşıldı.');
});

test('10. done completed, balon yokken done.text balon olur', () => {
  let state = agentReducer(initialAgentState, { type: 'started', turnId: 't1' });
  state = agentReducer(state, {
    type: 'done',
    done: { turnId: 't1', status: 'completed', text: 'Cevap metni' },
  });
  const asst = state.items.find(i => i.kind === 'assistant') as { text: string; streaming: boolean };
  assert.ok(asst);
  assert.equal(asst.text, 'Cevap metni');
  assert.equal(asst.streaming, false);
});

test('11. setMode ve reset calisirken etkisiz, dururken etkili', () => {
  // Dururken
  let state = agentReducer(initialAgentState, { type: 'setMode', mode: 'auto-edit' });
  assert.equal(state.mode, 'auto-edit');

  // Calisirken
  state = { ...state, running: true };
  const whileRunning = agentReducer(state, { type: 'setMode', mode: 'read-only' });
  assert.equal(whileRunning.mode, 'auto-edit');

  const whileRunningReset = agentReducer(state, { type: 'reset' });
  assert.equal(whileRunningReset.running, true);

  // Dururken reset: mode korunur, initialAgentState doner
  state = { ...state, running: false, items: [{ kind: 'user', id: 'u1', text: 'hi' }] };
  const resetState = agentReducer(state, { type: 'reset' });
  assert.equal(resetState.items.length, 0);
  assert.equal(resetState.mode, 'auto-edit');
});

test('12. reducer saf: ayni girdi iki kez verilince ayni cikti (derin esitlik) ve girdi durumu degismez', () => {
  const state = Object.freeze({
    items: Object.freeze([{ kind: 'user', id: 'u1', text: 'test' }]) as unknown as typeof initialAgentState.items,
    running: false,
    turnId: 't1',
    plan: Object.freeze([]) as unknown as typeof initialAgentState.plan,
    mode: 'ask' as const,
  });
  const action = Object.freeze({
    type: 'event' as const,
    event: Object.freeze({
      turnId: 't1',
      type: 'assistant/delta' as const,
      delta: 'merhaba',
    }),
  });

  const out1 = agentReducer(state, action);
  const out2 = agentReducer(state, action);

  assert.deepStrictEqual(out1, out2);
  assert.notStrictEqual(out1, state);
  assert.equal(state.items.length, 1);
});

test('13. resumed calismiyorken durumu sifirlar, plani yazar, modu korur ve bilgi notu ekler; calisirken etkisiz', () => {
  const prev = {
    items: [{ kind: 'user' as const, id: 'u1', text: 'eski' }],
    running: false,
    turnId: 't1',
    plan: [],
    mode: 'auto-edit' as const,
  };
  const plan = [{ content: 'Adım 1', status: 'in_progress' as const }];
  const resumed = agentReducer(prev, { type: 'resumed', plan });
  assert.equal(resumed.running, false);
  assert.equal(resumed.turnId, null);
  assert.equal(resumed.mode, 'auto-edit');
  assert.deepStrictEqual(resumed.plan, plan);
  assert.deepStrictEqual(resumed.items, [
    {
      kind: 'notice',
      id: 'notice-0',
      tone: 'info',
      text: 'Önceki oturum açıldı. Kaldığın yerden devam edebilirsin.',
    },
  ]);

  const runningState = { ...prev, running: true };
  const ignored = agentReducer(runningState, { type: 'resumed', plan });
  assert.strictEqual(ignored, runningState);
});

test('14. notice eylemi calisirken de dururken de bilgi veya hata notu ekler', () => {
  const idle = { ...initialAgentState, running: false };
  const out1 = agentReducer(idle, {
    type: 'notice',
    tone: 'info',
    text: 'Son turun değişiklikleri geri alındı: a.ts',
  });
  assert.equal(out1.items.length, 1);
  assert.deepStrictEqual(out1.items[0], {
    kind: 'notice',
    id: 'notice-0',
    tone: 'info',
    text: 'Son turun değişiklikleri geri alındı: a.ts',
  });

  const running = { ...out1, running: true };
  const out2 = agentReducer(running, {
    type: 'notice',
    tone: 'error',
    text: 'Bir sorun oldu',
  });
  assert.equal(out2.items.length, 2);
  assert.equal(out2.running, true);
  assert.deepStrictEqual(out2.items[1], {
    kind: 'notice',
    id: 'notice-1',
    tone: 'error',
    text: 'Bir sorun oldu',
  });
});
