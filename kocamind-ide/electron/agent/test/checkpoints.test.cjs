'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkspace } = require('../workspace.cjs');
const { createCheckpoints } = require('../checkpoints.cjs');

function makeEnv() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-cp-ws-'));
  const cpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-cp-store-'));
  const workspace = createWorkspace(rootDir);
  return {
    rootDir,
    cpDir,
    workspace,
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
      fs.rmSync(cpDir, { recursive: true, force: true });
    },
  };
}

test('checkpoints: gecersiz kimlik reddi', () => {
  const env = makeEnv();
  try {
    assert.throws(
      () => createCheckpoints({ dir: env.cpDir, sessionId: '../gecersiz' }),
      { message: /Geçersiz oturum kimliği/ }
    );
    assert.throws(
      () => createCheckpoints({ dir: env.cpDir, sessionId: '' }),
      { message: /Geçersiz oturum kimliği/ }
    );
    assert.throws(
      () => createCheckpoints({ dir: env.cpDir, sessionId: 'a'.repeat(101) }),
      { message: /Geçersiz oturum kimliği/ }
    );

    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 'gecerli_id-1' });
    assert.throws(
      () => cp.begin('turn/1'),
      { message: /Geçersiz tur kimliği/ }
    );
    assert.throws(
      () => cp.begin(''),
      { message: /Geçersiz tur kimliği/ }
    );
    assert.throws(
      () => cp.begin('x'.repeat(101)),
      { message: /Geçersiz tur kimliği/ }
    );
  } finally {
    env.cleanup();
  }
});

test('checkpoints: tur yokken hata', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    assert.throws(
      () => cp.revertLast(env.workspace),
      { message: 'Geri alınacak değişiklik yok.' }
    );
  } finally {
    env.cleanup();
  }
});

test('checkpoints: kayit ve geri alma (degisen dosya eski haline doner, yeni olusan dosya silinir)', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const fileMevcut = path.join(env.rootDir, 'mevcut.txt');
    const fileYeni = path.join(env.rootDir, 'yeni.txt');

    fs.writeFileSync(fileMevcut, 'ilk hali', 'utf8');

    cp.begin('turn-1');
    const rec1 = cp.record(fileMevcut, 'mevcut.txt');
    assert.equal(rec1, true);

    // Dosyayı değiştir
    fs.writeFileSync(fileMevcut, 'degismis hali', 'utf8');

    // Yeni dosya henüz yokken kaydet
    const rec2 = cp.record(fileYeni, 'yeni.txt');
    assert.equal(rec2, true);

    // Yeni dosyayı oluştur
    fs.writeFileSync(fileYeni, 'yeni olusan icerik', 'utf8');

    // Geri al
    const res = cp.revertLast(env.workspace);
    assert.equal(res.turnId, 'turn-1');
    assert.deepEqual(res.restored, ['mevcut.txt', 'yeni.txt']);

    // mevcut.txt eski haline döndü mü?
    assert.equal(fs.readFileSync(fileMevcut, 'utf8'), 'ilk hali');
    // yeni.txt silindi mi?
    assert.equal(fs.existsSync(fileYeni), false);

    // Tur klasörü silinmiş olmalı
    const turnDir = path.join(env.cpDir, 's1', 'turn-1');
    assert.equal(fs.existsSync(turnDir), false);

    // Başka tur kalmadı
    assert.throws(
      () => cp.revertLast(env.workspace),
      { message: 'Geri alınacak değişiklik yok.' }
    );
  } finally {
    env.cleanup();
  }
});

test('checkpoints: ayni dosya iki kez kaydedilince ilk hal korunur', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const filePath = path.join(env.rootDir, 'deneme.txt');
    fs.writeFileSync(filePath, 'surum 1', 'utf8');

    cp.begin('turn-1');
    cp.record(filePath, 'deneme.txt');

    // Değiştir ve tekrar record çağır
    fs.writeFileSync(filePath, 'surum 2', 'utf8');
    cp.record(filePath, 'deneme.txt');

    fs.writeFileSync(filePath, 'surum 3', 'utf8');

    cp.revertLast(env.workspace);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'surum 1');
  } finally {
    env.cleanup();
  }
});

test('checkpoints: 2 MB ustu kaydedilmez', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const bigPath = path.join(env.rootDir, 'buyuk.bin');
    // 2 MB + 1 byte
    fs.writeFileSync(bigPath, Buffer.alloc(2 * 1024 * 1024 + 1, 65));

    cp.begin('turn-1');
    const res = cp.record(bigPath, 'buyuk.bin');
    assert.equal(res, false);
  } finally {
    env.cleanup();
  }
});

