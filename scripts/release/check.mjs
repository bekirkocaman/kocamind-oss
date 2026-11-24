import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const statusArgs = ['status', '--porcelain', '-z', '--untracked-files=all'];
const ignored = /^(?:AGENTS\.md$|\.(?:argon|sol|agents|claude)\/)/;

export function pendingChanges(status) {
  const entries = status.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const paths = [entry.slice(3)];
    if (/[RC]/.test(entry.slice(0, 2))) paths.push(entries[++i]);
    if (paths.some(path => !ignored.test(path))) changes.push(paths.join(' <- '));
  }
  return changes;
}

export function checks(android, windows = process.platform === 'win32') {
  return [
    ['Çalışma ağacı', '.', 'git', statusArgs],
    ['Backend testleri', 'backend', 'node', ['--test', 'test/*.test.js']],
    ['Web testleri', 'kocamind-web', 'npx', ['vitest', 'run']],
    ['Web lint', 'kocamind-web', 'npx', ['eslint', '.']],
    ['Web derleme', 'kocamind-web', 'npm', ['run', 'build']],
    ...(android ? [['Android testleri', 'kocamind-android',
      windows ? 'gradlew.bat' : './gradlew', ['testDebugUnitTest']]] : []),
  ];
}

function runCheck(dir, command, args) {
  const cwd = join(root, dir);
  if (command === 'git') {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
    const changes = pendingChanges(result.stdout);
    if (changes.length) throw new Error(`Bekleyen değişiklikler:\n${changes.join('\n')}`);
    return;
  }
  if (command === 'node') {
    const files = readdirSync(join(cwd, 'test'), { withFileTypes: true })
      .filter(file => file.isFile() && file.name.endsWith('.test.js'))
      .map(file => join('test', file.name)).sort();
    if (!files.length) throw new Error('Backend test dosyası bulunamadı.');
    args = ['--test', ...files];
    command = process.execPath;
  }
  const shell = process.platform === 'win32' && ['npm', 'npx', 'gradlew.bat'].includes(command);
  const result = spawnSync(command, args, { cwd, shell, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Komut başarısız (${result.signal ?? result.status}).`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--android', '--dry-run'].includes(flag))) {
    console.error('Kullanım: node scripts/release/check.mjs [--android] [--dry-run]');
    process.exitCode = 1;
  } else {
    const plan = checks(flags.includes('--android'));
    if (flags.includes('--dry-run')) {
      for (const [, dir, command, args] of plan) console.log(`[${dir}] ${command} ${args.join(' ')}`);
    } else {
      const summary = [];
      for (const [name, dir, command, args] of plan) {
        let status = 'Atlandı';
        if (!process.exitCode) {
          try {
            runCheck(dir, command, args);
            status = 'Başarılı';
          } catch (error) {
            console.error(`[${name}] ${error.message}`);
            status = 'Başarısız';
            process.exitCode = 1;
          }
        }
        summary.push({ Kontrol: name, Sonuç: status });
      }
      console.table(summary);
    }
  }
}
