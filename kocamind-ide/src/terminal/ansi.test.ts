/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnsi } from './ansi.ts';

test('1. duz metin tek parca doner', () => {
  assert.deepEqual(parseAnsi('merhaba dunya'), [{ text: 'merhaba dunya' }]);
  assert.deepEqual(parseAnsi(''), []);
});

test('2. tek renk ve parlak renkler', () => {
  assert.deepEqual(parseAnsi('\x1b[31mhata\x1b[39m normal'), [
    { text: 'hata', fg: 'red' },
    { text: ' normal' },
  ]);
  assert.deepEqual(parseAnsi('\x1b[92mok'), [{ text: 'ok', fg: 'bright-green' }]);
});

test('3. kalin ve renk birlesimi, 22 kalini kapatir', () => {
  assert.deepEqual(parseAnsi('\x1b[1;34mbaslik\x1b[22m duz'), [
    { text: 'baslik', bold: true, fg: 'blue' },
    { text: ' duz', fg: 'blue' },
  ]);
});

test('4. sifirlama (0 veya bos parametre)', () => {
  assert.deepEqual(parseAnsi('\x1b[1;33maktif\x1b[0m temiz\x1b[35mmor\x1b[m son'), [
    { text: 'aktif', bold: true, fg: 'yellow' },
    { text: ' temiz' },
    { text: 'mor', fg: 'magenta' },
    { text: ' son' },
  ]);
});

test('5. bilinmeyen ESC ve OSC dizileri silinir', () => {
  const input = 'a\x1b[2K\x1b[10;5Hb\x1b]0;baslik\x07c\x1b[2Jd';
  assert.deepEqual(parseAnsi(input), [{ text: 'abcd' }]);
});

test('6. metnin sonunda yarim kalmis ESC dizisi gosterilmez', () => {
  assert.deepEqual(parseAnsi('cikti\x1b'), [{ text: 'cikti' }]);
  assert.deepEqual(parseAnsi('cikti\x1b['), [{ text: 'cikti' }]);
  assert.deepEqual(parseAnsi('cikti\x1b[31'), [{ text: 'cikti' }]);
});
