'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkspace } = require('../workspace.cjs');
const { createDefaultTools } = require('../tools/index.cjs');
const { createToolRegistry } = require('../registry.cjs');

function makeTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-tools-test-'));
  const workspace = createWorkspace(dir);
  return {
    dir,
    workspace,
    ctx: { workspace, signal: null, session: { plan: [] } },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('registry: araçları kaydeder, yinelenen adı reddeder, doğrulama ve model şeması üretir', () => {
  const tools = createDefaultTools();
  const registry = createToolRegistry(tools);

  assert.equal(registry.list().length, 8);
  assert.ok(registry.get('read_file'));
  assert.equal(registry.get('olmayan'), undefined);

  assert.throws(
    () => createToolRegistry([tools[0], tools[0]]),
    { message: `Araç zaten kayıtlı: ${tools[0].name}` }
  );

  assert.throws(
    () => registry.validate('olmayan_arac', {}),
    { message: 'Bilinmeyen araç: olmayan_arac' }
  );

  assert.throws(
    () => registry.validate('read_file', '{bozuk json'),
    { message: 'Geçersiz JSON.' }
  );

  assert.throws(
    () => registry.validate('read_file', { path: 'a.txt', fazladan: 1 }),
    { message: 'Bilinmeyen alan: fazladan' }
  );

  assert.throws(
    () => registry.validate('read_file', {}),
    { message: 'Eksik alan: path' }
  );

  assert.throws(
    () => registry.validate('read_file', { path: 123 }),
    { message: 'Geçersiz alan: path' }
  );

  const valid = registry.validate('read_file', JSON.stringify({ path: 'a.txt', offset: 2, limit: 10 }));
  assert.deepEqual(valid, { path: 'a.txt', offset: 2, limit: 10 });

  const modelTools = registry.toModelTools();
  assert.equal(modelTools.length, 8);
  for (const mt of modelTools) {
    assert.equal(mt.type, 'function');
    assert.equal(typeof mt.function.name, 'string');
    assert.equal(typeof mt.function.description, 'string');
    assert.equal(mt.function.parameters.type, 'object');
    assert.equal(mt.function.parameters.additionalProperties, false);
  }
});

test('read_file: başarı ve hata durumları (offset, limit, 1 MB, ikili, klasör, bulunamadı)', async () => {
  const { dir, ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const readFile = registry.get('read_file');

    fs.writeFileSync(path.join(dir, 'notlar.txt'), 'bir\niki\nuc\ndort', 'utf8');
    const res = await readFile.execute(readFile.validate({ path: 'notlar.txt', offset: 2, limit: 2 }), ctx);
    assert.deepEqual(res, {
      path: 'notlar.txt',
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      content: '2\tiki\n3\tuc',
    });

    await assert.rejects(
      () => readFile.execute(readFile.validate({ path: 'yok.txt' }), ctx),
      { message: 'Dosya bulunamadı: yok.txt' }
    );

    fs.mkdirSync(path.join(dir, 'alt'));
    await assert.rejects(
      () => readFile.execute(readFile.validate({ path: 'alt' }), ctx),
      { message: 'Bu bir klasör, dosya değil.' }
    );

    const bigPath = path.join(dir, 'buyuk.txt');
    fs.writeFileSync(bigPath, Buffer.alloc(1024 * 1024 + 1, 65));
    await assert.rejects(
      () => readFile.execute(readFile.validate({ path: 'buyuk.txt' }), ctx),
      { message: 'Dosya çok büyük (en fazla 1 MB).' }
    );

    const binPath = path.join(dir, 'ikili.bin');
    fs.writeFileSync(binPath, Buffer.from([65, 66, 0, 67]));
    await assert.rejects(
      () => readFile.execute(readFile.validate({ path: 'ikili.bin' }), ctx),
      { message: 'İkili dosya okunamaz.' }
    );
  } finally {
    cleanup();
  }
});

test('list_dir: klasörler önce, ada göre sıralı, yok sayılan klasörlerin içine girmez, 500 sınırı', async () => {
  const { dir, ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const listDir = registry.get('list_dir');

    fs.mkdirSync(path.join(dir, 'b_klasor'));
    fs.mkdirSync(path.join(dir, 'a_klasor'));
    fs.mkdirSync(path.join(dir, 'node_modules', 'paket'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'paket', 'gizli.js'), 'x');
    fs.writeFileSync(path.join(dir, 'a_klasor', 'ic.txt'), 'merhaba');
    fs.writeFileSync(path.join(dir, 'z.txt'), '12');
    fs.writeFileSync(path.join(dir, 'a.txt'), '1234');

    const res = await listDir.execute(listDir.validate({ path: '.', depth: 2 }), ctx);
    assert.equal(res.truncated, false);
    const paths = res.entries.map((e) => `${e.type}:${e.path}`);
    assert.deepEqual(paths, [
      'dir:a_klasor',
      'dir:b_klasor',
      'dir:node_modules',
      'file:a.txt',
      'file:a_klasor/ic.txt',
      'file:z.txt',
    ]);
  } finally {
    cleanup();
  }
});

test('glob: **/*.js, src/*.{ts,tsx}, ? desenleri ve yok sayılan klasörleri atlama', async () => {
  const { dir, ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const globTool = registry.get('glob');

    fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'app.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'ui', 'btn.js'), '');
    fs.writeFileSync(path.join(dir, 'src', 'comp.ts'), '');
    fs.writeFileSync(path.join(dir, 'src', 'view.tsx'), '');
    fs.writeFileSync(path.join(dir, 'src', 'a1.txt'), '');
    fs.writeFileSync(path.join(dir, 'src', 'a22.txt'), '');
    fs.writeFileSync(path.join(dir, 'node_modules', 'lib', 'ignored.js'), '');

    const r1 = await globTool.execute(globTool.validate({ pattern: '**/*.js' }), ctx);
    assert.deepEqual(r1.matches, ['root.js', 'src/app.js', 'src/ui/btn.js']);
    assert.equal(r1.truncated, false);

    const r2 = await globTool.execute(globTool.validate({ pattern: 'src/*.{ts,tsx}' }), ctx);
    assert.deepEqual(r2.matches, ['src/comp.ts', 'src/view.tsx']);

    const r3 = await globTool.execute(globTool.validate({ pattern: 'src/a?.txt' }), ctx);
    assert.deepEqual(r3.matches, ['src/a1.txt']);
  } finally {
    cleanup();
  }
});

test('grep: düzenli ifade araması, ikili/büyük dosya atlama, geçersiz desen ve sınırlar', async () => {
  const { dir, ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const grepTool = registry.get('grep');

    assert.throws(
      () => grepTool.validate({ pattern: '[bozuk' }),
      { message: 'Geçersiz düzenli ifade.' }
    );

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'kod.js'), 'const hedef = 1;\n// HEDEF satir\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'src', 'ikili.bin'), Buffer.from([0, 1, 2, ...Buffer.from('hedef')]));

    const r1 = await grepTool.execute(grepTool.validate({ pattern: 'hedef', ignore_case: true }), ctx);
    assert.equal(r1.matches.length, 2);
    assert.deepEqual(r1.matches[0], { path: 'src/kod.js', line: 1, text: 'const hedef = 1;' });
    assert.deepEqual(r1.matches[1], { path: 'src/kod.js', line: 2, text: '// HEDEF satir' });

    // 300 karakter ve 200 eşleşme sınırı
    const longLine = 'aranan_' + 'x'.repeat(400);
    const manyLines = Array.from({ length: 210 }, () => longLine).join('\n');
    fs.writeFileSync(path.join(dir, 'cok.txt'), manyLines, 'utf8');

    const r2 = await grepTool.execute(grepTool.validate({ pattern: 'aranan_', path: 'cok.txt' }), ctx);
    assert.equal(r2.matches.length, 200);
    assert.equal(r2.truncated, true);
    assert.equal(r2.matches[0].text.length, 300);
  } finally {
    cleanup();
  }
});

