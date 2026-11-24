// İnternetten skill indirir ve doğrular. Skill yalnızca metindir (SKILL.md ve ek .md
// dosyaları); script, ikili dosya veya alt klasör indirilmez, hiçbir şey çalıştırılmaz.
// Kabul edilen adresler:
//   - GitHub dosyası:  https://github.com/<sahip>/<repo>/blob/<dal>/<yol>/SKILL.md
//   - GitHub klasörü:  https://github.com/<sahip>/<repo>/tree/<dal>/<yol>  (ya da repo kökü)
//   - Doğrudan metin:  https://.../SKILL.md (raw.githubusercontent.com, gist raw vb.)
const crypto = require('crypto');
const { validateSkillDocument, FILE_PATTERN, MAX_DESCRIPTION } = require('./skillStore');

const LIMITS = Object.freeze({
  skillBytes: 100 * 1024,
  fileBytes: 100 * 1024,
  totalBytes: 400 * 1024,
  extraFiles: 10,
  listingBytes: 200 * 1024,
});
// Anthropic biçimindeki skill'lerde açıklama 1024 karaktere kadar çıkabilir; katalogda kısaltılır.
const MAX_SOURCE_DESCRIPTION = 1024;
const TEXT_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream'];
const GITHUB_PART = /^[A-Za-z0-9_.-]+$/;

function installError(message) {
  const error = new Error(message);
  error.code = 'SKILL_INSTALL';
  return error;
}

function parseUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw installError('Geçersiz adres.');
  }
  if (url.protocol !== 'https:') throw installError('Yalnızca https:// adresleri kabul edilir.');
  if (url.username || url.password) throw installError('Adreste kullanıcı adı veya parola olamaz.');
  return url;
}

// Adresi indirme planına çevirir.
function resolveSkillSource(rawUrl) {
  const url = parseUrl(rawUrl);
  if (url.hostname !== 'github.com') return { kind: 'file', url: url.toString() };

  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [owner, repo, mode, ref, ...rest] = parts;
  if (!owner || !repo || !GITHUB_PART.test(owner) || !GITHUB_PART.test(repo.replace(/\.git$/, ''))) {
    throw installError('GitHub adresi tanınmadı.');
  }
  const cleanRepo = repo.replace(/\.git$/, '');
  if (rest.some(part => part === '..' || part === '.')) throw installError('Geçersiz GitHub yolu.');
  if (!mode) return { kind: 'github-dir', owner, repo: cleanRepo, ref: null, path: '' };
  if (!ref || !GITHUB_PART.test(ref)) throw installError('GitHub dal adı tanınmadı.');
  if (mode === 'blob') {
    if (!rest.length || !/\.md$/i.test(rest[rest.length - 1])) throw installError('GitHub dosyası bir .md dosyası olmalı.');
    const raw = new URL(`https://raw.githubusercontent.com/${owner}/${cleanRepo}/${ref}/`);
    raw.pathname += rest.map(encodeURIComponent).join('/');
    return { kind: 'file', url: raw.toString() };
  }
  if (mode === 'tree') return { kind: 'github-dir', owner, repo: cleanRepo, ref, path: rest.join('/') };
  throw installError('GitHub adresi bir dosya (blob) ya da klasör (tree) göstermeli.');
}

// Gövdeyi sınırı aşmadan okur; Content-Length yalan söylese de akış ortasında keser.
async function readLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw installError(`Dosya çok büyük (en fazla ${Math.round(maxBytes / 1024)} KB).`);
  const body = response.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        body.destroy?.();
        throw installError(`Dosya çok büyük (en fazla ${Math.round(maxBytes / 1024)} KB).`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw installError(`Dosya çok büyük (en fazla ${Math.round(maxBytes / 1024)} KB).`);
  return text;
}

function assertTextResponse(response, label) {
  if (!response.ok) throw installError(`${label} indirilemedi (HTTP ${response.status}).`);
  const type = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type && !TEXT_TYPES.includes(type)) {
    throw installError(`${label} düz metin değil (${type}). SKILL.md dosyasının ham (raw) adresini ver.`);
  }
}

async function downloadText(fetchPage, url, maxBytes, label) {
  const response = await fetchPage(url, { timeout: 15000, headers: { 'User-Agent': 'KocaMind-Skill/1.0', Accept: 'text/plain, text/markdown' } });
  assertTextResponse(response, label);
  const text = await readLimited(response, maxBytes);
  if (text.includes('\u0000')) throw installError(`${label} ikili (binary) dosya; yalnızca metin kabul edilir.`);
  return text;
}

