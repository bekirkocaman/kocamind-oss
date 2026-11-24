'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createWorkspace } = require('../workspace.cjs');
const { createLoadSkillTool } = require('../tools/loadSkill.cjs');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-ls-'));
  const d = path.join(dir, '.kocamind', 'skills', 'test-yaz');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, 'SKILL.md'),
    '---\nname: test-yaz\ndescription: Test yazma\n---\n# Test yaz\nÖnce testi yaz.\n',
    'utf8'
  );
  const workspace = createWorkspace(dir);
  return { dir, workspace, tool: createLoadSkillTool({ workspace }) };
}

test('loadSkill: araç biçimi', () => {
  const { dir, tool } = setup();
  try {
    assert.equal(tool.name, 'load_skill');
    assert.equal(tool.risk, 'read');
    assert.equal(tool.description, "Projedeki bir skill'in talimatlarını yükler.");
    assert.equal(typeof tool.validate, 'function');
    assert.equal(typeof tool.execute, 'function');
    assert.equal(tool.jsonSchema.type, 'object');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSkill: frontmatter sonrası gövdeyi döner', async () => {
  const { dir, workspace, tool } = setup();
  try {
    const args = tool.validate({ name: 'test-yaz' });
    const res = await tool.execute(args, { workspace });
    assert.equal(res.name, 'test-yaz');
    assert.equal(res.body, '# Test yaz\nÖnce testi yaz.\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSkill: olmayan skill hata verir', async () => {
  const { dir, workspace, tool } = setup();
  try {
    await assert.rejects(
      () => tool.execute(tool.validate({ name: 'yok' }), { workspace }),
      { message: 'Skill bulunamadı: yok' }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSkill: geçersiz ad ve bilinmeyen alan reddedilir', () => {
  const { dir, tool } = setup();
  try {
    assert.throws(() => tool.validate({}), { message: 'Eksik alan: name' });
    assert.throws(() => tool.validate({ name: 'Büyük Ad' }), { message: 'Geçersiz alan: name' });
    assert.throws(() => tool.validate({ name: '../x' }), { message: 'Geçersiz alan: name' });
    assert.throws(() => tool.validate({ name: 'a', ek: 1 }), { message: 'Bilinmeyen alan: ek' });
    assert.throws(() => tool.validate(null), { message: 'Geçersiz alan: args' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