test('write_file ve edit_file: preview dosyaya dokunmaz, CRLF korunur, çalışma alanı dışı reddedilir', async () => {
  const { dir, ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const writeFile = registry.get('write_file');
    const editFile = registry.get('edit_file');

    // write_file preview dosyaya dokunmaz
    const wArgs = writeFile.validate({ path: 'alt/yeni.txt', content: 'merhaba' });
    const wPrev = await writeFile.preview(wArgs, ctx);
    assert.deepEqual(wPrev, { path: 'alt/yeni.txt', before: null, after: 'merhaba' });
    assert.equal(fs.existsSync(path.join(dir, 'alt', 'yeni.txt')), false);

    const wRes = await writeFile.execute(wArgs, ctx);
    assert.deepEqual(wRes, { path: 'alt/yeni.txt', created: true, bytes: 7 });
    assert.equal(fs.readFileSync(path.join(dir, 'alt', 'yeni.txt'), 'utf8'), 'merhaba');

    // Çalışma alanı dışına yazma reddedilir
    await assert.rejects(
      () => writeFile.execute(writeFile.validate({ path: '../disari.txt', content: 'x' }), ctx),
      { message: 'Çalışma alanı dışına erişim engellendi.' }
    );

    // edit_file CRLF koruması ve preview
    const crlfPath = path.join(dir, 'crlf.txt');
    fs.writeFileSync(crlfPath, 'birinci\r\nikinci\r\nucuncu\r\n', 'utf8');

    const eArgs = editFile.validate({
      path: 'crlf.txt',
      old_string: 'ikinci',
      new_string: 'degisti',
    });
    const ePrev = await editFile.preview(eArgs, ctx);
    assert.equal(ePrev.before, 'birinci\r\nikinci\r\nucuncu\r\n');
    assert.equal(ePrev.after, 'birinci\r\ndegisti\r\nucuncu\r\n');
    // preview sonrası dosya değişmemiş olmalı
    assert.equal(fs.readFileSync(crlfPath, 'utf8'), 'birinci\r\nikinci\r\nucuncu\r\n');

    const eRes = await editFile.execute(eArgs, ctx);
    assert.deepEqual(eRes, { path: 'crlf.txt', replacements: 1 });
    assert.equal(fs.readFileSync(crlfPath, 'utf8'), 'birinci\r\ndegisti\r\nucuncu\r\n');

    // edit_file hata durumları
    await assert.rejects(
      () => editFile.preview(editFile.validate({ path: 'crlf.txt', old_string: 'ayni', new_string: 'ayni' }), ctx),
      { message: 'Değişiklik yok.' }
    );
    await assert.rejects(
      () => editFile.preview(editFile.validate({ path: 'crlf.txt', old_string: 'olmayan', new_string: 'yeni' }), ctx),
      { message: 'Aranan metin dosyada bulunamadı.' }
    );

    fs.writeFileSync(path.join(dir, 'tekrar.txt'), 'aa\naa\n', 'utf8');
    await assert.rejects(
      () => editFile.preview(editFile.validate({ path: 'tekrar.txt', old_string: 'aa', new_string: 'bb' }), ctx),
      { message: 'Aranan metin birden fazla yerde geçiyor; daha fazla bağlam ver ya da replace_all kullan.' }
    );

    const repAll = await editFile.execute(
      editFile.validate({ path: 'tekrar.txt', old_string: 'aa', new_string: 'bb', replace_all: true }),
      ctx
    );
    assert.deepEqual(repAll, { path: 'tekrar.txt', replacements: 2 });
  } finally {
    cleanup();
  }
});

