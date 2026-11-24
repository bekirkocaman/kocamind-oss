'use strict';

const fs = require('node:fs');
const { listProjectSkills, parseFrontmatter, SKILL_NAME_RE } = require('../projectContext.cjs');

const ALLOWED_KEYS = new Set(['name']);
const MAX_BODY_CHARS = 40000;

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  if (raw.name === undefined || raw.name === null) {
    throw new Error('Eksik alan: name');
  }
  if (typeof raw.name !== 'string' || !SKILL_NAME_RE.test(raw.name)) {
    throw new Error('Geçersiz alan: name');
  }
  return { name: raw.name };
}

function createLoadSkillTool({ workspace }) {
  async function execute(args, ctx) {
    const ws = (ctx && ctx.workspace) || workspace;
    const skills = listProjectSkills(ws);
    const target = skills.find((s) => s.name === args.name);
    if (!target) {
      throw new Error(`Skill bulunamadı: ${args.name}`);
    }

    const absPath = ws.resolve(target.path);
    const raw = fs.readFileSync(absPath, 'utf8');
    const { body } = parseFrontmatter(raw);
    const trimmedBody = body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;

    return {
      name: target.name,
      body: trimmedBody,
    };
  }

  return {
    name: 'load_skill',
    description: "Projedeki bir skill'in talimatlarını yükler.",
    risk: 'read',
    jsonSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Yüklenecek skill'in adı.",
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    validate,
    execute,
  };
}

module.exports = { createLoadSkillTool };
