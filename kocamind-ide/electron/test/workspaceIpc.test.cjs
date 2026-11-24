// electron/test/workspaceIpc.test.cjs
// KocaMind IDE workspaceIpc birim testleri

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  registerWorkspaceIpc,
  buildTree,
  resolveInside,
  _setCurrentRoot,
} = require('../workspaceIpc.cjs');

function createMockIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
    invoke(channel, ...args) {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`Handler bulunamadı: ${channel}`);
      return fn({}, ...args);
    },
  };
}

test('1. buildTree klasorleri once siralar, node_modules ve .git icine girmez, yollar / kullanir', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test1-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.mkdirSync(path.join(tempDir, 'assets'));
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.mkdirSync(path.join(tempDir, '.git'));

    fs.writeFileSync(path.join(tempDir, 'src', 'b.txt'), 'b');
    fs.writeFileSync(path.join(tempDir, 'src', 'a.txt'), 'a');
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'dep.js'), 'dep');
    fs.writeFileSync(path.join(tempDir, '.git', 'config'), 'git');
    fs.writeFileSync(path.join(tempDir, 'z.txt'), 'z');
    fs.writeFileSync(path.join(tempDir, 'index.js'), 'idx');

    const result = buildTree(tempDir);
    assert.equal(result.truncated, false);

    const topNames = result.nodes.map(n => n.name);
    assert.deepEqual(topNames, ['assets', 'src', 'index.js', 'z.txt']);
    assert.equal(result.nodes.find(n => n.name === 'node_modules'), undefined);
    assert.equal(result.nodes.find(n => n.name === '.git'), undefined);

    const srcNode = result.nodes.find(n => n.name === 'src');
    assert.ok(srcNode && srcNode.children);
    assert.deepEqual(srcNode.children.map(c => c.name), ['a.txt', 'b.txt']);
    assert.equal(srcNode.children[0].path, 'src/a.txt');
    assert.equal(srcNode.children[1].path, 'src/b.txt');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('2. buildTree 5000 siniri: daha kucuk bir sinirla test edilir, sinir asilinca truncated: true', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test2-'));
  try {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(tempDir, `file_${i}.txt`), `content ${i}`);
    }

    const truncatedRes = buildTree(tempDir, { maxNodes: 2 });
    assert.equal(truncatedRes.truncated, true);
    assert.equal(truncatedRes.nodes.length, 2);

    const fullRes = buildTree(tempDir, { maxNodes: 10 });
    assert.equal(fullRes.truncated, false);
    assert.equal(fullRes.nodes.length, 5);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('3. resolveInside .., mutlak yol ve bos degeri reddeder; normal yolu kabul eder', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test3-'));
  const canonicalRoot = fs.realpathSync(tempDir);
  try {
    assert.throws(() => resolveInside(tempDir, '..'), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, '../foo'), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, ''), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, '   '), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, null), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, '/etc/passwd'), /Çalışma alanı dışına erişim engellendi\./);
    assert.throws(() => resolveInside(tempDir, 'C:\\test\\file.txt'), /Çalışma alanı dışına erişim engellendi\./);

    const normal = resolveInside(tempDir, 'src/index.js');
    assert.equal(normal, path.resolve(canonicalRoot, 'src/index.js'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('4. workspace:open iptalde null, secimde root, name, nodes doner', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test4-'));
  const mockIpc = createMockIpcMain();
  let selectedPaths = null;
  let canceled = true;

  const mockDialog = {
    showOpenDialog: async () => ({ canceled, filePaths: selectedPaths }),
  };

  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: mockDialog, getWindow: () => null });

  try {
    // İptal durumu
    const cancelRes = await mockIpc.invoke('workspace:open');
    assert.equal(cancelRes, null);

    // Seçim durumu
    fs.writeFileSync(path.join(tempDir, 'hello.txt'), 'merhaba');
    canceled = false;
    selectedPaths = [tempDir];

    const openRes = await mockIpc.invoke('workspace:open');
    assert.ok(openRes);
    assert.equal(openRes.root, fs.realpathSync(tempDir));
    assert.equal(openRes.name, path.basename(tempDir));
    assert.ok(Array.isArray(openRes.nodes));
    assert.equal(openRes.truncated, false);
    assert.equal(openRes.nodes.length, 1);
    assert.equal(openRes.nodes[0].name, 'hello.txt');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('5. workspace:readFile icerigi dondurur; klasor acilmadan once hata; ikili dosya, buyuk dosya ve disari yol hatalari', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test5-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });

  try {
    // Klasör açılmadan
    _setCurrentRoot(null);
    const beforeOpen = await mockIpc.invoke('workspace:readFile', 'test.txt');
    assert.deepEqual(beforeOpen, { error: 'Önce bir klasör aç.' });

    // Klasör açıldı
    _setCurrentRoot(fs.realpathSync(tempDir));

    // Normal dosya okuma
    fs.writeFileSync(path.join(tempDir, 'test.txt'), 'Merhaba KocaMind');
    const readRes = await mockIpc.invoke('workspace:readFile', 'test.txt');
    assert.equal(readRes.path, 'test.txt');
    assert.equal(readRes.content, 'Merhaba KocaMind');
    assert.equal(readRes.error, undefined);

    // İkili dosya (NUL baytı içeren)
    fs.writeFileSync(path.join(tempDir, 'bin.dat'), Buffer.from([0x48, 0x00, 0x49]));
    const binRes = await mockIpc.invoke('workspace:readFile', 'bin.dat');
    assert.deepEqual(binRes, { error: 'İkili dosya açılamaz.' });

    // 2 MB'tan büyük dosya
    const bigBuf = Buffer.alloc(2 * 1024 * 1024 + 16, 0x61); // 2 MB + 16 byte
    fs.writeFileSync(path.join(tempDir, 'big.txt'), bigBuf);
    const bigRes = await mockIpc.invoke('workspace:readFile', 'big.txt');
    assert.deepEqual(bigRes, { error: 'Dosya çok büyük (en fazla 2 MB).' });

    // Çalışma alanı dışı yol
    const outsideRes = await mockIpc.invoke('workspace:readFile', '../outside.txt');
    assert.deepEqual(outsideRes, { error: 'Çalışma alanı dışına erişim engellendi.' });

    // Olmayan dosya
    const notFoundRes = await mockIpc.invoke('workspace:readFile', 'yok.txt');
    assert.deepEqual(notFoundRes, { error: 'Dosya bulunamadı.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('6. workspace:writeFile var olan dosyaya yazar ve diskte degisir; olmayan dosyada Dosya bulunamadı.; calisma alani disina yazmaz', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test6-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });

  try {
    // Klasör açılmadan
    _setCurrentRoot(null);
    const beforeOpen = await mockIpc.invoke('workspace:writeFile', { path: 'var.txt', content: 'x' });
    assert.deepEqual(beforeOpen, { error: 'Önce bir klasör aç.' });

    // Klasör açıldı
    _setCurrentRoot(fs.realpathSync(tempDir));
    fs.writeFileSync(path.join(tempDir, 'var.txt'), 'eski icerik');

    // Var olan dosyaya yazma
    const writeRes = await mockIpc.invoke('workspace:writeFile', { path: 'var.txt', content: 'yeni icerik' });
    assert.equal(writeRes.path, 'var.txt');
    assert.equal(writeRes.bytes, Buffer.byteLength('yeni icerik', 'utf8'));
    assert.equal(writeRes.error, undefined);
    assert.equal(fs.readFileSync(path.join(tempDir, 'var.txt'), 'utf8'), 'yeni icerik');

    // Olmayan dosyaya yazma
    const notFoundRes = await mockIpc.invoke('workspace:writeFile', { path: 'yok.txt', content: 'deneme' });
    assert.deepEqual(notFoundRes, { error: 'Dosya bulunamadı.' });
    assert.equal(fs.existsSync(path.join(tempDir, 'yok.txt')), false);

    // Çalışma alanı dışına yazma
    const outsideRes = await mockIpc.invoke('workspace:writeFile', { path: '../disari.txt', content: 'deneme' });
    assert.deepEqual(outsideRes, { error: 'Çalışma alanı dışına erişim engellendi.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('7. handlerlar firlatmaz, { error } dondurur', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test7-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });
  _setCurrentRoot(fs.realpathSync(tempDir));

  try {
    // Geçersiz argümanlarla readFile ve writeFile çağırma
    const readErr1 = await mockIpc.invoke('workspace:readFile', null);
    assert.ok(readErr1.error);

    const writeErr1 = await mockIpc.invoke('workspace:writeFile', null);
    assert.ok(writeErr1.error);

    const writeErr2 = await mockIpc.invoke('workspace:writeFile', { path: 123, content: 456 });
    assert.ok(writeErr2.error);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('8. workspace:createFile ve workspace:createFolder basari, var olan oge ve gecersiz ad durumlari', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test8-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });

  try {
    _setCurrentRoot(null);
    assert.deepEqual(await mockIpc.invoke('workspace:createFile', { path: 'a.txt' }), { error: 'Önce bir klasör aç.' });
    assert.deepEqual(await mockIpc.invoke('workspace:createFolder', { path: 'dir' }), { error: 'Önce bir klasör aç.' });

    _setCurrentRoot(fs.realpathSync(tempDir));

    // Ust klasorlerle birlikte dosya olusturma
    const cfRes = await mockIpc.invoke('workspace:createFile', { path: 'src/nested/new.ts' });
    assert.deepEqual(cfRes, { path: 'src/nested/new.ts' });
    assert.equal(fs.readFileSync(path.join(tempDir, 'src', 'nested', 'new.ts'), 'utf8'), '');

    // Ayni adda dosya varsa hata
    const dupFile = await mockIpc.invoke('workspace:createFile', { path: 'src/nested/new.ts' });
    assert.deepEqual(dupFile, { error: 'Bu adda bir dosya zaten var.' });

    // Klasor olusturma
    const cdRes = await mockIpc.invoke('workspace:createFolder', { path: 'components/ui' });
    assert.deepEqual(cdRes, { path: 'components/ui' });
    assert.equal(fs.statSync(path.join(tempDir, 'components', 'ui')).isDirectory(), true);

    // Ayni adda klasor varsa hata
    const dupDir = await mockIpc.invoke('workspace:createFolder', { path: 'components/ui' });
    assert.deepEqual(dupDir, { error: 'Bu adda bir klasör zaten var.' });

    // Gecersiz adlar
    assert.deepEqual(await mockIpc.invoke('workspace:createFile', { path: 'a<b>.txt' }), { error: 'Geçersiz ad.' });
    assert.deepEqual(await mockIpc.invoke('workspace:createFile', { path: 'src/./a.txt' }), { error: 'Geçersiz ad.' });
    assert.deepEqual(await mockIpc.invoke('workspace:createFolder', { path: 'bad|name' }), { error: 'Geçersiz ad.' });

    // Calisma alani disi yol reddi
    assert.deepEqual(await mockIpc.invoke('workspace:createFile', { path: '../disari.txt' }), { error: 'Çalışma alanı dışına erişim engellendi.' });
    assert.deepEqual(await mockIpc.invoke('workspace:createFolder', { path: '../disari' }), { error: 'Çalışma alanı dışına erişim engellendi.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('9. workspace:rename dosya ve klasor yeniden adlandirma, hata ve sinir durumlari', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test9-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });

  try {
    _setCurrentRoot(null);
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: 'a.txt', to: 'b.txt' }), { error: 'Önce bir klasör aç.' });

    _setCurrentRoot(fs.realpathSync(tempDir));
    fs.writeFileSync(path.join(tempDir, 'a.txt'), 'icerik');
    fs.writeFileSync(path.join(tempDir, 'dolu.txt'), 'dolu');

    // Basarili yeniden adlandirma
    const renRes = await mockIpc.invoke('workspace:rename', { from: 'a.txt', to: 'b.txt' });
    assert.deepEqual(renRes, { from: 'a.txt', to: 'b.txt' });
    assert.equal(fs.existsSync(path.join(tempDir, 'a.txt')), false);
    assert.equal(fs.readFileSync(path.join(tempDir, 'b.txt'), 'utf8'), 'icerik');

    // Kaynak yok
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: 'yok.txt', to: 'c.txt' }), { error: 'Dosya bulunamadı.' });

    // Hedef dolu
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: 'b.txt', to: 'dolu.txt' }), { error: 'Hedefte aynı adda bir öğe var.' });

    // Calisma alani disi
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: 'b.txt', to: '../disari.txt' }), { error: 'Çalışma alanı dışına erişim engellendi.' });
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: '../disari.txt', to: 'c.txt' }), { error: 'Çalışma alanı dışına erişim engellendi.' });

    // Gecersiz ad
    assert.deepEqual(await mockIpc.invoke('workspace:rename', { from: 'b.txt', to: 'bad?.txt' }), { error: 'Geçersiz ad.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('10. workspace:delete sahte trashItem cagirir, kok ve disari yol reddedilir', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test10-'));
  const trashed = [];
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({
    ipcMain: mockIpc,
    dialog: {},
    getWindow: () => null,
    trashItem: async (absPath) => {
      trashed.push(absPath);
    },
  });

  try {
    _setCurrentRoot(null);
    assert.deepEqual(await mockIpc.invoke('workspace:delete', { path: 'a.txt' }), { error: 'Önce bir klasör aç.' });

    const realRoot = fs.realpathSync(tempDir);
    _setCurrentRoot(realRoot);
    fs.writeFileSync(path.join(tempDir, 'sil.txt'), 'sil');

    // Kok silme reddi
    assert.deepEqual(await mockIpc.invoke('workspace:delete', { path: '' }), { error: 'Kök klasör silinemez.' });
    assert.deepEqual(await mockIpc.invoke('workspace:delete', { path: '.' }), { error: 'Kök klasör silinemez.' });

    // Disari yol reddi
    assert.deepEqual(await mockIpc.invoke('workspace:delete', { path: '../disari.txt' }), { error: 'Çalışma alanı dışına erişim engellendi.' });

    // Basarili silme (cop kutusuna)
    const delRes = await mockIpc.invoke('workspace:delete', { path: 'sil.txt' });
    assert.deepEqual(delRes, { path: 'sil.txt' });
    assert.deepEqual(trashed, [path.resolve(realRoot, 'sil.txt')]);

    // Olmayan dosya
    assert.deepEqual(await mockIpc.invoke('workspace:delete', { path: 'yok.txt' }), { error: 'Dosya bulunamadı.' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('11. workspace:listFiles yok sayma kurallari ve 20000 siniri', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test11-'));
  const mockIpc = createMockIpcMain();
  registerWorkspaceIpc({ ipcMain: mockIpc, dialog: {}, getWindow: () => null });

  try {
    _setCurrentRoot(null);
    assert.deepEqual(await mockIpc.invoke('workspace:listFiles'), { error: 'Önce bir klasör aç.' });

    _setCurrentRoot(fs.realpathSync(tempDir));
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.mkdirSync(path.join(tempDir, 'node_modules'));
    fs.mkdirSync(path.join(tempDir, '.git'));
    fs.writeFileSync(path.join(tempDir, 'src', 'app.ts'), '');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '');
    fs.writeFileSync(path.join(tempDir, 'node_modules', 'pkg.js'), '');
    fs.writeFileSync(path.join(tempDir, '.git', 'HEAD'), '');

    const res = await mockIpc.invoke('workspace:listFiles');
    assert.equal(res.truncated, false);
    assert.deepEqual(res.files.sort(), ['README.md', 'src/app.ts']);

    // Sinir testi (maxFiles: 1)
    const { listWorkspaceFiles } = require('../workspaceIpc.cjs');
    const lim = listWorkspaceFiles(fs.realpathSync(tempDir), { maxFiles: 1 });
    assert.equal(lim.truncated, true);
    assert.equal(lim.files.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('12. resolveInside null byte (\\0) iceren yolu reddeder', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test12-'));
  try {
    assert.throws(
      () => resolveInside(tempDir, 'dosya.txt\0.js'),
      /Çalışma alanı dışına erişim engellendi\./
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('13. resolveInside kirik sembolik bag ile calisma alani disina erisimi engeller', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test13-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kocamind-test13-out-'));
  try {
    const linkPath = path.join(tempDir, 'kirik-bag.txt');
    const targetOutside = path.join(outsideDir, 'olmayan-hedef.txt');
    try {
      fs.symlinkSync(targetOutside, linkPath, 'file');
    } catch (err) {
      t.skip(`Sembolik bağ oluşturulamadı: ${err.message}`);
      return;
    }

    assert.throws(
      () => resolveInside(tempDir, 'kirik-bag.txt'),
      /Çalışma alanı dışına erişim engellendi\./
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