test('run_command: çıkış kodu, stderr, zaman aşımı, iptal ve çıktı kısaltma', async () => {
  const { ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const runCmd = registry.get('run_command');

    // Başarılı komut ve stderr
    const r1 = await runCmd.execute(
      runCmd.validate({ command: 'node -e "process.stdout.write(\'merhaba\'); process.stderr.write(\'uyari\'); process.exit(2)"' }),
      ctx
    );
    assert.equal(r1.exitCode, 2);
    assert.equal(r1.stdout, 'merhaba');
    assert.equal(r1.stderr, 'uyari');
    assert.equal(r1.timedOut, false);

    // Çıktı kısaltma (20000 karakter sınırı)
    const r2 = await runCmd.execute(
      runCmd.validate({ command: 'node -e "process.stdout.write(\'A\'.repeat(21000))"' }),
      ctx
    );
    assert.equal(r2.exitCode, 0);
    assert.ok(r2.stdout.startsWith('…(kısaltıldı)\n'));
    assert.equal(r2.stdout.length, '…(kısaltıldı)\n'.length + 20000);

    // Zaman aşımı
    const r3 = await runCmd.execute(
      runCmd.validate({ command: 'node -e "setTimeout(() => {}, 10000)"', timeout_ms: 1000 }),
      ctx
    );
    assert.equal(r3.timedOut, true);
    assert.equal(r3.exitCode, null);

    // İptal sinyali
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const r4 = await runCmd.execute(
      runCmd.validate({ command: 'node -e "setTimeout(() => {}, 10000)"', timeout_ms: 10000 }),
      { ...ctx, signal: ac.signal }
    );
    assert.equal(r4.timedOut, true);
    assert.equal(r4.exitCode, null);
  } finally {
    cleanup();
  }
});

