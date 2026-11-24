const test = require('node:test');
const assert = require('node:assert/strict');
const items = require('../eval/turkceKaliteSeti.json');
const { normalizeAnswer, checkAnswer, parseJudge, runQualityEval, formatReport } = require('../eval/qualityEval');
const { main, createComplete } = require('../scripts/qualityEval');

const categories = ['gundelik', 'mantik', 'matematik', 'talimat', 'baglam', 'bilinmeyen'];
const controlTypes = ['tam', 'regex', 'yasak', 'reddet_ya_da_bilmiyorum', 'hakem'];

test('Türkçe set altı kategoriyi, benzersiz kimlikleri ve derlenebilir kontrolleri içerir', () => {
  assert.ok(items.length >= 60);
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  assert.deepEqual([...new Set(items.map(item => item.kategori))].sort(), [...categories].sort());
  for (const category of categories) {
    assert.ok(items.filter(item => item.kategori === category).length >= 10, category);
  }
  assert.deepEqual([...new Set(items.map(item => item.kontrol.tur))].sort(), [...controlTypes].sort());
  assert.ok(items.filter(item => item.kontrol.tur === 'hakem').length / items.length <= 0.4);
  for (const { id, soru, kategori, gecmis, kontrol } of items) {
    assert.ok(id.trim() && soru.trim());
    if (kategori === 'baglam') {
      assert.ok(gecmis.length);
      for (const { rol, icerik } of gecmis) {
        assert.ok(['kullanıcı', 'asistan'].includes(rol) && icerik.trim());
      }
    }
    if (kontrol.tur === 'tam') assert.ok(kontrol.beklenen.trim());
    if (kontrol.tur === 'hakem') assert.ok(kontrol.olcut.trim());
    if (kontrol.tur === 'regex') assert.doesNotThrow(() => new RegExp(kontrol.desen, kontrol.bayrak), id);
    if (kontrol.tur === 'yasak') {
      assert.ok(kontrol.desenler.length);
      for (const pattern of kontrol.desenler) assert.doesNotThrow(() => new RegExp(pattern, 'mu'), id);
      if (kontrol.gerekli) assert.doesNotThrow(() => new RegExp(kontrol.gerekli, 'u'), id);
    }
  }
});

test('matematik kontrolleri hesaplanan sonuçları kabul eder', () => {
  const endMinutes = 9 * 60 + 35 + 50;
  const expected = [
    47 + 38, 144 / 12, 240 * 15 / 100, 2 * (7 + 11), (12 + 15 + 24) / 3,
    3 * (8 - 13), Math.ceil(84 / 4), Math.floor(endMinutes / 60) + ':' + endMinutes % 60,
    (42 - 7) / 5, 13 ** 2,
  ];
  for (const [index, answer] of expected.entries()) {
    const item = items.find(item => item.id === 'matematik-' + String(index + 1).padStart(2, '0'));
    assert.equal(checkAnswer(item, String(answer)).gecti, true, item.id);
    assert.equal(checkAnswer(item, String(answer) + '0').gecti, false, item.id);
  }
});

test('normalizeAnswer Türkçe harfleri, noktalama işaretlerini ve boşlukları işler', () => {
  assert.equal(normalizeAnswer('  IŞIK, İZMİR!\n**GÜZEL**… '), 'ışık izmir güzel');
  assert.equal(normalizeAnswer('Sonuç: −15,5.'), 'sonuç -15.5');
  assert.equal(normalizeAnswer('Daire-7'), 'daire 7');
});

