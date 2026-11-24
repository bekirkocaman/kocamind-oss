'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 1024 * 1024;
const ALLOWED_KEYS = new Set(['path', 'content']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  if (raw.path === undefined || raw.path === null) {
    throw new Error('Eksik alan: path');
  }
  if (raw.content === undefined || raw.content === null) {
    throw new Error('Eksik alan: content');
  }
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new Error('Geçersiz alan: path');
  }
  if (typeof raw.content !== 'string') {
    throw new Error('Geçersiz alan: content');
  }

  return { path: raw.path, content: raw.content };
}

function prepareWrite(args, ctx) {
  const absPath = ctx.workspace.resolve(args.path);
  const relPath = ctx.workspace.toRelative(absPath);
  const bytes = Buffer.byteLength(args.content, 'utf8');

  if (bytes > MAX_FILE_BYTES) {
    throw new Error('Dosya çok büyük (en fazla 1 MB).');
  }

  let before = null;
  let beforeHash = null;
  if (fs.existsSync(absPath)) {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      throw new Error('Bu bir klasör, dosya değil.');
    }
    const buf = fs.readFileSync(absPath);
    before = buf.toString('utf8');
    beforeHash = crypto.createHash('sha256').update(buf).digest('hex');

    if (ctx && ctx.session && ctx.session.readFiles) {
      if (!ctx.session.readFiles.has(relPath)) {
        throw new Error('Bu dosyayı önce read_file ile oku; okumadan değiştiremezsin.');
      }
      const recordedHash = ctx.session.readFiles.get(relPath);
      if (recordedHash !== beforeHash) {
        throw new Error('Dosya en son okunduğundan beri değişmiş; önce tekrar oku.');
      }
    }
  }

  return { absPath, relPath, before, beforeHash, bytes };
}

async function preview(args, ctx) {
  const { relPath, before, beforeHash } = prepareWrite(args, ctx);
  const res = {
    path: relPath,
    before,
    after: args.content,
  };
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

  const { before, bytes } = prepareWrite(args, ctx);
  const created = before === null;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, args.content, 'utf8');

  if (ctx && ctx.session && ctx.session.readFiles) {
    const newHash = crypto.createHash('sha256').update(args.content, 'utf8').digest('hex');
    ctx.session.readFiles.set(relPath, newHash);
  }

  return {
    path: relPath,
    created,
    bytes,
  };
}

const writeFileTool = {
  name: 'write_file',
  description: 'Dosyayı oluşturur veya tüm içeriğini değiştirir.',
  risk: 'write',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Yazılacak dosya yolu.' },
      content: { type: 'string', description: 'Dosyanın tam içeriği.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  validate,
  preview,
  execute,
};

module.exports = { writeFileTool };
