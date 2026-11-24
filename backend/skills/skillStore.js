// Skill deposu: backend/skills/<ad>/SKILL.md klasörlerini okur. Skill kod değil,
// modelin gerektiğinde yüklediği talimat paketidir. Yalnızca repodan gelir;
// kullanıcının internetten kurduğu skill'ler ayrıdır (skills/userSkills.js). Ayrıntı: docs/superpowers/specs/2026-10-12-skills-design.md
const fs = require('fs');
const path = require('path');

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE_PATTERN = /^[a-z0-9][a-z0-9._-]*\.md$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 200;
const DEFAULT_MAX_CHARS = 20000;

function parseScalar(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map(item => parseScalar(item)).filter(item => item !== '');
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// YAML'ın yalnızca ihtiyaç duyduğumuz alt kümesi: `anahtar: değer`, `[a, b]` listeleri, true/false.
function parseFrontmatter(text) {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    data[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }
  return { data, body: match[2] };
}

// Aksanları ve Türkçe harfleri sadeleştirir: "DİLEKÇE" → "dilekce".
function normalizeText(text) {
  return String(text || '')
    .replace(/İ/g, 'i').replace(/I/g, 'ı')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function truncate(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(kısaltıldı)` : text;
}

// SKILL.md metnini doğrular. Repodaki skill'ler ve internetten kurulanlar aynı kuralları kullanır.
function validateSkillDocument(raw, { expectedName, maxDescription = MAX_DESCRIPTION } = {}) {
  const parsed = parseFrontmatter(raw);
  if (!parsed) throw new Error('frontmatter (--- ... ---) yok');
  const { name, title, description, assistants, autoload } = parsed.data;
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > MAX_NAME) throw new Error('geçersiz name');
  if (expectedName !== undefined && name !== expectedName) throw new Error(`name (${name}) klasör adıyla aynı değil`);
  if (typeof description !== 'string' || !description.trim() || description.length > maxDescription) {
    throw new Error(`description zorunlu ve en fazla ${maxDescription} karakter`);
  }
  if (assistants !== undefined && !Array.isArray(assistants)) throw new Error('assistants liste olmalı');
  if (autoload !== undefined && typeof autoload !== 'boolean') throw new Error('autoload true/false olmalı');
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > MAX_NAME)) throw new Error('title en fazla 64 karakter');
  return {
    name,
    title: title ? title.trim() : name,
    description: description.trim(),
    assistants: assistants && assistants.length ? assistants.map(String) : ['*'],
    autoload: autoload === true,
    body: parsed.body.trim(),
  };
}

function loadSkill(root, dirName, { maxChars }) {
  const dir = path.join(root, dirName);
  const skill = validateSkillDocument(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), { expectedName: dirName });
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'SKILL.md' && FILE_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort();
  return { ...skill, body: truncate(skill.body, maxChars), files, dir };
}

// Ad ve açıklamaya göre puanlar; repodaki ve kullanıcının kurduğu skill'ler için ortak.
function rankSkills(skills, query, limit = 5) {
  const words = normalizeText(query).split(/[^a-z0-9]+/).filter(word => word.length >= 2);
  if (!words.length) return [];
  return skills
    .map(skill => {
      const name = normalizeText(skill.name);
      const description = normalizeText(skill.description);
      let score = 0;
      for (const word of words) {
        if (name.includes(word)) score += 3;
        if (description.includes(word)) score += 2;
        else if (word.length >= 4 && description.includes(word.slice(0, -1))) score += 1;
      }
      return { skill, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map(item => item.skill);
}

function createSkillStore({ root = __dirname, maxChars = DEFAULT_MAX_CHARS, warn = message => console.warn(message) } = {}) {
  const skills = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    warn(`[skills] klasör okunamadı: ${error.message}`);
  }
  for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!fs.existsSync(path.join(root, entry.name, 'SKILL.md'))) continue;
    try {
      const skill = loadSkill(root, entry.name, { maxChars });
      skills.set(skill.name, skill);
    } catch (error) {
      warn(`[skills] ${entry.name} atlandı: ${error.message}`);
    }
  }

  const appliesTo = (skill, assistant) => !assistant || skill.assistants.includes('*') || skill.assistants.includes(assistant);

  function list({ assistant, excludeAutoload = false } = {}) {
    // Autoload skill zaten sistem prompt'unda olduğu için katalogda tekrarlanmaz.
    const preloaded = skill => excludeAutoload && skill.autoload && Boolean(assistant) && skill.assistants.includes(assistant);
    return [...skills.values()].filter(skill => appliesTo(skill, assistant) && !preloaded(skill));
  }

  function get(name) {
    return typeof name === 'string' && skills.has(name) ? skills.get(name) : null;
  }

  function readFile(name, file) {
    const skill = get(name);
    if (!skill) throw new Error('Skill bulunamadı.');
    if (typeof file !== 'string' || !FILE_PATTERN.test(file) || file.includes('..')) {
      throw new Error('Geçersiz dosya adı.');
    }
    if (!skill.files.includes(file)) throw new Error('Dosya bulunamadı.');
    const full = path.resolve(skill.dir, file);
    if (path.dirname(full) !== path.resolve(skill.dir)) throw new Error('Geçersiz dosya adı.');
    return truncate(fs.readFileSync(full, 'utf8').trim(), maxChars);
  }

  function search(query, { assistant, limit = 5 } = {}) {
    return rankSkills(list({ assistant }), query, limit);
  }

  function autoloadFor(assistant) {
    if (!assistant) return [];
    return [...skills.values()].filter(skill => skill.autoload && skill.assistants.includes(assistant));
  }

  return { list, get, readFile, search, autoloadFor, size: () => skills.size };
}

module.exports = { createSkillStore, parseFrontmatter, normalizeText, validateSkillDocument, rankSkills, NAME_PATTERN, FILE_PATTERN, MAX_DESCRIPTION };