test('checkAnswer tüm kontrol türlerinde geçiş, başarısızlık veya hakem isteği döndürür', () => {
  const check = (kontrol, answer) => checkAnswer({ kontrol }, answer).gecti;
  assert.equal(check({ tur: 'tam', beklenen: 'Ihlamur Sokak' }, 'Adres: **IHLAMUR SOKAK**.'), true);
  assert.equal(check({ tur: 'tam', beklenen: 'Ihlamur Sokak' }, 'Ihlamur Sokakları'), false);
  assert.equal(check({ tur: 'tam', beklenen: '36' }, '136'), false);
  assert.equal(check({ tur: 'tam', beklenen: '36' }, '-36'), false);
  assert.equal(check({ tur: 'tam', beklenen: '36' }, '36,4'), false);
  assert.equal(check({ tur: 'tam', beklenen: '-15' }, '−15.'), true);
  assert.equal(check({ tur: 'regex', desen: '^evet\\.?$', bayrak: 'i' }, 'EVET.'), true);
  assert.equal(check({ tur: 'regex', desen: '^evet\\.?$', bayrak: 'i' }, 'Evet ve hayır'), false);
  assert.equal(check({ tur: 'yasak', desenler: ['^[-*]\\s', '!'] }, 'Sağ ol.'), true);
  assert.equal(check({ tur: 'yasak', desenler: ['^[-*]\\s', '!'] }, 'Sağ ol\n- Görüşürüz'), false);
  assert.equal(check({ tur: 'yasak', desenler: ['!'] }, '  '), false);
  assert.equal(check({ tur: 'reddet_ya_da_bilmiyorum' }, 'Bu bilgilerle sonucu belirleyemem.'), true);
  assert.equal(check({ tur: 'reddet_ya_da_bilmiyorum' }, 'EMİN DEĞİLİM.'), true);
  assert.equal(check({ tur: 'reddet_ya_da_bilmiyorum' }, 'Kesinlikle mavi.'), false);
  assert.equal(check({ tur: 'reddet_ya_da_bilmiyorum' }, 'Bilmiyorum ama bence mavi.'), false);
  assert.equal(check({ tur: 'hakem', olcut: 'Kısa olsun.' }, 'Merhaba.'), null);
});

test('checkAnswer Türkçe kalite setindeki 19 ek senaryoda doğruyu geçirir, yanlışı bırakır', () => {
  const byId = id => items.find(item => item.id === id);
  const cases = [
    ['gundelik-01', 'Fırın eldivenidir.', true],
    ['gundelik-02', 'Son kullanma tarihidir.', true],
    ['gundelik-09', 'Daire-7', true],
    ['gundelik-09', 'Adreste Kat: 2, Daire: 7 yazdığına göre kapı numarası 2\'dir.', false],
    ['mantik-02', 'Mavidir.', true],
    ['mantik-02', 'Kutuda kırmızı ve mavi toplar varsa top kırmızıdır.', false],
    ['mantik-05', 'Ortadaki raf yeşildir.', true],
    ['baglam-02', 'Pınar\'ın defteri mordur.', true],
    ['baglam-02', 'Pınar\'ın defteri mor değil, yeşildir.', false],
    ['talimat-01', 'TAMAM', false],
    ['talimat-02', 'KIRMIZI, MAVİ, SARI', true],
    ['mantik-07', 'HAYIR', true],
    ['talimat-03', 'Bitkileri güneş alan yere koyun ve toprağı nemli tutun.', true],
    ['talimat-03', 'İki ipucu: 1. Güneş alan yere koyun. 2. Fazla sulamayın.', false],
    ['talimat-03', 'Merhaba', false],
    ['talimat-07', 'Yardımın için çok teşekkür ederim.', true],
    ['talimat-07', 'Hayır, mesaj yazamam.', false],
    ['bilinmeyen-03', 'Dosyayı paylaşmadığınız için ilk cümlesini okuyamam.', true],
    ['bilinmeyen-05', 'Bu bilgiyle söyleyemem; Ece 6, 7 veya 8 numaralı koltukta olabilir.', true],
    ['bilinmeyen-07', 'Sadece sayfa sayısından yazarını bilemem; ancak kitabın adını verirseniz söyleyebilirim.', true],
    ['bilinmeyen-07', 'Sadece sayfa sayısından yazarını bulamam.', true],
    ['bilinmeyen-08', 'Bu bilgiyle kaç dakika geç kaldığını belirlemek mümkün değildir.', true],
    ['bilinmeyen-09', 'Yaş ortalamasını hesaplamak için verilen bilgiler yetersizdir.', true],
    ['bilinmeyen-02', 'Kesin olarak bilemem, tuttuğun sayı 27.', false],
  ];
  for (const [id, answer, expected] of cases) {
    assert.equal(checkAnswer(byId(id), answer).gecti, expected, `${id}: ${answer}`);
  }
});

