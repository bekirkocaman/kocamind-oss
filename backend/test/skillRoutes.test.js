const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { registerSkillRoutes } = require('../routes/skills');

const skillStore = {
  list: () => [
    { name: 'dilekce', title: 'Dilekçe', description: 'Dilekçe taslağı hazırlar.', assistants: ['tiger'], autoload: false, body: 'GİZLİ TALİMAT', files: ['a.md'], dir: '/srv/x' },
    { name: 'derin-arastirma', title: 'Derin araştırma', description: 'Kaynaklı araştırma.', assistants: ['deep_research'], autoload: true, body: 'gövde', files: [], dir: '/srv/y' },
    { name: 'ortak', description: 'Her yerde.', assistants: ['*'], autoload: false, body: '', files: [], dir: '/srv/z' },
  ],
};

function app() {
  const server = express();
  registerSkillRoutes(server, { skillStore });
  return server;
}

test('skill listesi yalnızca görünen alanları döndürür', async () => {
  const response = await request(app()).get('/skills');
  assert.equal(response.status, 200);
  assert.equal(response.body.skills.length, 3);
  assert.deepEqual(response.body.skills[0], { name: 'dilekce', title: 'Dilekçe', description: 'Dilekçe taslağı hazırlar.', where: ['Sohbet'], alwaysOn: false });
  assert.doesNotMatch(JSON.stringify(response.body), /GİZLİ|\/srv|a\.md/);
});

test('asistan kimlikleri Türkçe adlara çevrilir, başlık yoksa ad kullanılır', async () => {
  const [, deep, shared] = (await request(app()).get('/skills')).body.skills;
  assert.deepEqual(deep.where, ['Derin araştırma']);
  assert.equal(deep.alwaysOn, true);
  assert.deepEqual(shared.where, ['Her yerde']);
  assert.equal(shared.title, 'ortak');
});
