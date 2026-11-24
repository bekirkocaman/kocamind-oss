/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { pushHistory, navigate } from './history.ts';

test('1. pushHistory bos ve ardisik tekrari eklemez, en yeni sonda', () => {
  let list: string[] = [];
  list = pushHistory(list, '   ');
  assert.deepEqual(list, []);

  list = pushHistory(list, 'npm test');
  list = pushHistory(list, 'npm test');
  assert.deepEqual(list, ['npm test']);

  list = pushHistory(list, 'git status');
  assert.deepEqual(list, ['npm test', 'git status']);

  // ardisik olmayan tekrar eklenebilir
  list = pushHistory(list, 'npm test');
  assert.deepEqual(list, ['npm test', 'git status', 'npm test']);
});

test('2. pushHistory max sinirini uygular', () => {
  let list: string[] = [];
  for (let i = 1; i <= 5; i++) {
    list = pushHistory(list, `cmd-${i}`, 3);
  }
  assert.deepEqual(list, ['cmd-3', 'cmd-4', 'cmd-5']);
});

test('3. navigate yukari ve asagi gecmiste gezer', () => {
  const list = ['a', 'b', 'c'];

  // baslangicta index = -1 (yeni satir)
  const r1 = navigate(list, -1, 'up');
  assert.deepEqual(r1, { index: 2, value: 'c' });

  const r2 = navigate(list, r1.index, 'up');
  assert.deepEqual(r2, { index: 1, value: 'b' });

  const r3 = navigate(list, r2.index, 'up');
  assert.deepEqual(r3, { index: 0, value: 'a' });

  // en ustte kalir
  const r4 = navigate(list, r3.index, 'up');
  assert.deepEqual(r4, { index: 0, value: 'a' });

  // asagi inis
  const r5 = navigate(list, r4.index, 'down');
  assert.deepEqual(r5, { index: 1, value: 'b' });

  const r6 = navigate(list, 2, 'down');
  assert.deepEqual(r6, { index: -1, value: '' });

  // bos liste
  assert.deepEqual(navigate([], -1, 'up'), { index: -1, value: '' });
  assert.deepEqual(navigate([], -1, 'down'), { index: -1, value: '' });
});
