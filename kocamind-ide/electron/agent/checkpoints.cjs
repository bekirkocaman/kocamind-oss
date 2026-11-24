'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_LIST_TURNS = 50;

function createCheckpoints({ dir, sessionId }) {
  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) {
    throw new Error(`Geçersiz oturum kimliği: ${sessionId}`);
  }
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new Error(`Geçersiz klasör: ${dir}`);
  }

  const sessionDir = path.join(dir, sessionId);
  let currentTurn = null;

  function begin(turnId) {
    if (typeof turnId !== 'string' || !ID_RE.test(turnId)) {
      throw new Error(`Geçersiz tur kimliği: ${turnId}`);
    }

    const turnDir = path.join(sessionDir, turnId);
    const at = new Date().toISOString();
    currentTurn = {
      turnId,
      dir: turnDir,
      at,
      files: [],
      recordedPaths: new Set(),
      order: 0,
    };
  }

  function record(absPath, relPath) {
    if (!currentTurn) {
      return false;
    }

    if (currentTurn.recordedPaths.has(relPath)) {
      return false;
    }

    let existed = false;
    let content = null;

    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        return false;
      }
      if (stat.size > MAX_RECORD_BYTES) {
        return false;
      }
      content = fs.readFileSync(absPath, 'utf8');
      existed = true;
    }

    fs.mkdirSync(currentTurn.dir, { recursive: true });
    currentTurn.recordedPaths.add(relPath);
    currentTurn.order += 1;
    currentTurn.files.push(relPath);

    const recordFile = path.join(currentTurn.dir, `${currentTurn.order}.json`);
    fs.writeFileSync(
      recordFile,
      JSON.stringify({ relPath, existed, content }),
      'utf8'
    );

    const manifestPath = path.join(currentTurn.dir, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        turnId: currentTurn.turnId,
        at: currentTurn.at,
        files: currentTurn.files,
      }),
      'utf8'
    );

    return true;
  }

  function list() {
    if (!fs.existsSync(sessionDir)) {
      return [];
    }

    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    const turns = [];

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const turnDir = path.join(sessionDir, ent.name);
      const manifestPath = path.join(turnDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.turnId) {
          turns.push({
            turnId: parsed.turnId,
            at: parsed.at || new Date().toISOString(),
            files: Array.isArray(parsed.files) ? parsed.files : [],
            mtimeMs: fs.statSync(manifestPath).mtimeMs,
          });
        }
      } catch {}
    }

    // Yeniden eskiye sırala (at zaman damgası ve mtime'a göre)
    turns.sort((a, b) => {
      const timeDiff = new Date(b.at).getTime() - new Date(a.at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.mtimeMs - a.mtimeMs;
    });

    return turns.slice(0, MAX_LIST_TURNS).map(({ turnId, at, files }) => ({
      turnId,
      at,
      files,
    }));
  }

  function revertLast(workspace) {
    if (!workspace || typeof workspace.resolve !== 'function') {
      throw new Error('Geçersiz çalışma alanı (workspace).');
    }

    const turns = list();
    // Dosya kaydı boş olan turları atla
    let targetTurn = null;
    const skippedTurns = [];
    for (const turn of turns) {
      if (!turn.files || turn.files.length === 0) {
        skippedTurns.push(turn);
      } else {
        targetTurn = turn;
        break;
      }
    }

    // Boş turları temizle
    for (const emptyTurn of skippedTurns) {
      const emptyDir = path.join(sessionDir, emptyTurn.turnId);
      try {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      } catch {}
    }

    if (!targetTurn) {
      throw new Error('Geri alınacak değişiklik yok.');
    }

    const turnDir = path.join(sessionDir, targetTurn.turnId);

    // Turn klasöründeki <sira>.json dosyalarını oku
    const files = fs.readdirSync(turnDir);
    const orderFiles = files
      .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
      .sort((a, b) => {
        const numA = parseInt(a, 10);
        const numB = parseInt(b, 10);
        return numB - numA; // Ters sırada geri al
      });

    // 1. Aşama: Bütün dosyaları geçici dosyalara yaz ve hedef yolları doğrula
    const staged = [];
    const tempFiles = [];
    try {
      for (let i = 0; i < orderFiles.length; i++) {
        const file = orderFiles[i];
        const filePath = path.join(turnDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const absPath = workspace.resolve(data.relPath);

        if (data.existed) {
          if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
            throw new Error(`Hedef bir klasör: ${data.relPath}`);
          }
          const parentDir = path.dirname(absPath);
          fs.mkdirSync(parentDir, { recursive: true });
          const tempPath = path.join(
            parentDir,
            `.km-revert-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.tmp`
          );
          fs.writeFileSync(tempPath, data.content, 'utf8');
          tempFiles.push(tempPath);
          staged.push({ type: 'restore', tempPath, absPath, relPath: data.relPath });
        } else {
          if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
            throw new Error(`Hedef bir klasör: ${data.relPath}`);
          }
          staged.push({ type: 'delete', absPath, relPath: data.relPath });
        }
      }
    } catch (err) {
      // Bir hata olursa geçici dosyaları temizle, hiçbir dosyayı değiştirme, tur kaydını koru
      for (const tmp of tempFiles) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
      throw err;
    }

    // 2. Aşama: Hepsi başarılıysa yerlerine taşı veya sil
    for (const item of staged) {
      if (item.type === 'restore') {
        fs.renameSync(item.tempPath, item.absPath);
      } else if (item.type === 'delete') {
        if (fs.existsSync(item.absPath)) {
          const stat = fs.statSync(item.absPath);
          if (!stat.isDirectory()) {
            fs.unlinkSync(item.absPath);
          }
        }
      }
    }

    fs.rmSync(turnDir, { recursive: true, force: true });

    if (currentTurn) {
      if (
        currentTurn.turnId === targetTurn.turnId ||
        skippedTurns.some((st) => st.turnId === currentTurn.turnId)
      ) {
        currentTurn = null;
      }
    }

    return {
      turnId: targetTurn.turnId,
      restored: targetTurn.files,
    };
  }

  return {
    begin,
    record,
    list,
    revertLast,
  };
}

module.exports = {
  createCheckpoints,
  MAX_RECORD_BYTES,
  MAX_LIST_TURNS,
};