test('parseJudge ilk geçerli JSON nesnesini bulur ve hakem hatası koşuyu durdurmaz', async () => {
  assert.deepEqual(
    parseJudge('Ön bilgi {örnek} {"puan":1,"neden":"İçinde {süslü} parantez var."} {son}'),
    { gecti: true, neden: 'İçinde {süslü} parantez var.' },
  );
  const selected = [
    { id: '1', kategori: 'hakemli', soru: 'Soru 1', kontrol: { tur: 'hakem', olcut: 'Ölçüt' } },
    { id: '2', kategori: 'matematik', soru: '2 + 2?', kontrol: { tur: 'tam', beklenen: '4' } },
  ];
  const result = await runQualityEval({
    items: selected,
    models: ['aday'],
    judgeModel: 'hakem',
    complete: async ({ model }) => {
      if (model === 'hakem') throw new Error('503');
      return '4';
    },
  });
  assert.equal(result.models[0].entries[0].gecti, false);
  assert.equal(result.models[0].entries[0].neden, 'Hakem hatası.');
  assert.equal(result.models[0].entries[1].gecti, true);
  assert.equal(result.models[0].passed, 1);
});

test('runQualityEval hakem, çağrı hatası, geçmiş ve kategori skorlarını birlikte işler', async () => {
  const selected = [
    { id: '1', kategori: 'matematik', soru: '2 × 2?', kontrol: { tur: 'tam', beklenen: '4' } },
    { id: '2', kategori: 'baglam', gecmis: [{ rol: 'kullanıcı', icerik: 'Çantam kırmızı.' }], soru: 'Çantayı tarif et.', kontrol: { tur: 'hakem', olcut: 'Kırmızı renkten söz etmeli.' } },
    { id: '3', kategori: 'baglam', soru: 'Başka bir soru.', kontrol: { tur: 'tam', beklenen: 'sonuç' } },
  ];
  const progress = [];
  const result = await runQualityEval({
    items: selected,
    models: ['a', 'b'],
    judgeModel: 'hakem',
    onProgress: (done, total, entry) => progress.push([done, total, entry.id]),
    complete: async ({ model, user }) => {
      if (model === 'hakem') {
        const request = JSON.parse(user);
        assert.deepEqual(request.gecmis, selected[1].gecmis);
        assert.equal(request.olcut, selected[1].kontrol.olcut);
        return request.yanit === 'Kırmızı çanta.'
          ? 'Sonuç:\n{"puan":1,"neden":"Rengi doğru."}\n'
          : '{"puan":1,';
      }
      if (user === selected[0].soru) {
        if (model === 'a') throw new Error('Sahte sağlayıcı hatası');
        return '4';
      }
      if (user === selected[2].soru) return 'yanlış';
      assert.match(user, /kullanıcı: Çantam kırmızı\.[\s\S]*Çantayı tarif et\./u);
      return model === 'a' ? 'Kırmızı çanta.' : 'Mavi çanta.';
    },
  });
  assert.equal(result.models[0].entries[0].neden, 'hata');
  assert.equal(result.models[0].entries[1].neden, 'Rengi doğru.');
  assert.equal(result.models[1].entries[1].neden, 'Hakem cevabı okunamadı.');
  assert.equal(result.models[0].total, 3);
  assert.equal(result.models[0].passed, 1);
  assert.equal(result.models[0].percentage, (1 / 3) * 100);
  assert.deepEqual(result.models[0].categories.baglam, { total: 2, passed: 1, percentage: 50 });
  assert.equal(result.models[1].categories.matematik.percentage, 100);
  assert.equal(result.models[1].categories.baglam.percentage, 0);
  assert.deepEqual(result.worstQuestions.map(item => item.id), ['3', '1', '2']);
  assert.deepEqual(progress.map(([done, total]) => [done, total]), [[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]]);
  assert.match(formatReport(result), /\| Model \| Toplam \| matematik \| baglam \|/u);
  assert.match(formatReport(result), /\| a \| 1\/3 \(%33,33\)/u);
});

