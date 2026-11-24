'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkspace } = require('../workspace.cjs');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'km-ws-test-'));
}

test('workspace: geçersiz veya olmayan kök klasör hata fırlatır', () => {
  const dir = makeTempDir();
  const missing = path.join(dir, 'olmayan');
  assert.throws(
    () => createWorkspace(missing),
    { message: 'Çalışma alanı bulunamadı.' }
  );

  const file = path.join(dir, 'dosya.txt');
  fs.writeFileSync(file, 'merhaba');
  assert.throws(
    () => createWorkspace(file),
    { message: 'Çalışma alanı bulunamadı.' }
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('workspace: normal göreli yol ve henüz olmayan dosya yolu kabul edilir', () => {
  const dir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    const existingFile = path.join(dir, 'src', 'index.js');
    fs.writeFileSync(existingFile, 'console.log(1);');

    const resolvedExisting = ws.resolve('src/index.js');
    assert.equal(resolvedExisting, path.join(ws.root, 'src', 'index.js'));

    const resolvedNew = ws.resolve('src/yeni/DerinDosya.js');
    assert.equal(resolvedNew, path.join(ws.root, 'src', 'yeni', 'DerinDosya.js'));

    assert.equal(ws.resolve('.'), ws.root);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace: boş veya metin olmayan yol reddedilir', () => {
  const dir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    for (const bad of ['', '   ', null, undefined, 123, {}]) {
      assert.throws(
        () => ws.resolve(bad),
        { message: 'Çalışma alanı dışına erişim engellendi.' }
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace: .. ile kaçış ve kök dışı mutlak yol reddedilir, kök içi mutlak yol kabul edilir', () => {
  const dir = makeTempDir();
  const outsideDir = makeTempDir();
  try {
    const ws = createWorkspace(dir);

    assert.throws(
      () => ws.resolve('../diger'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
    assert.throws(
      () => ws.resolve('a/b/../../../diger'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
    assert.throws(
      () => ws.resolve(outsideDir),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
    assert.throws(
      () => ws.resolve(path.join(outsideDir, 'dosya.txt')),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );

    if (process.platform === 'win32') {
      assert.throws(
        () => ws.resolve('Z:\\baska\\surucu.txt'),
        { message: 'Çalışma alanı dışına erişim engellendi.' }
      );
    }

    const insideAbs = path.join(ws.root, 'alt', 'dosya.txt');
    assert.equal(ws.resolve(insideAbs), insideAbs);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('workspace: sembolik bağ ile kaçış reddedilir', (t) => {
  const dir = makeTempDir();
  const outsideDir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    const linkPath = path.join(dir, 'dis-bag');
    try {
      fs.symlinkSync(outsideDir, linkPath, 'dir');
    } catch (err) {
      t.skip(`Sembolik bağ oluşturulamadı: ${err.message}`);
      return;
    }

    assert.throws(
      () => ws.resolve('dis-bag'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
    assert.throws(
      () => ws.resolve('dis-bag/gizli.txt'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
    assert.throws(
      () => ws.resolve('dis-bag/olmayan-klasor/yeni.txt'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('workspace: toRelative / ayırıcısı kullanır ve kök için . döndürür', () => {
  const dir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    assert.equal(ws.toRelative(ws.root), '.');
    assert.equal(ws.toRelative(path.join(ws.root, 'a', 'b', 'c.js')), 'a/b/c.js');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace: isIgnored yok sayılan klasörleri tanır', () => {
  const dir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    const ignored = [
      'node_modules',
      'node_modules/pkg/index.js',
      'a/node_modules/b',
      '.git/config',
      'dist/bundle.js',
      'build/out.js',
      '.next/cache',
      '.gradle/caches',
      '.idea/workspace.xml',
      '.venv/bin/python',
      'src/__pycache__/mod.pyc',
    ];
    for (const p of ignored) {
      assert.equal(ws.isIgnored(p), true, `${p} yok sayılmalıydı`);
    }

    const allowed = ['src/index.js', 'README.md', 'distro/file.js', 'my-build/a.js'];
    for (const p of allowed) {
      assert.equal(ws.isIgnored(p), false, `${p} yok sayılmamalıydı`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace: adı .. ile başlayan klasör kabul edilir ve toRelative doğru çalışır', () => {
  const dir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    const folder = path.join(dir, '..eski');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'dosya.txt');
    fs.writeFileSync(file, 'deneme');

    const resolved = ws.resolve('..eski/dosya.txt');
    assert.equal(resolved, path.join(ws.root, '..eski', 'dosya.txt'));
    assert.equal(ws.toRelative(resolved), '..eski/dosya.txt');

    assert.throws(
      () => ws.resolve('../disari'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workspace: kırık (dangling) sembolik bağ ile dışarı erişim engellenir', (t) => {
  const dir = makeTempDir();
  const outsideDir = makeTempDir();
  try {
    const ws = createWorkspace(dir);
    const linkPath = path.join(dir, 'kirik-bag.txt');
    const outsideTarget = path.join(outsideDir, 'olmayan-hedef.txt');
    try {
      fs.symlinkSync(outsideTarget, linkPath, 'file');
    } catch (err) {
      t.skip(`Sembolik bağ oluşturulamadı: ${err.message}`);
      return;
    }

    assert.throws(
      () => ws.resolve('kirik-bag.txt'),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
