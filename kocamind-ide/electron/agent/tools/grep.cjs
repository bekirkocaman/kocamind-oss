'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { globToRegExp } = require('./glob.cjs');

const MAX_FILE_BYTES = 1024 * 1024;
const BINARY_CHECK_BYTES = 8192;
const MAX_MATCHES = 200;
const MAX_TEXT_LEN = 300;
const ALLOWED_KEYS = new Set(['pattern', 'path', 'glob', 'ignore_case']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  if (raw.pattern === undefined || raw.pattern === null) {
    throw new Error('Eksik alan: pattern');
  }
  if (typeof raw.pattern !== 'string' || raw.pattern === '') {
    throw new Error('Geçersiz alan: pattern');
  }

  let searchPath = '.';
  if (raw.path !== undefined) {
    if (typeof raw.path !== 'string' || raw.path.trim() === '') {
      throw new Error('Geçersiz alan: path');
    }
    searchPath = raw.path;
  }

  let globPattern = null;
  if (raw.glob !== undefined) {
    if (typeof raw.glob !== 'string' || raw.glob.trim() === '') {
      throw new Error('Geçersiz alan: glob');
    }
    globPattern = raw.glob;
  }

  let ignoreCase = false;
  if (raw.ignore_case !== undefined) {
    if (typeof raw.ignore_case !== 'boolean') {
      throw new Error('Geçersiz alan: ignore_case');
    }
    ignoreCase = raw.ignore_case;
  }

  try {
    new RegExp(raw.pattern, ignoreCase ? 'i' : '');
  } catch {
    throw new Error('Geçersiz düzenli ifade.');
  }

  return {
    pattern: raw.pattern,
    path: searchPath,
    glob: globPattern,
    ignore_case: ignoreCase,
  };
}

async function execute(args, ctx) {
  let regex;
  try {
    regex = new RegExp(args.pattern, args.ignore_case ? 'i' : '');
  } catch {
    throw new Error('Geçersiz düzenli ifade.');
  }

  const absTarget = ctx.workspace.resolve(args.path);
  if (!fs.existsSync(absTarget)) {
    throw new Error(`Dosya bulunamadı: ${args.path}`);
  }

  const globMatcher = args.glob ? globToRegExp(args.glob) : null;
  const filesToScan = [];

  const targetStat = fs.statSync(absTarget);
  if (targetStat.isFile()) {
    const rel = ctx.workspace.toRelative(absTarget);
    if (!ctx.workspace.isIgnored(rel)) {
      filesToScan.push({ abs: absTarget, rel });
    }
  } else if (targetStat.isDirectory()) {
    function collectFiles(currentAbs) {
      let dirents;
      try {
        dirents = fs.readdirSync(currentAbs, { withFileTypes: true });
      } catch {
        return;
      }
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      for (const d of dirents) {
        const childAbs = path.join(currentAbs, d.name);
        let rel;
        try {
          rel = ctx.workspace.toRelative(childAbs);
        } catch {
          continue;
        }
        if (ctx.workspace.isIgnored(rel)) continue;

        if (d.isDirectory()) {
          collectFiles(childAbs);
        } else if (d.isFile()) {
          if (globMatcher) {
            const relToTarget = path.relative(absTarget, childAbs).split(path.sep).join('/');
            if (!globMatcher.test(rel) && !globMatcher.test(relToTarget) && !globMatcher.test(d.name)) {
              continue;
            }
          }
          filesToScan.push({ abs: childAbs, rel });
        }
      }
    }
    collectFiles(absTarget);
  }

  const matches = [];
  let truncated = false;

  for (const file of filesToScan) {
    if (truncated) break;

    let stat;
    try {
      stat = fs.statSync(file.abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;

    let buf;
    try {
      buf = fs.readFileSync(file.abs);
    } catch {
      continue;
    }
    if (buf.subarray(0, BINARY_CHECK_BYTES).includes(0)) continue;

    const text = buf.toString('utf8');
    const lines = text === '' ? [] : text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (regex.test(lineText)) {
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
        matches.push({
          path: file.rel,
          line: i + 1,
          text: lineText.length > MAX_TEXT_LEN ? lineText.slice(0, MAX_TEXT_LEN) : lineText,
        });
      }
    }
  }

  return { matches, truncated };
}

const grepTool = {
  name: 'grep',
  description: 'Dosyalarda düzenli ifade ile metin arar ve eşleşen satırları döndürür.',
  risk: 'read',
  jsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Aranacak JavaScript düzenli ifadesi.' },
      path: { type: 'string', description: 'Aranacak klasör veya dosya yolu (varsayılan ".").' },
      glob: { type: 'string', description: 'Dosya adı filtreleme deseni.' },
      ignore_case: { type: 'boolean', description: 'Büyük/küçük harf duyarsız arama.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { grepTool };
