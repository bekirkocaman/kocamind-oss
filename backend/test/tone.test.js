const test = require('node:test');
const assert = require('node:assert/strict');
const { TONE_RULES, toneRules } = require('../skills/tone');

test('toneRules varsayılan ve tiger için TONE_RULES döndürür ve Konuşma tarzı: ile başlar', () => {
  assert.equal(toneRules('tiger'), TONE_RULES);
  assert.equal(toneRules(), TONE_RULES);
  assert.ok(TONE_RULES.startsWith('Konuşma tarzı:'));
});

test('toneRules custom için TONE_RULES döndürür', () => {
  assert.equal(toneRules('custom'), TONE_RULES);
});

test('toneRules deep_research için boş metin döndürür', () => {
  assert.equal(toneRules('deep_research'), '');
});

test('TONE_RULES dürüstlük ve yapay zekâ kimliği sınırlarını içerir', () => {
  assert.match(TONE_RULES, /insan olduğunu söyleme/);
  assert.match(TONE_RULES, /Samimiyet dürüstlüğün önüne geçmez/);
});
