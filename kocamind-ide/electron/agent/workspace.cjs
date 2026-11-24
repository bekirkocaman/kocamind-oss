'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Yok sayılan klasör adları
const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.gradle',
  '.idea',
  '.venv',
  '__pycache__',
]);

function isWithinRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return false;
  return true;
}

function createWorkspace(rootDir) {
  if (typeof rootDir !== 'string' || rootDir.trim() === '') {
    throw new Error('Çalışma alanı bulunamadı.');
  }

  let root;
  try {
    const stat = fs.statSync(rootDir);
    if (!stat.isDirectory()) {
      throw new Error('Çalışma alanı bulunamadı.');
    }
    root = fs.realpathSync(rootDir);
  } catch {
    throw new Error('Çalışma alanı bulunamadı.');
  }

  function resolve(relPath) {
    if (typeof relPath !== 'string' || relPath.trim() === '' || relPath.includes('\0')) {
      throw new Error('Çalışma alanı dışına erişim engellendi.');
    }

    // Windows'ta kök olmayan sürücü göreli yolları (örn. C:foo) veya farklı sürücüler
    if (process.platform === 'win32' && /^[a-zA-Z]:/.test(relPath)) {
      const rootDrive = root.slice(0, 2).toLowerCase();
      const targetDrive = relPath.slice(0, 2).toLowerCase();
      if (rootDrive !== targetDrive || !path.isAbsolute(relPath)) {
        throw new Error('Çalışma alanı dışına erişim engellendi.');
      }
    }

    const candidate = path.isAbsolute(relPath)
      ? path.resolve(relPath)
      : path.resolve(root, relPath);

    if (!isWithinRoot(root, candidate)) {
      throw new Error('Çalışma alanı dışına erişim engellendi.');
    }

    // Var olan en yakın üst klasörün (veya hedefin kendisinin) gerçek yolunu denetle
    let current = candidate;
    const tail = [];
    while (true) {
      try {
        const lstat = fs.lstatSync(current);
        if (lstat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(current);
          const targetAbs = path.resolve(path.dirname(current), linkTarget);
          let targetToCheck = targetAbs;
          try {
            if (fs.existsSync(targetAbs)) {
              targetToCheck = fs.realpathSync(targetAbs);
            }
          } catch {}
          if (!isWithinRoot(root, targetToCheck)) {
            throw new Error('Çalışma alanı dışına erişim engellendi.');
          }
        }
      } catch (err) {
        if (err.message === 'Çalışma alanı dışına erişim engellendi.') {
          throw err;
        }
      }

      if (fs.existsSync(current)) {
        let realCurrent;
        try {
          realCurrent = fs.realpathSync(current);
        } catch {
          throw new Error('Çalışma alanı dışına erişim engellendi.');
        }
        if (!isWithinRoot(root, realCurrent)) {
          throw new Error('Çalışma alanı dışına erişim engellendi.');
        }
        return tail.length > 0 ? path.join(realCurrent, ...tail.reverse()) : realCurrent;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error('Çalışma alanı dışına erişim engellendi.');
      }
      tail.push(path.basename(current));
      current = parent;
    }
  }

  function toRelative(absPath) {
    const resolved = resolve(absPath);
    const rel = path.relative(root, resolved);
    if (rel === '') return '.';
    return rel.split(path.sep).join('/');
  }

  function isIgnored(relPath) {
    if (typeof relPath !== 'string' || relPath === '') return false;
    const parts = relPath.split(/[\\/]+/);
    for (const part of parts) {
      if (IGNORED_NAMES.has(part)) return true;
    }
    return false;
  }

  return {
    root,
    resolve,
    toRelative,
    isIgnored,
  };
}

module.exports = { createWorkspace };
