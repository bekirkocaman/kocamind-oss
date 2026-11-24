/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { isDirty, initialTabsState, tabsReducer, type Tab } from './tabs.ts';

function makeTab(id: string, content = 'abc', savedContent = content): Tab {
  const name = id.split('/').pop() || id;
  return { id, name, content, savedContent, language: 'typescript' };
}

test('1. open yeni sekme acar ve etkinlestirir; ayni dosya tekrar acilinca icerigi degistirmez', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('src/a.ts', 'ilk') });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeId, 'src/a.ts');

  state = tabsReducer(state, { type: 'update', id: 'src/a.ts', content: 'degisti' });
  assert.equal(isDirty(state.tabs[0]), true);

  state = tabsReducer(state, { type: 'open', tab: makeTab('src/b.ts', 'b') });
  assert.equal(state.activeId, 'src/b.ts');

  // a.ts tekrar acilirsa yalnizca etkinlesir, 'degisti' korunur
  state = tabsReducer(state, { type: 'open', tab: makeTab('src/a.ts', 'diskteki') });
  assert.equal(state.tabs.length, 2);
  assert.equal(state.activeId, 'src/a.ts');
  assert.equal(state.tabs[0].content, 'degisti');
});

test('2. activate, update, saved ve isDirty', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('a.ts', '1') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('b.ts', '2') });
  state = tabsReducer(state, { type: 'activate', id: 'a.ts' });
  assert.equal(state.activeId, 'a.ts');

  state = tabsReducer(state, { type: 'update', id: 'a.ts', content: '123' });
  assert.equal(isDirty(state.tabs[0]), true);

  state = tabsReducer(state, { type: 'saved', id: 'a.ts', content: '123' });
  assert.equal(isDirty(state.tabs[0]), false);
});

test('3. close sagindakini, yoksa solundakini secer; son sekme kapaninca null', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('a.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('b.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('c.ts') });
  state = tabsReducer(state, { type: 'activate', id: 'b.ts' });

  // ortadaki (b.ts) kapaninca sagindaki (c.ts) etkin olur
  state = tabsReducer(state, { type: 'close', id: 'b.ts' });
  assert.deepEqual(state.tabs.map(t => t.id), ['a.ts', 'c.ts']);
  assert.equal(state.activeId, 'c.ts');

  // en sagdaki (c.ts) kapaninca solundaki (a.ts) etkin olur
  state = tabsReducer(state, { type: 'close', id: 'c.ts' });
  assert.deepEqual(state.tabs.map(t => t.id), ['a.ts']);
  assert.equal(state.activeId, 'a.ts');

  // son sekme kapaninca activeId null
  state = tabsReducer(state, { type: 'close', id: 'a.ts' });
  assert.equal(state.tabs.length, 0);
  assert.equal(state.activeId, null);
});

test('4. closeAll butun sekmeleri temizler', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('a.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('b.ts') });
  state = tabsReducer(state, { type: 'closeAll' });
  assert.deepEqual(state, initialTabsState);
});

test('5. rename dosya ve klasor altindaki sekmeleri gunceller', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('src/old/a.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('src/old/sub/b.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('src/other.ts') });
  state = tabsReducer(state, { type: 'activate', id: 'src/old/a.ts' });

  state = tabsReducer(state, { type: 'rename', fromPath: 'src/old', toPath: 'src/new' });
  assert.deepEqual(state.tabs.map(t => t.id), ['src/new/a.ts', 'src/new/sub/b.ts', 'src/other.ts']);
  assert.equal(state.activeId, 'src/new/a.ts');

  state = tabsReducer(state, { type: 'rename', fromPath: 'src/other.ts', toPath: 'src/renamed.ts' });
  assert.equal(state.tabs[2].id, 'src/renamed.ts');
  assert.equal(state.tabs[2].name, 'renamed.ts');
});

test('6. removeUnder silinen dosya veya klasor altindaki sekmeleri kapatir', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('src/dir/a.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('src/dir/b.ts') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('keep.ts') });
  state = tabsReducer(state, { type: 'activate', id: 'src/dir/a.ts' });

  state = tabsReducer(state, { type: 'removeUnder', path: 'src/dir' });
  assert.deepEqual(state.tabs.map(t => t.id), ['keep.ts']);
  assert.equal(state.activeId, 'keep.ts');
});

test('7. reload kirli olmayan sekmeyi gunceller, kirli sekmeye dokunmaz', () => {
  let state = tabsReducer(initialTabsState, { type: 'open', tab: makeTab('clean.ts', 'v1') });
  state = tabsReducer(state, { type: 'open', tab: makeTab('dirty.ts', 'v1') });
  state = tabsReducer(state, { type: 'update', id: 'dirty.ts', content: 'edited' });

  state = tabsReducer(state, { type: 'reload', id: 'clean.ts', content: 'v2' });
  state = tabsReducer(state, { type: 'reload', id: 'dirty.ts', content: 'v2' });

  assert.equal(state.tabs[0].content, 'v2');
  assert.equal(state.tabs[0].savedContent, 'v2');
  assert.equal(state.tabs[1].content, 'edited');
  assert.equal(state.tabs[1].savedContent, 'v1');
});
