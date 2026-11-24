/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { fuzzyFilter } from './fuzzy.ts';

test('1. bos sorgu alfabetik ve limit sinirli doner', () => {
  const files = ['z.ts', 'a.ts', 'm.ts', 'b.ts'];
  assert.deepEqual(fuzzyFilter(files, '', 3), ['a.ts', 'b.ts', 'm.ts']);
  assert.deepEqual(fuzzyFilter(files, '   ', 2), ['a.ts', 'b.ts']);
});

test('2. dosya adindaki eslesme yoldaki eslesmeden once gelir', () => {
  const files = ['src/app/index.ts', 'src/my_app.ts'];
  const res = fuzzyFilter(files, 'app');
  assert.equal(res[0], 'src/my_app.ts');
});

test('3. ardisik ve kelime basi eslesmeleri daha yuksek puan alir, esitlikte kisa yol once', () => {
  const files = ['src/foobar.ts', 'src/foo_bar.ts'];
  const res = fuzzyFilter(files, 'fb');
  assert.equal(res[0], 'src/foo_bar.ts');

  const tieFiles = ['src/nested/test.ts', 'test.ts'];
  const tieRes = fuzzyFilter(tieFiles, 'test');
  assert.equal(tieRes[0], 'test.ts');
});

test('4. buyuk kucuk harf duyarsiz ve eslesmeyen elenir', () => {
  const files = ['src/QuickOpen.tsx', 'src/App.tsx', 'README.md'];
  assert.deepEqual(fuzzyFilter(files, 'qo'), ['src/QuickOpen.tsx']);
  assert.deepEqual(fuzzyFilter(files, 'xyz'), []);
});

test('5. limit parametresi sonuc sayisini sinirlar', () => {
  const files = Array.from({ length: 20 }, (_, i) => `file_${i}.ts`);
  assert.equal(fuzzyFilter(files, 'file', 5).length, 5);
});
