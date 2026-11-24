'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const ALLOWED_KEYS = new Set(['path', 'old_string', 'new_string', 'replace_all']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  for (const req of ['path', 'old_string', 'new_string']) {
    if (raw[req] === undefined || raw[req] === null) {
      throw new Error(`Eksik alan: ${req}`);
    }
  }
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new Error('Geçersiz alan: path');
  }
  if (typeof raw.old_string !== 'string' || raw.old_string === '') {
    throw new Error('Geçersiz alan: old_string');
  }
  if (typeof raw.new_string !== 'string') {
    throw new Error('Geçersiz alan: new_string');
  }

  let replaceAll = false;
  if (raw.replace_all !== undefined) {
    if (typeof raw.replace_all !== 'boolean') {
      throw new Error('Geçersiz alan: replace_all');
    }
    replaceAll = raw.replace_all;
  }

  return {
    path: raw.path,
    old_string: raw.old_string,
    new_string: raw.new_string,
    replace_all: replaceAll,
  };
}

function computeEdit(args, ctx) {
  const absPath = ctx.workspace.resolve(args.path);
  const relPath = ctx.workspace.toRelative(absPath);

  const oldNorm = args.old_string.replace(/\r\n/g, '\n');
  const newNorm = args.new_string.replace(/\r\n/g, '\n');

  if (oldNorm === '' || oldNorm === newNorm) {
    throw new Error('Değişiklik yok.');
  }

  if (!fs.existsSync(absPath)) {
    throw new Error(`Dosya bulunamadı: ${args.path}`);
  }
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    throw new Error('Bu bir klasör, dosya değil.');
  }

  const buf = fs.readFileSync(absPath);
  const beforeHash = crypto.createHash('sha256').update(buf).digest('hex');

  if (ctx && ctx.session && ctx.session.readFiles) {
    if (!ctx.session.readFiles.has(relPath)) {
      throw new Error('Bu dosyayı önce read_file ile oku; okumadan değiştiremezsin.');
    }
    const recordedHash = ctx.session.readFiles.get(relPath);
    if (recordedHash !== beforeHash) {
      throw new Error('Dosya en son okunduğundan beri değişmiş; önce tekrar oku.');
    }
  }

  const before = buf.toString('utf8');
  const usesCRLF = before.includes('\r\n');
  const beforeNorm = before.replace(/\r\n/g, '\n');

  const parts = beforeNorm.split(oldNorm);
  const count = parts.length - 1;

  if (count === 0) {
    throw new Error('Aranan metin dosyada bulunamadı.');
  }
  if (count > 1 && !args.replace_all) {
    throw new Error(
      'Aranan metin birden fazla yerde geçiyor; daha fazla bağlam ver ya da replace_all kullan.'
    );
  }

  let afterNorm;
  let replacements;
  if (args.replace_all) {
    afterNorm = parts.join(newNorm);
    replacements = count;
  } else {
    const idx = beforeNorm.indexOf(oldNorm);
    afterNorm =
      beforeNorm.slice(0, idx) + newNorm + beforeNorm.slice(idx + oldNorm.length);
    replacements = 1;
  }

  const after = usesCRLF ? afterNorm.replace(/\n/g, '\r\n') : afterNorm;
  return { absPath, relPath, before, beforeHash, after, replacements };
}

async function preview(args, ctx) {
  const { relPath, before, beforeHash, after } = computeEdit(args, ctx);
  const res = { path: relPath, before, after };
  Object.defineProperty(res, 'beforeHash', {
    value: beforeHash,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return res;
}

async function execute(args, ctx) {
  const absPath = ctx.workspace.resolve(args.path);
  const relPath = ctx.workspace.toRelative(absPath);

  if (ctx && ctx.expectedBeforeHash !== undefined) {
    let currentHash = null;
    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      if (!stat.isDirectory()) {
        const buf = fs.readFileSync(absPath);
        currentHash = crypto.createHash('sha256').update(buf).digest('hex');
      }
    }
    if (currentHash !== ctx.expectedBeforeHash) {
      throw new Error('Dosya onaydan sonra değişti; değişiklik uygulanmadı. Tekrar okuyup yeniden dene.');
    }
  }

  const { after, replacements } = computeEdit(args, ctx);
  fs.writeFileSync(absPath, after, 'utf8');

  if (ctx && ctx.session && ctx.session.readFiles) {
    const newHash = crypto.createHash('sha256').update(after, 'utf8').digest('hex');
    ctx.session.readFiles.set(relPath, newHash);
  }

  return { path: relPath, replacements };
}

const editFileTool = {
  name: 'edit_file',
  description: 'Dosya içindeki tam eşleşen bir metin parçasını yenisiyle değiştirir.',
  risk: 'write',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Düzenlenecek dosya yolu.' },
      old_string: { type: 'string', description: 'Değiştirilecek mevcut metin.' },
      new_string: { type: 'string', description: 'Yeni metin.' },
      replace_all: { type: 'boolean', description: 'Tüm eşleşmeleri değiştir.' },
    },
    required: ['path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  validate,
  preview,
  execute,
};

module.exports = { editFileTool };