test('update_plan: planı doğrular ve oturuma yazar', async () => {
  const { ctx, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const updatePlan = registry.get('update_plan');

    const args = updatePlan.validate({
      items: [
        { content: 'Adım 1', status: 'completed' },
        { content: 'Adım 2', status: 'in_progress' },
        { content: 'Adım 3', status: 'pending' },
      ],
    });
    const res = await updatePlan.execute(args, ctx);
    assert.equal(res.items.length, 3);
    assert.deepEqual(ctx.session.plan, res.items);

    // İki in_progress reddedilir
    assert.throws(() =>
      updatePlan.validate({
        items: [
          { content: 'A', status: 'in_progress' },
          { content: 'B', status: 'in_progress' },
        ],
      })
    );
  } finally {
    cleanup();
  }
});

test('okuma ve yazma korumalari: okumadan edit_file reddedilir; okuduktan sonra izin verilir; okunduktan sonra disaridan degisen dosya reddedilir', async () => {
  const { dir, workspace, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const readFile = registry.get('read_file');
    const editFile = registry.get('edit_file');
    const ctx = { workspace, session: { plan: [], readFiles: new Map() } };

    const filePath = path.join(dir, 'hedef.txt');
    fs.writeFileSync(filePath, 'orijinal icerik', 'utf8');

    const editArgs = editFile.validate({
      path: 'hedef.txt',
      old_string: 'orijinal',
      new_string: 'guncel',
    });

    // 1. Okumadan edit_file preview ve execute reddedilir
    await assert.rejects(
      () => editFile.preview(editArgs, ctx),
      { message: 'Bu dosyayı önce read_file ile oku; okumadan değiştiremezsin.' }
    );
    await assert.rejects(
      () => editFile.execute(editArgs, ctx),
      { message: 'Bu dosyayı önce read_file ile oku; okumadan değiştiremezsin.' }
    );

    // 2. Okuduktan sonra izin verilir
    await readFile.execute(readFile.validate({ path: 'hedef.txt' }), ctx);
    const prev = await editFile.preview(editArgs, ctx);
    assert.equal(prev.path, 'hedef.txt');

    const execRes = await editFile.execute(editArgs, ctx);
    assert.equal(execRes.replacements, 1);
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'guncel icerik');

    // 3. Okunduktan sonra dışarıdan değişen dosya reddedilir
    fs.writeFileSync(filePath, 'harici degisiklik', 'utf8');
    const nextEdit = editFile.validate({
      path: 'hedef.txt',
      old_string: 'harici',
      new_string: 'yeni',
    });
    await assert.rejects(
      () => editFile.preview(nextEdit, ctx),
      { message: 'Dosya en son okunduğundan beri değişmiş; önce tekrar oku.' }
    );
    await assert.rejects(
      () => editFile.execute(nextEdit, ctx),
      { message: 'Dosya en son okunduğundan beri değişmiş; önce tekrar oku.' }
    );
  } finally {
    cleanup();
  }
});

