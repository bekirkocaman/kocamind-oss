// electron/workspaceIpc.cjs
// KocaMind IDE calisma alani IPC modulu

const fs = require('fs');
const path = require('path');

let currentRoot = null;

const IGNORED_DIRS = new Set([
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

/**
 * Goreli yolu root icinde mutlak yola cevirir.
 * Guvenlik kontrolleri: bos/gecersiz deger, mutlak yol, '..' ile cikis,
 * sembolik bag ile disari cikis engellenir.
 */
function resolveInside(root, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim() || relPath.includes('\0')) {
    throw new Error('Çalışma alanı dışına erişim engellendi.');
  }

  // Mutlak yol kontrolleri (POSIX ve Windows)
  if (
    path.isAbsolute(relPath) ||
    relPath.startsWith('/') ||
    relPath.startsWith('\\') ||
    /^[a-zA-Z]:/.test(relPath)
  ) {
    throw new Error('Çalışma alanı dışına erişim engellendi.');
  }

  const rootReal = fs.realpathSync(root);
  const resolved = path.resolve(rootReal, relPath);

  // Goreli yol kokun disina cikiyor mu kontrolu
  const relFromRoot = path.relative(rootReal, resolved);
  if (
    relFromRoot === '..' ||
    relFromRoot.startsWith('..' + path.sep) ||
    path.isAbsolute(relFromRoot)
  ) {
    throw new Error('Çalışma alanı dışına erişim engellendi.');
  }

  // Hedef yolun kendisi veya ust bilesenleri sembolik bagsa (hedefi var olmasa bile)
  let cur = resolved;
  while (cur) {
    try {
      const lstat = fs.lstatSync(cur);
      if (lstat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(cur);
        const targetAbs = path.resolve(path.dirname(cur), linkTarget);
        let targetToCheck = targetAbs;
        try {
          if (fs.existsSync(targetAbs)) {
            targetToCheck = fs.realpathSync(targetAbs);
          }
        } catch {}
        const relCheck = path.relative(rootReal, targetToCheck);
        if (
          relCheck === '..' ||
          relCheck.startsWith('..' + path.sep) ||
          path.isAbsolute(relCheck)
        ) {
          throw new Error('Çalışma alanı dışına erişim engellendi.');
        }
      }
    } catch (err) {
      if (err.message === 'Çalışma alanı dışına erişim engellendi.') {
        throw err;
      }
    }

    if (fs.existsSync(cur)) {
      const curReal = fs.realpathSync(cur);
      const relCheck = path.relative(rootReal, curReal);
      if (
        relCheck === '..' ||
        relCheck.startsWith('..' + path.sep) ||
        path.isAbsolute(relCheck)
      ) {
        throw new Error('Çalışma alanı dışına erişim engellendi.');
      }
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  return resolved;
}

/**
 * Klasoru ozyinelemeli tarar ve dugum agacini dondurur.
 */
function buildTree(root, { maxNodes = 5000 } = {}) {
  let count = 0;
  let truncated = false;

  function traverse(dirAbs, dirRel) {
    if (truncated) return [];
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return [];
    }

    const filtered = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        filtered.push({ name: entry.name, isDirectory: true });
      } else if (entry.isFile()) {
        filtered.push({ name: entry.name, isDirectory: false });
      }
    }

    filtered.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const nodes = [];
    for (const item of filtered) {
      if (count >= maxNodes) {
        truncated = true;
        break;
      }
      count++;
      const itemRel = dirRel ? `${dirRel}/${item.name}` : item.name;
      const nodePath = itemRel.replace(/\\/g, '/');

      if (item.isDirectory) {
        const folderNode = {
          name: item.name,
          path: nodePath,
          type: 'folder',
          children: [],
        };
        nodes.push(folderNode);
        folderNode.children = traverse(path.join(dirAbs, item.name), itemRel);
        if (truncated) break;
      } else {
        nodes.push({
          name: item.name,
          path: nodePath,
          type: 'file',
        });
      }
    }

    return nodes;
  }

  const nodes = traverse(root, '');
  return { nodes, truncated };
}

/**
 * Yol parcalarinin gecerli olup olmadigini denetler.
 * Bos ad, '.', '..' ve Windows'ta yasak karakterler (<>:"|?*) reddedilir.
 */
