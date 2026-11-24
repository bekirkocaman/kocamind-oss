import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './check.mjs';

const projects = ['backend', 'kocamind-web'];
const quote = value => process.platform === 'win32'
  ? `"${value}"`
  : "'" + value.replaceAll("'", "'\\''") + "'";

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

const envTemplates = new Set(['.env.example', '.env.sample', '.env.template']);

export function isBlockedEnvPath(path) {
  const segments = path.toLowerCase().split('/');
  return segments.some((segment, index) =>
    (segment === '.env' || segment.startsWith('.env.'))
    && (index !== segments.length - 1 || !envTemplates.has(segment)));
}

export function tarExtractionArgs() {
  return ['-xf', 'source.tar', '-C', 'source'];
}

function run(flags) {
  if (flags.length > 1 || flags.some(flag => !['--keep', '--dry-run'].includes(flag))) {
    throw new Error('Kullanım: node scripts/release/package-deploy.mjs [--dry-run|--keep]');
  }
  const revision = git('rev-parse', '--verify', 'HEAD').trim();
  const files = git('ls-tree', '-r', '--name-only', '-z', revision).split('\0');
  if (files.some(isBlockedEnvPath)) {
    throw new Error('HEAD içinde izlenen .env dosyası veya klasörü var. Arşiv oluşturulmadı.');
  }

  const tempRoot = realpathSync(tmpdir());
  const temp = mkdtempSync(join(tempRoot, 'kocamind-release-'));
  let keep = false;
  try {
    const archive = join(temp, 'source.tar');
    const source = join(temp, 'source');
    mkdirSync(source);
    // Resolve HEAD once so packaging and the tracked-file check use the same commit.
    execFileSync('git', ['archive', '--format=tar', '--output', archive, revision], { cwd: root });
    execFileSync('tar', tarExtractionArgs(), { cwd: temp });
    unlinkSync(archive);
    for (const project of projects) {
      if (!statSync(join(source, project, 'vercel.json'), { throwIfNoEntry: false })?.isFile()) {
        throw new Error(`Arşivde ${project}/vercel.json bulunamadı.`);
      }
    }
    console.log(`Kaynak commit: ${revision}`);
    console.log('Her klasörü mevcut Vercel projesine bağla ve yayın öncesi Production URL’sini kaydet:');
    for (const project of projects) {
      const cwd = quote(join(source, project));
      console.log(`vercel link --cwd ${cwd}`);
      console.log(`vercel list --prod --cwd ${cwd}`);
    }
    console.log('Aynı kaynak commit ile backend ve web’i sırayla yayınla:');
    for (const project of projects) console.log(`vercel deploy --prod --cwd ${quote(join(source, project))}`);
    console.log('Geri alma (her proje için kaydedilen URL ile):');
    for (const project of projects) {
      const cwd = quote(join(source, project));
      console.log(`vercel rollback "<onceki-url>" --cwd ${cwd}`);
      console.log(`vercel promote "<onceki-url>" --cwd ${cwd}`);
    }
    keep = flags.includes('--keep');
    if (keep) console.log(`Geçici klasör: ${temp}`);
  } finally {
    if (!keep) {
      const resolved = realpathSync(temp);
      if (resolved !== temp || dirname(resolved) !== tempRoot) {
        throw new Error(`Geçici klasörün konumu değişti: ${resolved}`);
      }
      rmSync(resolved, { recursive: true });
      console.log('Geçici arşiv silindi. Yayın için komutları --keep ile yeniden üret.');
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
