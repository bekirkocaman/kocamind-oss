import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './check.mjs';

const bumps = ['major', 'minor', 'patch'];
const gradleName = /^([ \t]*versionName(?:[ \t]*=[ \t]*|[ \t]+))(["'])([^"'\r\n]+)\2(?=[ \t]*(?:\/\/[^\r\n]*)?\r?$)/m;
const gradleCode = /^([ \t]*versionCode(?:[ \t]*=[ \t]*|[ \t]+))(\d+)(?=[ \t]*(?:\/\/[^\r\n]*)?\r?$)/m;

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Geçersiz kararlı SemVer: ${version}`);
  }
  return version.split('.').map(BigInt);
}

export function bumpVersion(version, bump) {
  const index = bumps.indexOf(bump);
  if (index < 0) throw new Error(`Geçersiz artış: ${bump}`);
  return versionParts(version).map((value, i) =>
    i < index ? value : i === index ? value + 1n : 0n).join('.');
}

export function updateGradle(source, version) {
  const code = source.match(gradleCode);
  if (!source.match(gradleName) || !code) throw new Error('Gradle sürüm alanları bulunamadı.');
  const nextCode = BigInt(code[2]) + 1n;
  if (nextCode > 2100000000n) throw new Error('Android versionCode yayın sınırı aşıldı.');
  return source
    .replace(gradleName, (_, prefix, quote) => `${prefix}${quote}${version}${quote}`)
    .replace(gradleCode, (_, prefix) => `${prefix}${nextCode}`);
}

export function changelogEntry(version, date, commits, eol = '\n') {
  const items = commits.trimEnd() ? commits.trimEnd().split(/\r?\n/).map(line => `- ${line}`)
    : ['- Bu aralıkta yeni commit yok.'];
  return [`## ${version} (${date})`, '', ...items, '', ''].join(eol);
}

export function releaseCommits(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
  const semverTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
  const tags = git('tag', '--merged', 'HEAD', '--list', 'v*').split(/\r?\n/).filter(tag => {
    const match = semverTag.exec(tag);
    return match && !match[1]?.split('.').some(identifier => /^0\d+$/.test(identifier));
  });
  const tag = tags.length
    ? git('describe', '--tags', '--abbrev=0', ...tags.flatMap(name => ['--match', name]), 'HEAD')
    : null;
  return git('log', '--oneline', tag ? `refs/tags/${tag}..HEAD` : 'HEAD', '--');
}

function updatePackage(source, version) {
  // Track JSON nesting so a nested version or escaped key cannot be mistaken for the root field.
  let depth = 0;
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g;
  for (const token of source.matchAll(tokens)) {
    if (token[0] === '{' || token[0] === '[') depth++;
    if (token[0] === '}' || token[0] === ']') depth--;
    if (depth !== 1 || token[0][0] !== '"' || JSON.parse(token[0]) !== 'version') continue;
    const start = token.index + token[0].length;
    const field = source.slice(start).match(/^(\s*:\s*)"(?:\\[\s\S]|[^"\\])*"/);
    if (field) return source.slice(0, start) + field[1] + JSON.stringify(version) + source.slice(start + field[0].length);
  }
  throw new Error('package.json sürüm alanı bulunamadı.');
}

function run(flags) {
  const selected = flags.filter(flag => bumps.includes(flag.slice(2)) && flag.startsWith('--'));
  if (selected.length !== 1 || flags.some(flag => flag !== '--dry-run' && flag !== selected[0])) {
    throw new Error('Kullanım: node scripts/release/version.mjs (--patch|--minor|--major) [--dry-run]');
  }
  const gradleBase = 'kocamind-android/app/build.gradle';
  const gradlePath = existsSync(join(root, gradleBase + '.kts')) ? gradleBase + '.kts' : gradleBase;
  const paths = ['backend/package.json', 'kocamind-web/package.json', gradlePath, 'CHANGELOG.md'];
  const [backend, web, gradle, changelog] = paths.map((path, index) => {
    const absolute = join(root, path);
    return index === 3 && !existsSync(absolute) ? null : readFileSync(absolute, 'utf8');
  });
  const versions = [backend, web].map(source => JSON.parse(source.replace(/^\uFEFF/, '')).version);
  versions.push(gradle.match(gradleName)?.[3]);
  const highest = versions.reduce((latest, candidate) => {
    const previous = versionParts(latest);
    const current = versionParts(candidate);
    const index = current.findIndex((value, i) => value !== previous[i]);
    return index !== -1 && current[index] > previous[index] ? candidate : latest;
  });
  const version = bumpVersion(highest, selected[0].slice(2));
  const eol = changelog?.includes('\r\n') ? '\r\n' : '\n';
  const content = changelog ?? '';
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = content.slice(bom.length);
  const title = body.match(/^# [^\r\n]+(?:\r?\n)*/)?.[0] ?? '';
  const heading = title ? title.trimEnd() : '# Changelog';
  const entry = changelogEntry(version, new Date().toISOString().slice(0, 10), releaseCommits(root), eol);
  const before = [backend, web, gradle, changelog];
  const after = [
    updatePackage(backend, version), updatePackage(web, version),
    updateGradle(gradle, version), bom + heading + eol + eol + entry + body.slice(title.length),
  ];
  if (flags.includes('--dry-run')) {
    for (let i = 0; i < 3; i++) {
      console.log(paths[i]);
      const lines = before[i].split(/\r?\n/);
      after[i].split(/\r?\n/).forEach((line, index) => {
        if (line !== lines[index]) console.log(`- ${lines[index]}\n+ ${line}`);
      });
    }
    console.log(`CHANGELOG.md\n${(title ? entry : heading + eol + eol + entry).trimEnd().split(/\r?\n/)
      .map(line => '+ ' + line).join('\n')}`);
    return;
  }
  const written = [];
  try {
    for (const [index, path] of paths.entries()) {
      const absolute = join(root, path);
      written.push(index);
      writeFileSync(absolute, after[index]);
    }
  } catch (error) {
    for (const index of written.reverse()) {
      const absolute = join(root, paths[index]);
      try {
        if (before[index] === null) {
          if (existsSync(absolute)) unlinkSync(absolute);
        } else {
          writeFileSync(absolute, before[index]);
        }
      } catch (restoreError) {
        console.error(`Geri yüklenemedi: ${paths[index]} (${restoreError.message})`);
      }
    }
    throw error;
  }
  console.log(`Yayın sürümü: ${version}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
