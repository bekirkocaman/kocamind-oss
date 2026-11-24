'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LIMIT = 2000;
const BINARY_CHECK_BYTES = 8192;
const ALLOWED_KEYS = new Set(['path', 'offset', 'limit']);

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
  if (typeof raw.path !== 'string' || raw.path.trim() === '') {
    throw new Error('Geçersiz alan: path');
  }

  let offset = 1;
  if (raw.offset !== undefined) {
    if (typeof raw.offset !== 'number' || !Number.isInteger(raw.offset) || raw.offset < 1) {
      throw new Error('Geçersiz alan: offset');
    }
    offset = raw.offset;
  }

  let limit = MAX_LIMIT;
  if (raw.limit !== undefined) {
    if (
      typeof raw.limit !== 'number' ||
      !Number.isInteger(raw.limit) ||
      raw.limit < 1 ||
      raw.limit > MAX_LIMIT
    ) {
      throw new Error('Geçersiz alan: limit');
    }
    limit = raw.limit;
  }

  return { path: raw.path, offset, limit };
}

async function execute(args, ctx) {
  const absPath = ctx.workspace.resolve(args.path);
  const relPath = ctx.workspace.toRelative(absPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Dosya bulunamadı: ${args.path}`);
  }

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    throw new Error('Bu bir klasör, dosya değil.');
  }

  if (stat.size > MAX_FILE_BYTES) {
    throw new Error('Dosya çok büyük (en fazla 1 MB).');
  }

  const buf = fs.readFileSync(absPath);
  const probe = buf.subarray(0, BINARY_CHECK_BYTES);
  if (probe.includes(0)) {
    throw new Error('İkili dosya okunamaz.');
  }

  const text = buf.toString('utf8');
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const totalLines = lines.length;
  const startIdx = Math.min(args.offset - 1, totalLines);
  const slice = lines.slice(startIdx, startIdx + args.limit);
  const startLine = slice.length > 0 ? startIdx + 1 : args.offset;
  const endLine = slice.length > 0 ? startIdx + slice.length : startIdx;
  const content = slice.map((line, i) => `${startIdx + 1 + i}\t${line}`).join('\n');

  if (ctx && ctx.session) {
    if (!ctx.session.readFiles) {
      ctx.session.readFiles = new Map();
    }
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    ctx.session.readFiles.set(relPath, hash);
  }

  return {
    path: relPath,
    startLine,
    endLine,
    totalLines,
    content,
  };
}

const readFileTool = {
  name: 'read_file',
  description: 'Belirtilen dosyayı satır numaralı olarak okur.',
  risk: 'read',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Çalışma alanına göre dosya yolu.' },
      offset: { type: 'integer', description: '1 tabanlı başlangıç satırı.' },
      limit: { type: 'integer', description: 'Okunacak en fazla satır sayısı (en fazla 2000).' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { readFileTool };
