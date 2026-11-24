import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checks, pendingChanges, root } from './check.mjs';
import { isBlockedEnvPath, tarExtractionArgs } from './package-deploy.mjs';
import { bumpVersion, changelogEntry, releaseCommits, updateGradle } from './version.mjs';

test('Paketleme yalnızca tam .env şablon adlarına izin verir', () => {
  for (const path of ['backend/.env.example', '.env.sample', 'web/.ENV.TEMPLATE', 'src/config.env']) {
    assert.equal(isBlockedEnvPath(path), false, path);
  }
  for (const path of [
    '.env', 'backend/.ENV.LOCAL', 'web/.env.production', '.env.development.local',
    '.env/.env.example', 'web/.env.sample/config', '.env.example.local', '.env.template.',
  ]) {
    assert.equal(isBlockedEnvPath(path), true, path);
  }
});

test('Tar çıkarma komutu sürücü harfi içermeyen göreli yollar kullanır', () => {
  assert.deepEqual(tarExtractionArgs(), ['-xf', 'source.tar', '-C', 'source']);
});

test('Paketleme CLI hatasında çıkış kodu 1 döner', () => {
  const result = spawnSync(process.execPath, ['scripts/release/package-deploy.mjs', '--invalid'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Kullanım:/);
});

test('SemVer artışı alt bileşenleri sıfırlar', () => {
  assert.equal(bumpVersion('2.3.4', 'patch'), '2.3.5');
  assert.equal(bumpVersion('2.3.4', 'minor'), '2.4.0');
  assert.equal(bumpVersion('2.3.4', 'major'), '3.0.0');
  assert.throws(() => bumpVersion('2.03.4', 'patch'));
  assert.throws(() => bumpVersion('2.3.4', 'invalid'));
});

test('Gradle Kotlin ve Groovy biçimini ve satır sonlarını korur', () => {
  assert.equal(
    updateGradle('    versionCode = 9\r\n    versionName = "2.0.0" // release\r\n', '2.0.1'),
    '    versionCode = 10\r\n    versionName = "2.0.1" // release\r\n',
  );
  assert.equal(updateGradle("  versionCode 9\n  versionName '2.0.0'", '2.0.1'),
    "  versionCode 10\n  versionName '2.0.1'");
  assert.throws(() => updateGradle('versionCode = 9', '2.0.1'));
});

test('Changelog sürüm, tarih ve commit satırlarını içerir', () => {
  assert.equal(changelogEntry('2.0.1', '2026-11-19', '1234 İlk\n5678 İkinci\n', '\r\n'),
    '## 2.0.1 (2026-11-19)\r\n\r\n- 1234 İlk\r\n- 5678 İkinci\r\n\r\n');
  assert.match(changelogEntry('2.0.1', '2026-11-19', ''), /yeni commit yok/);
});

test('Changelog kök commit’i içerir ve yalnızca v önekli SemVer etiketlerinde kesilir', () => {
  const tempRoot = realpathSync(tmpdir());
  const cwd = mkdtempSync(join(tempRoot, 'kocamind-changelog-test-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
  const commit = message => git('-c', 'user.name=Release Test', '-c', 'user.email=release@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', message);
  const subjects = () => releaseCommits(cwd).split(/\r?\n/).filter(Boolean).map(line => line.slice(line.indexOf(' ') + 1));
  try {
    git('init', '-q');
    commit('Root commit');
    assert.deepEqual(subjects(), ['Root commit']);

    git('tag', 'v1.2.3');
    commit('After stable release');
    for (const tag of ['backup', '2.0.0', 'v-next', 'v2.0', 'v02.0.0', 'v2.0.0-rc.01']) git('tag', tag);
    commit('Latest change');
    assert.deepEqual(subjects(), ['Latest change', 'After stable release']);

    git('tag', 'v2.0.0-rc.1+build.01');
    assert.deepEqual(subjects(), []);
    commit('After prerelease');
    assert.deepEqual(subjects(), ['After prerelease']);
  } finally {
    const resolved = realpathSync(cwd);
    if (resolved !== cwd || dirname(resolved) !== tempRoot) throw new Error(`Geçici klasörün konumu değişti: ${resolved}`);
    rmSync(resolved, { recursive: true });
  }
});

test('Porcelain filtresi sadece belirtilen kök yolları hariç tutar', () => {
  assert.deepEqual(pendingChanges([
    '?? .argon/task', ' M .sol/plan', '?? .agents/skill', '?? AGENTS.md',
    ' M .claude/launch.json', ' M backend/AGENTS.md', '?? .sol-extra/a',
    'R  .sol/new-name', 'src/old name', 'R  .claude/new', '.agents/old', '',
  ].join('\0')), ['backend/AGENTS.md', '.sol-extra/a', '.sol/new-name <- src/old name']);
});

test('Dry-run yayın kontrollerini sırayla listeler ve Android isteğe bağlıdır', () => {
  const dryRun = (...args) => execFileSync(process.execPath,
    ['scripts/release/check.mjs', '--dry-run', ...args], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/);
  const expected = [
    '[.] git status --porcelain -z --untracked-files=all',
    '[backend] node --test test/*.test.js',
    '[kocamind-web] npx vitest run',
    '[kocamind-web] npx eslint .',
    '[kocamind-web] npm run build',
  ];
  assert.deepEqual(dryRun(), expected);
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  assert.deepEqual(dryRun('--android'), [...expected, `[kocamind-android] ${wrapper} testDebugUnitTest`]);
  assert.equal(checks(true, false).at(-1)[2], './gradlew');
});
