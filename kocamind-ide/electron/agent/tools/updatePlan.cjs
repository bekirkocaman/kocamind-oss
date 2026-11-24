'use strict';

const MAX_ITEMS = 30;
const ALLOWED_STATUSES = new Set(['pending', 'in_progress', 'completed']);
const ALLOWED_KEYS = new Set(['items']);
const ALLOWED_ITEM_KEYS = new Set(['content', 'status']);

function validate(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Geçersiz alan: args');
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`Bilinmeyen alan: ${key}`);
    }
  }
  if (raw.items === undefined || raw.items === null) {
    throw new Error('Eksik alan: items');
  }
  if (!Array.isArray(raw.items) || raw.items.length > MAX_ITEMS) {
    throw new Error('Geçersiz alan: items');
  }

  let inProgressCount = 0;
  const cleaned = [];

  for (const item of raw.items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Geçersiz alan: items');
    }
    for (const k of Object.keys(item)) {
      if (!ALLOWED_ITEM_KEYS.has(k)) {
        throw new Error(`Bilinmeyen alan: ${k}`);
      }
    }
    if (item.content === undefined || item.content === null) {
      throw new Error('Eksik alan: content');
    }
    if (item.status === undefined || item.status === null) {
      throw new Error('Eksik alan: status');
    }
    if (typeof item.content !== 'string' || item.content.trim() === '') {
      throw new Error('Geçersiz alan: content');
    }
    if (typeof item.status !== 'string' || !ALLOWED_STATUSES.has(item.status)) {
      throw new Error('Geçersiz alan: status');
    }
    if (item.status === 'in_progress') {
      inProgressCount += 1;
      if (inProgressCount > 1) {
        throw new Error('Geçersiz alan: items');
      }
    }
    cleaned.push({ content: item.content, status: item.status });
  }

  return { items: cleaned };
}

async function execute(args, ctx) {
  const items = args.items.map((it) => ({ content: it.content, status: it.status }));
  if (ctx && ctx.session) {
    ctx.session.plan = items;
  }
  return { items };
}

const updatePlanTool = {
  name: 'update_plan',
  description: 'Çok adımlı görevlerde çalışma planını günceller.',
  risk: 'read',
  jsonSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  validate,
  execute,
};

module.exports = { updatePlanTool };
