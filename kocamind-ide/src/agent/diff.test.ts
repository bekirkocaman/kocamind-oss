/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseContext, diffLines } from './diff.ts';

test('yeni dosya (hepsi add)', () => {
  const res = diffLines(null, 'satir1\nsatir2\nsatir3');
  assert.equal(res.tooLarge, false);
  assert.equal(res.lines.length, 3);
  assert.ok(res.lines.every(l => l.type === 'add'));
  assert.equal(res.lines[0].oldNo, null);
  assert.equal(res.lines[0].newNo, 1);
  assert.equal(res.lines[1].newNo, 2);
  assert.equal(res.lines[2].newNo, 3);
});

test('tek satir degisikligi (del + add, satir numaralari dogru)', () => {
  const before = 'satir1\nsatir2\nsatir3';
  const after = 'satir1\nsatirYENI\nsatir3';
  const res = diffLines(before, after);

  assert.equal(res.tooLarge, false);
  assert.equal(res.lines.length, 4);

  // satir1
  assert.equal(res.lines[0].type, 'same');
  assert.equal(res.lines[0].oldNo, 1);
  assert.equal(res.lines[0].newNo, 1);

  // del satir2
  assert.equal(res.lines[1].type, 'del');
  assert.equal(res.lines[1].text, 'satir2');
  assert.equal(res.lines[1].oldNo, 2);
  assert.equal(res.lines[1].newNo, null);

  // add satirYENI
  assert.equal(res.lines[2].type, 'add');
  assert.equal(res.lines[2].text, 'satirYENI');
  assert.equal(res.lines[2].oldNo, null);
  assert.equal(res.lines[2].newNo, 2);

  // satir3
  assert.equal(res.lines[3].type, 'same');
  assert.equal(res.lines[3].oldNo, 3);
  assert.equal(res.lines[3].newNo, 3);
});

test('CRLF/LF farki fark sayilmaz', () => {
  const before = 'satir1\r\nsatir2\r\nsatir3';
  const after = 'satir1\nsatir2\nsatir3';
  const res = diffLines(before, after);

  assert.equal(res.tooLarge, false);
  assert.ok(res.lines.length > 0);
  assert.ok(res.lines.every(l => l.type === 'same'));
});

test('2000 satir ustu tooLarge', () => {
  const big = new Array(2005).fill('satir').join('\n');
  const res1 = diffLines(null, big);
  assert.equal(res1.tooLarge, true);
  assert.equal(res1.lines.length, 0);

  const res2 = diffLines(big, 'tek satir');
  assert.equal(res2.tooLarge, true);
  assert.equal(res2.lines.length, 0);

  const res3 = diffLines('tek satir', big);
  assert.equal(res3.tooLarge, true);
  assert.equal(res3.lines.length, 0);
});

test('collapseContext skip uretir ve baglam satirlarini korur', () => {
  // 10 satir ayni, 1 satir degisik, 10 satir ayni
  const beforeLines = Array.from({ length: 20 }, (_, i) => `satir ${i + 1}`);
  const afterLines = [...beforeLines];
  afterLines[10] = 'degisen satir';

  const { lines } = diffLines(beforeLines.join('\n'), afterLines.join('\n'));
  const collapsed = collapseContext(lines, 3);

  // Ilk 7 satir atlanmali (skip: 7), sonra index 7..9 (3 baglam satiri), del+add, 3 baglam satiri, skip: 6
  const skips = collapsed.filter(c => c.type === 'skip');
  assert.ok(skips.length >= 1);
  assert.equal(skips[0].type, 'skip');
  assert.equal((skips[0] as { count: number }).count, 7);

  // Eklenen / silinen satir gosterilmeli
  assert.ok(collapsed.some(c => c.type === 'del' && c.text === 'satir 11'));
  assert.ok(collapsed.some(c => c.type === 'add' && c.text === 'degisen satir'));
});

test('ayni icerik hic add/del uretmez', () => {
  const content = 'fonksiyon() {\n  return 42;\n}';
  const res = diffLines(content, content);
  assert.equal(res.tooLarge, false);
  assert.ok(res.lines.length > 0);
  assert.ok(!res.lines.some(l => l.type === 'add' || l.type === 'del'));
  assert.ok(res.lines.every(l => l.type === 'same'));
});
