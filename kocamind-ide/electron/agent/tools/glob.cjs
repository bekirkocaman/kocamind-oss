'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_MATCHES = 500;
const ALLOWED_KEYS = new Set(['pattern', 'path']);

// Glob desenini düzenli ifadeye çevirir
function globToRegExp(globPattern) {
  const norm = globPattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '^';
  let i = 0;

  while (i < norm.length) {
    const ch = norm[i];
    if (ch === '*') {
      if (norm[i + 1] === '*') {
        if (norm[i + 2] === '/') {
          re += '(?:.+/)?';
          i += 3;
          continue;
        }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (ch === '{') {
      const closeIdx = norm.indexOf('}', i + 1);
      if (closeIdx !== -1) {
        const inner = norm.slice(i + 1, closeIdx);
        const parts = inner.split(',').map((p) =>
          p.replace(/[.+^$()[\]\\|]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')
        );
        re += `(?:${parts.join('|')})`;
        i = closeIdx + 1;
      } else {
        re += '\\{';
        i += 1;
      }
    } else if (/[.+^$()[\]\\|{}]/.test(ch)) {
      re += '\\' + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }

  re += '$';
  return new RegExp(re);
}

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
  if (typeof raw.pattern !== 'string' || raw.pattern.trim() === '') {
    throw new Error('Geçersiz alan: pattern');
  }

  let basePath = '.';
  if (raw.path !== undefined) {
    if (typeof raw.path !== 'string' || raw.path.trim() === '') {
      throw new Error('Geçersiz alan: path');
    }
    basePath = raw.path;
  }

  return { pattern: raw.pattern, path: basePath };
}

async function execute(args, ctx) {
  const absBase = ctx.workspace.resolve(args.path);
  if (!fs.existsSync(absBase)) {
    throw new Error(`Dosya bulunamadı: ${args.path}`);
  }
  const baseStat = fs.statSync(absBase);
  if (!baseStat.isDirectory()) {
    throw new Error('Klasör değil.');
  }

  const matcher = globToRegExp(args.pattern);
  const allMatches = [];

  function walk(currentAbs) {
    let dirents;
    try {
      dirents = fs.readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const d of dirents) {
      const childAbs = path.join(currentAbs, d.name);
      let relToWorkspace;
      try {
        relToWorkspace = ctx.workspace.toRelative(childAbs);
      } catch {
        continue;
      }

      if (ctx.workspace.isIgnored(relToWorkspace)) {
        continue;
      }

      if (d.isDirectory()) {
        walk(childAbs);
      } else if (d.isFile()) {
        const relToBase = path.relative(absBase, childAbs).split(path.sep).join('/');
        if (matcher.test(relToBase) || matcher.test(relToWorkspace)) {
          allMatches.push(relToWorkspace);
        }
      }
    }
  }

  walk(absBase);

  allMatches.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const truncated = allMatches.length > MAX_MATCHES;
  const matches = truncated ? allMatches.slice(0, MAX_MATCHES) : allMatches;

  return { matches, truncated };
}

const globTool = {
  name: 'glob',
  description: 'Verilen glob desenine uyan dosyaları çalışma alanında bulur.',
  risk: 'read',
  jsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Arama deseni (örn. "**/*.js").' },
      path: { type: 'string', description: 'Aramanın başlayacağı klasör (varsayılan ".").' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { globTool, globToRegExp };