async function downloadGithubDir(fetchPage, source) {
  const api = new URL(`https://api.github.com/repos/${source.owner}/${source.repo}/contents`);
  if (source.path) api.pathname += `/${source.path.split('/').map(encodeURIComponent).join('/')}`;
  if (source.ref) api.searchParams.set('ref', source.ref);
  const response = await fetchPage(api.toString(), { timeout: 15000, headers: { 'User-Agent': 'KocaMind-Skill/1.0', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw installError(`GitHub klasörü okunamadı (HTTP ${response.status}).`);
  let listing;
  try {
    listing = JSON.parse(await readLimited(response, LIMITS.listingBytes));
  } catch (error) {
    if (error.code === 'SKILL_INSTALL') throw error;
    throw installError('GitHub klasör listesi okunamadı.');
  }
  if (!Array.isArray(listing)) throw installError('Adres bir klasör göstermiyor.');

  const rawUrl = entry => {
    const url = typeof entry.download_url === 'string' ? parseUrl(entry.download_url) : null;
    if (!url || url.hostname !== 'raw.githubusercontent.com') throw installError('GitHub dosya adresi beklenmedik.');
    return url.toString();
  };
  const skillEntry = listing.find(entry => entry?.type === 'file' && entry.name === 'SKILL.md');
  if (!skillEntry) throw installError('Klasörde SKILL.md bulunamadı.');
  const skillText = await downloadText(fetchPage, rawUrl(skillEntry), LIMITS.skillBytes, 'SKILL.md');

  const files = [];
  const skipped = [];
  let total = Buffer.byteLength(skillText, 'utf8');
  for (const entry of listing) {
    if (!entry || entry === skillEntry) continue;
    const name = String(entry.name || '');
    const isMarkdown = entry.type === 'file' && FILE_PATTERN.test(name);
    if (!isMarkdown || files.length >= LIMITS.extraFiles || Number(entry.size) > LIMITS.fileBytes) {
      skipped.push(entry.type === 'dir' ? `${name}/` : name);
      continue;
    }
    const content = await downloadText(fetchPage, rawUrl(entry), LIMITS.fileBytes, name);
    total += Buffer.byteLength(content, 'utf8');
    if (total > LIMITS.totalBytes) throw installError(`Skill toplamda çok büyük (en fazla ${LIMITS.totalBytes / 1024} KB).`);
    files.push({ name, content });
  }
  return { skillText, files, skipped };
}

/**
 * Skill'i indirir ve doğrular; hiçbir yere yazmaz.
 * @param {string} rawUrl
 * @param {{ fetchPage: (url: string, options: object) => Promise<Response> }} deps
 *   fetchPage SSRF korumalı olmalı (agent/tools.js fetchPublicPage).
 */
async function downloadSkill(rawUrl, { fetchPage }) {
  const source = resolveSkillSource(rawUrl);
  const { skillText, files, skipped } = source.kind === 'github-dir'
    ? await downloadGithubDir(fetchPage, source)
    : { skillText: await downloadText(fetchPage, source.url, LIMITS.skillBytes, 'SKILL.md'), files: [], skipped: [] };

  let skill;
  try {
    skill = validateSkillDocument(skillText, { maxDescription: MAX_SOURCE_DESCRIPTION });
  } catch (error) {
    throw installError(`SKILL.md geçersiz: ${error.message}.`);
  }
  if (!skill.body) throw installError('SKILL.md talimat içermiyor.');
  const description = skill.description.length > MAX_DESCRIPTION
    ? `${skill.description.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`
    : skill.description;
  const hash = crypto.createHash('sha256').update(skillText);
  for (const file of files) hash.update(`\n${file.name}\n${file.content}`);

  return {
    name: skill.name,
    title: skill.title,
    description,
    assistants: skill.assistants.filter(item => typeof item === 'string' && item.length <= 40).slice(0, 10),
    body: skill.body,
    files,
    skippedFiles: skipped,
    sourceUrl: parseUrl(rawUrl).toString(),
    sha256: hash.digest('hex'),
  };
}

module.exports = { downloadSkill, resolveSkillSource, readLimited, LIMITS };