function hasValidSegments(relPath) {
  if (typeof relPath !== 'string') return false;
  const parts = relPath.split(/[\\/]/);
  if (parts.length === 0) return false;
  for (const part of parts) {
    if (!part || !part.trim() || part === '.' || part === '..') return false;
    if (/[<>:"|?*]/.test(part)) return false;
  }
  return true;
}

/**
 * Hizli acma icin tum dosyalarin goreli yollarini dondurur.
 * buildTree ile ayni yok sayma kurallarini uygular, en fazla maxFiles dosya toplar.
 */
function listWorkspaceFiles(root, { maxFiles = 20000 } = {}) {
  const files = [];
  let truncated = false;

  function traverse(dirAbs, dirRel) {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (truncated) break;
      if (entry.isSymbolicLink()) continue;
      const itemRel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        traverse(path.join(dirAbs, entry.name), itemRel);
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        files.push(itemRel.replace(/\\/g, '/'));
      }
    }
  }

  traverse(root, '');
  return { files, truncated };
}

/**
 * Electron IPC kanallarini kaydeder.
 */
function registerWorkspaceIpc({ ipcMain, dialog, getWindow, trashItem }) {
  ipcMain.handle('workspace:open', async () => {
    try {
      const win = getWindow ? getWindow() : null;
      const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
      }
      const secilen = result.filePaths[0];
      currentRoot = fs.realpathSync(secilen);
      const tree = buildTree(currentRoot);
      return {
        root: currentRoot,
        name: path.basename(currentRoot),
        ...tree,
      };
    } catch (err) {
      return { error: err.message || 'Klasör açılamadı.' };
    }
  });

  ipcMain.handle('workspace:refresh', async () => {
    try {
      if (!currentRoot) {
        return null;
      }
      const tree = buildTree(currentRoot);
      return {
        root: currentRoot,
        name: path.basename(currentRoot),
        ...tree,
      };
    } catch (err) {
      return { error: err.message || 'Klasör yenilenemedi.' };
    }
  });

  ipcMain.handle('workspace:readFile', async (event, relPath) => {
    try {
      const targetRel = (relPath === undefined && typeof event === 'string') ? event : relPath;
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      let targetPath;
      try {
        targetPath = resolveInside(currentRoot, targetRel);
      } catch (err) {
        return { error: err.message };
      }

      let stat;
      try {
        stat = fs.statSync(targetPath);
      } catch {
        return { error: 'Dosya bulunamadı.' };
      }

      if (!stat.isFile()) {
        return { error: 'Dosya bulunamadı.' };
      }

      const MAX_FILE_SIZE = 2 * 1024 * 1024;
      if (stat.size > MAX_FILE_SIZE) {
        return { error: 'Dosya çok büyük (en fazla 2 MB).' };
      }

      const fd = fs.openSync(targetPath, 'r');
      try {
        const bufSize = Math.min(8192, stat.size);
        const buffer = Buffer.alloc(bufSize);
        fs.readSync(fd, buffer, 0, bufSize, 0);
        for (let i = 0; i < bufSize; i++) {
          if (buffer[i] === 0) {
            return { error: 'İkili dosya açılamaz.' };
          }
        }
      } finally {
        fs.closeSync(fd);
      }

      const content = fs.readFileSync(targetPath, 'utf8');
      return { path: targetRel, content };
    } catch (err) {
      return { error: err.message || 'Dosya okunamadı.' };
    }
  });

  ipcMain.handle('workspace:writeFile', async (event, arg) => {
    try {
      const data = (arg === undefined && event && typeof event === 'object' && ('path' in event || 'content' in event)) ? event : arg;
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      if (!data || typeof data.path !== 'string' || typeof data.content !== 'string') {
        return { error: 'Geçersiz parametre.' };
      }

      const MAX_FILE_SIZE = 2 * 1024 * 1024;
      const bytes = Buffer.byteLength(data.content, 'utf8');
      if (bytes > MAX_FILE_SIZE) {
        return { error: 'Dosya çok büyük (en fazla 2 MB).' };
      }

      let targetPath;
      try {
        targetPath = resolveInside(currentRoot, data.path);
      } catch (err) {
        return { error: err.message };
      }

      let stat;
      try {
        stat = fs.statSync(targetPath);
      } catch {
        return { error: 'Dosya bulunamadı.' };
      }

      if (!stat.isFile()) {
        return { error: 'Dosya bulunamadı.' };
      }

      fs.writeFileSync(targetPath, data.content, 'utf8');
      return { path: data.path, bytes };
    } catch (err) {
      return { error: err.message || 'Dosya yazılamadı.' };
    }
  });

  ipcMain.handle('workspace:createFile', async (_event, arg) => {
    try {
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      const relPath = arg && typeof arg.path === 'string' ? arg.path : null;
      if (relPath === null) {
        return { error: 'Geçersiz ad.' };
      }
      let targetPath;
      try {
        targetPath = resolveInside(currentRoot, relPath);
      } catch (err) {
        return { error: err.message };
      }
      if (!hasValidSegments(relPath)) {
        return { error: 'Geçersiz ad.' };
      }
      if (fs.existsSync(targetPath)) {
        return { error: 'Bu adda bir dosya zaten var.' };
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, '', 'utf8');
      return { path: relPath };
    } catch (err) {
      return { error: err.message || 'Dosya oluşturulamadı.' };
    }
  });

  ipcMain.handle('workspace:createFolder', async (_event, arg) => {
    try {
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      const relPath = arg && typeof arg.path === 'string' ? arg.path : null;
      if (relPath === null) {
        return { error: 'Geçersiz ad.' };
      }
      let targetPath;
      try {
        targetPath = resolveInside(currentRoot, relPath);
      } catch (err) {
        return { error: err.message };
      }
      if (!hasValidSegments(relPath)) {
        return { error: 'Geçersiz ad.' };
      }
      if (fs.existsSync(targetPath)) {
        return { error: 'Bu adda bir klasör zaten var.' };
      }
      fs.mkdirSync(targetPath, { recursive: true });
      return { path: relPath };
    } catch (err) {
      return { error: err.message || 'Klasör oluşturulamadı.' };
    }
  });

  ipcMain.handle('workspace:rename', async (_event, arg) => {
    try {
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      const fromRel = arg && typeof arg.from === 'string' ? arg.from : null;
      const toRel = arg && typeof arg.to === 'string' ? arg.to : null;
      if (fromRel === null || toRel === null) {
        return { error: 'Geçersiz ad.' };
      }
      let fromPath;
      let toPath;
      try {
        fromPath = resolveInside(currentRoot, fromRel);
        toPath = resolveInside(currentRoot, toRel);
      } catch (err) {
        return { error: err.message };
      }
      if (!hasValidSegments(fromRel) || !hasValidSegments(toRel)) {
        return { error: 'Geçersiz ad.' };
      }
      if (!fs.existsSync(fromPath)) {
        return { error: 'Dosya bulunamadı.' };
      }
      if (fs.existsSync(toPath)) {
        return { error: 'Hedefte aynı adda bir öğe var.' };
      }
      fs.mkdirSync(path.dirname(toPath), { recursive: true });
      fs.renameSync(fromPath, toPath);
      return { from: fromRel, to: toRel };
    } catch (err) {
      return { error: err.message || 'Yeniden adlandırılamadı.' };
    }
  });

  ipcMain.handle('workspace:delete', async (_event, arg) => {
    try {
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      const relPath = arg && typeof arg.path === 'string' ? arg.path : null;
      if (relPath === null) {
        return { error: 'Geçersiz ad.' };
      }
      const trimmed = relPath.trim();
      if (trimmed === '' || trimmed === '.' || trimmed === '/' || trimmed === '\\') {
        return { error: 'Kök klasör silinemez.' };
      }
      let targetPath;
      try {
        targetPath = resolveInside(currentRoot, relPath);
      } catch (err) {
        return { error: err.message };
      }
      if (targetPath === fs.realpathSync(currentRoot)) {
        return { error: 'Kök klasör silinemez.' };
      }
      if (!hasValidSegments(relPath)) {
        return { error: 'Geçersiz ad.' };
      }
      if (!fs.existsSync(targetPath)) {
        return { error: 'Dosya bulunamadı.' };
      }
      const trashFn = trashItem || ((p) => require('electron').shell.trashItem(p));
      await trashFn(targetPath);
      return { path: relPath };
    } catch (err) {
      return { error: err.message || 'Silinemedi.' };
    }
  });

  ipcMain.handle('workspace:listFiles', async () => {
    try {
      if (!currentRoot) {
        return { error: 'Önce bir klasör aç.' };
      }
      return listWorkspaceFiles(currentRoot);
    } catch (err) {
      return { error: err.message || 'Dosyalar listelenemedi.' };
    }
  });
}

module.exports = {
  registerWorkspaceIpc,
  buildTree,
  listWorkspaceFiles,
  resolveInside,
  _setCurrentRoot: (r) => { currentRoot = r; },
  _getCurrentRoot: () => currentRoot,
};