test('okuma ve yazma korumalari: yeni dosya olusturmada kural yok; agent kendi yazdigini okumadan duzenleyebilir', async () => {
  const { dir, workspace, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const writeFile = registry.get('write_file');
    const editFile = registry.get('edit_file');
    const ctx = { workspace, session: { plan: [], readFiles: new Map() } };

    // Yeni dosya oluşturma kurala tabi değildir
    const writeArgs = writeFile.validate({ path: 'yeni.txt', content: 'ilk icerik' });
    const writePrev = await writeFile.preview(writeArgs, ctx);
    assert.equal(writePrev.before, null);

    await writeFile.execute(writeArgs, ctx);
    assert.equal(fs.readFileSync(path.join(dir, 'yeni.txt'), 'utf8'), 'ilk icerik');

    // Agent kendi yazdığı dosyayı read_file çağırmadan düzenleyebilmeli
    const editArgs = editFile.validate({
      path: 'yeni.txt',
      old_string: 'ilk',
      new_string: 'ikinci',
    });
    await editFile.execute(editArgs, ctx);
    assert.equal(fs.readFileSync(path.join(dir, 'yeni.txt'), 'utf8'), 'ikinci icerik');
  } finally {
    cleanup();
  }
});

test('okuma ve yazma korumalari: expectedBeforeHash uyusmazliginda yazma reddedilir ve dosya degismez; preview beforeHash dondurur', async () => {
  const { dir, workspace, cleanup } = makeTempWorkspace();
  try {
    const registry = createToolRegistry(createDefaultTools());
    const readFile = registry.get('read_file');
    const editFile = registry.get('edit_file');
    const writeFile = registry.get('write_file');
    const ctx = { workspace, session: { plan: [], readFiles: new Map() } };

    const filePath = path.join(dir, 'degisecek.txt');
    fs.writeFileSync(filePath, 'sabit metin', 'utf8');
    await readFile.execute(readFile.validate({ path: 'degisecek.txt' }), ctx);

    // preview beforeHash döndürür
    const editArgs = editFile.validate({
      path: 'degisecek.txt',
      old_string: 'sabit',
      new_string: 'degismis',
    });
    const prev = await editFile.preview(editArgs, ctx);
    assert.equal(typeof prev.beforeHash, 'string');
    assert.ok(prev.beforeHash.length > 0);

    const newPrev = await writeFile.preview(writeFile.validate({ path: 'olmayan.txt', content: 'abc' }), ctx);
    assert.equal(newPrev.beforeHash, null);

    // expectedBeforeHash uyuşmazlığında edit_file reddedilir ve dosya değişmez
    const wrongCtx = { ...ctx, expectedBeforeHash: 'yanlis_hash_degeri' };
    await assert.rejects(
      () => editFile.execute(editArgs, wrongCtx),
      { message: 'Dosya onaydan sonra değişti; değişiklik uygulanmadı. Tekrar okuyup yeniden dene.' }
    );
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'sabit metin');

    // expectedBeforeHash uyuşmazlığında write_file reddedilir ve dosya değişmez
    const writeArgs = writeFile.validate({ path: 'degisecek.txt', content: 'tamamen yeni' });
    await assert.rejects(
      () => writeFile.execute(writeArgs, wrongCtx),
      { message: 'Dosya onaydan sonra değişti; değişiklik uygulanmadı. Tekrar okuyup yeniden dene.' }
    );
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'sabit metin');
  } finally {
    cleanup();
  }
});
