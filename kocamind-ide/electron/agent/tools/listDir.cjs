'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 500;
const ALLOWED_KEYS = new Set(['path', 'depth']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }

  let dirPath = '.';
  if (raw.path !== undefined) {
    if (typeof raw.path !== 'string' || raw.path.trim() === '') {
      throw new Error('Geçersiz alan: path');
    }
    dirPath = raw.path;
  }

  let depth = 1;
  if (raw.depth !== undefined) {
    if (typeof raw.depth !== 'number' || !Number.isInteger(raw.depth) || raw.depth < 1 || raw.depth > 3) {
      throw new Error('Geçersiz alan: depth');
    }
    depth = raw.depth;
  }

  return { path: dirPath, depth };
}

async function execute(args, ctx) {
  const absDir = ctx.workspace.resolve(args.path);
  const relDir = ctx.workspace.toRelative(absDir);

  if (!fs.existsSync(absDir)) {
    throw new Error(`Dosya bulunamadı: ${args.path}`);
  }
  const rootStat = fs.statSync(absDir);
  if (!rootStat.isDirectory()) {
    throw new Error('Klasör değil.');
  }

  const collected = [];

  function walk(currentAbs, currentDepth) {
    let dirents;
    try {
      dirents = fs.readdirSync(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }

    // Klasörler önce, sonra dosyalar; ada göre sıralı
    dirents.sort((a, b) => {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    for (const d of dirents) {
      const childAbs = path.join(currentAbs, d.name);
      let relChild;
      try {
        relChild = ctx.workspace.toRelative(childAbs);
      } catch {
        continue;
      }

      if (d.isDirectory()) {
        collected.push({ path: relChild, type: 'dir' });
        if (currentDepth < args.depth && !ctx.workspace.isIgnored(relChild)) {
          walk(childAbs, currentDepth + 1);
        }
      } else if (d.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(childAbs).size;
        } catch {
          // Boyut okunamazsa 0 bırak
        }
        collected.push({ path: relChild, type: 'file', size });
      }
    }
  }

  walk(absDir, 1);

  // Klasörler önce, sonra dosyalar; yola göre sıralı
  collected.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  const truncated = collected.length > MAX_ENTRIES;
  const entries = truncated ? collected.slice(0, MAX_ENTRIES) : collected;

  return {
    path: relDir,
    entries,
    truncated,
  };
}

const listDirTool = {
  name: 'list_dir',
  description: 'Klasör içeriğini belirtilen derinliğe kadar listeler.',
  risk: 'read',
  jsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Listelenecek klasör yolu (varsayılan ".").' },
      depth: { type: 'integer', description: 'Alt klasör derinliği (1..3, varsayılan 1).' },
    },
    required: [],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { listDirTool };