test('checkpoints: list sirasi ve begin cagrilmadiysa islemsiz kalma', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const filePath = path.join(env.rootDir, 'a.txt');
    fs.writeFileSync(filePath, 'a', 'utf8');

    // begin çağrılmadan record hiçbir şey yapmaz
    const noopRes = cp.record(filePath, 'a.txt');
    assert.equal(noopRes, false);

    cp.begin('turn-1');
    cp.record(filePath, 'a.txt');

    cp.begin('turn-2');
    fs.writeFileSync(filePath, 'b', 'utf8');
    cp.record(filePath, 'a.txt');

    const list = cp.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].turnId, 'turn-2');
    assert.equal(list[1].turnId, 'turn-1');
    assert.deepEqual(list[0].files, ['a.txt']);
  } finally {
    env.cleanup();
  }
});

test('checkpoints: calisma alani disi yol reddi', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    cp.begin('turn-1');

    // Manifest ve sıra dosyasını doğrudan manipüle ederek çalışma alanı dışı yol yerleştir
    const turnDir = path.join(env.cpDir, 's1', 'turn-1');
    fs.mkdirSync(turnDir, { recursive: true });
    const entryPath = path.join(turnDir, '1.json');
    fs.writeFileSync(
      entryPath,
      JSON.stringify({ relPath: '../disari.txt', existed: true, content: 'zararlı' }),
      'utf8'
    );
    const manifestPath = path.join(turnDir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ turnId: 'turn-1', at: new Date().toISOString(), files: ['../disari.txt'] }),
      'utf8'
    );

    assert.throws(
      () => cp.revertLast(env.workspace),
      { message: /Çalışma alanı dışına erişim engellendi/ }
    );
  } finally {
    env.cleanup();
  }
});

test('checkpoints: begin diske bos manifest yazmaz, ilk recordta olusur', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    cp.begin('turn-1');
    const turnDir = path.join(env.cpDir, 's1', 'turn-1');
    assert.equal(fs.existsSync(turnDir), false, 'begin hemen klasor/manifest yazmamali');

    const file = path.join(env.rootDir, 'deneme.txt');
    fs.writeFileSync(file, 'icerik');
    cp.record(file, 'deneme.txt');

    assert.equal(fs.existsSync(turnDir), true);
    assert.equal(fs.existsSync(path.join(turnDir, 'manifest.json')), true);
  } finally {
    env.cleanup();
  }
});

test('checkpoints: revertLast dosya kaydi bos olan turlari atlar ve dosya degistiren turu geri alir', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const file = path.join(env.rootDir, 'a.txt');
    fs.writeFileSync(file, 'ilk hali', 'utf8');

    // Tur 1: dosyayı kaydet ve değiştir
    cp.begin('turn-1');
    cp.record(file, 'a.txt');
    fs.writeFileSync(file, 'degisen hali', 'utf8');

    // Tur 2: dosya değiştirmeyen tur (ör. boş manifest diske yazılmış olsun)
    const turn2Dir = path.join(env.cpDir, 's1', 'turn-2');
    fs.mkdirSync(turn2Dir, { recursive: true });
    fs.writeFileSync(
      path.join(turn2Dir, 'manifest.json'),
      JSON.stringify({ turnId: 'turn-2', at: new Date(Date.now() + 1000).toISOString(), files: [] }),
      'utf8'
    );

    // revertLast boş turn-2'yi atlayıp turn-1'i geri almalı
    const res = cp.revertLast(env.workspace);
    assert.equal(res.turnId, 'turn-1');
    assert.deepEqual(res.restored, ['a.txt']);
    assert.equal(fs.readFileSync(file, 'utf8'), 'ilk hali');
  } finally {
    env.cleanup();
  }
});

test('checkpoints: revertLast kısmi hata durumunda hiçbir dosyayı değiştirmeden hata fırlatır ve tur kaydı korunur', () => {
  const env = makeEnv();
  try {
    const cp = createCheckpoints({ dir: env.cpDir, sessionId: 's1' });
    const file1 = path.join(env.rootDir, 'f1.txt');
    const file2 = path.join(env.rootDir, 'f2.txt');

    fs.writeFileSync(file1, 'f1-orijinal', 'utf8');
    fs.writeFileSync(file2, 'f2-orijinal', 'utf8');

    cp.begin('turn-1');
    cp.record(file1, 'f1.txt');
    cp.record(file2, 'f2.txt');

    fs.writeFileSync(file1, 'f1-degismis', 'utf8');
    fs.writeFileSync(file2, 'f2-degismis', 'utf8');

    // f1.txt (sıra 1) yerine bir klasör açalım.
    // Geri alma ters sırada (2.json, sonra 1.json) çalıştığı için f2.txt geri alınır,
    // ardından f1.txt hata verir ve f2.txt kısmi geri alınmış olarak kalır.
    fs.unlinkSync(file1);
    fs.mkdirSync(file1);

    assert.throws(() => cp.revertLast(env.workspace));

    // f2.txt değişmemiş olmalı (kısmi geri alma engellendi, orijinal haline dönmemeli)
    assert.equal(fs.readFileSync(file2, 'utf8'), 'f2-degismis');

    // Tur kaydı silinmemiş olmalı
    const turnDir = path.join(env.cpDir, 's1', 'turn-1');
    assert.equal(fs.existsSync(turnDir), true);
  } finally {
    env.cleanup();
  }
});