test('eşzamanlılık varsayılanı, yapılandırılmış sınır ve en kötü beş soru', async () => {
  for (const concurrency of [undefined, 1, 3]) {
    let active = 0;
    let peak = 0;
    const result = await runQualityEval({
      items: items.slice(0, 10), models: ['model'], judgeModel: 'hakem', concurrency,
      complete: async ({ model }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return model === 'hakem' ? '{"puan":0,"neden":"Ölçüt karşılanmadı."}' : 'Yanlış';
      },
    });
    assert.equal(peak, concurrency ?? 2);
    assert.equal(result.models[0].passed, 0);
    assert.equal(result.models[0].entries[3].neden, 'Ölçüt karşılanmadı.');
    assert.equal(result.worstQuestions.length, 5);
  }
});

test('CLI --evet olmadan tahmini gösterir ve model çağırmaz', async () => {
  const lines = [];
  let calls = 0;
  const complete = async () => { calls += 1; };
  const args = ['--models', 'a,b', '--judge', 'hakem', '--kategori', 'gundelik', '--limit', '4'];
  assert.equal(await main(args, { complete, log: line => lines.push(line) }), undefined);
  assert.equal(calls, 0);
  assert.match(lines[0], /10 \(8 yanıt, en fazla 2 hakem\)/u);
  assert.match(lines[1], /--evet/u);

  const result = await main([...args, '--evet'], {
    complete: async ({ model }) => {
      assert.match(lines.at(-1), /\d\/8|Tahmini/u);
      calls += 1;
      return model === 'hakem' ? '{"puan":1,"neden":"Doğru."}' : 'pazar';
    },
    log: line => lines.push(line),
  });
  assert.equal(calls, 10);
  assert.equal(result.models[0].total, 4);
  assert.match(lines.at(-1), /^# Türkçe kalite değerlendirmesi/u);
});

test('CLI sağlayıcı yapılandırması istekleri doğru protokole yönlendirir', async () => {
  const models = ['deepseek-chat', 'gpt-5.6-luna', 'claude-sonnet-4-5'];
  const requests = [];
  const complete = createComplete(models, {
    env: { DEEPSEEK_API_KEY: 'ds-test', OPENAI_API_KEY: 'oa-test', ANTHROPIC_API_KEY: 'an-test' },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body);
      requests.push({ url, headers: options.headers, payload });
      const data = {
        'deepseek-chat': { choices: [{ message: { content: 'DeepSeek' } }] },
        'gpt-5.6-luna': { output: [{ type: 'message', content: [{ type: 'output_text', text: 'OpenAI' }] }] },
        'claude-sonnet-4-5': { content: [{ type: 'text', text: 'Anthropic' }] },
      };
      return { ok: true, json: async () => data[payload.model] };
    },
  });
  const answers = await Promise.all(models.map(model => complete({ model, system: 'Sistem', user: 'Soru' })));
  assert.deepEqual(answers, ['DeepSeek', 'OpenAI', 'Anthropic']);
  assert.deepEqual(requests.map(request => new URL(request.url).pathname), ['/v1/chat/completions', '/v1/responses', '/v1/messages']);
  assert.equal(requests[0].headers.Authorization, 'Bearer ds-test');
  assert.equal(requests[1].headers.Authorization, 'Bearer oa-test');
  assert.equal(requests[2].headers['x-api-key'], 'an-test');
  assert.deepEqual(requests[0].payload.messages, [{ role: 'system', content: 'Sistem' }, { role: 'user', content: 'Soru' }]);
  assert.equal(requests[1].payload.instructions, 'Sistem');
  assert.deepEqual(requests[1].payload.input, [{ role: 'user', content: 'Soru' }]);
  assert.equal(requests[2].payload.system, 'Sistem');
});

test('CLI kapalı sağlayıcıyla değerlendirme için çağrı hazırlamaz', () => {
  const complete = createComplete(['deepseek-chat', 'gpt-5.6-luna'], {
    env: { DEEPSEEK_API_KEY: 'ds-test', OPENAI_API_KEY: 'oa-test', DISABLED_PROVIDERS: ' OPENAI ' },
    fetch: () => assert.fail('Model çağrılmamalı'),
  });
  assert.equal(complete, null);
});
