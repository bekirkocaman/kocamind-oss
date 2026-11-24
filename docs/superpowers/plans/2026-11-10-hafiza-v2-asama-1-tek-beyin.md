# Hafıza v2, Aşama 1: Tek Beyin — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hafızayı seçme, prompt'a ekleme ve yeni bilgi öğrenme işini istemcilerden sunucuya taşımak; web ve Android sadece mesajı göndersin.

**Architecture:** Kullanıcı başına önceden derlenmiş tek bir "hafıza paketi" Firestore belgesi tutulur. `/chat` bu paketi diğer okumalarla aynı anda okur ve system prompt'a ekler; cevap yolunda hafıza için model çağrısı yoktur. Öğrenme, cevap gönderildikten sonra arka planda çalışır ve sonucunu pakete yazar; istemci bunu ucuz bir `GET /memory/pack` ile okur.

**Tech Stack:** Node.js + Express 4, firebase-admin (Firestore), `node --test` + supertest; web: React + Vite + vitest; Android: Kotlin, kotlinx.serialization, JUnit.

**Spec:** `docs/superpowers/specs/2026-11-10-hafiza-v2-design.md`

## Global Constraints

- Hafıza, sohbetin ilk token süresine p95'te 50 ms'den fazla eklemez. Cevap yolunda hafıza için model çağrısı yoktur.
- Paket okuma 150 ms'de bitmezse sohbet hafızasız devam eder. Hafıza arızası sohbeti hiçbir koşulda durdurmaz ve hata fırlatmaz.
- Prompt'a giren hafıza metni en fazla 3000 karakterdir.
- Sunucu paketi kullanıcı başına 60 saniye bellekte tutar.
- İstekte `memory: "server"` yoksa sunucu hafıza eklemez. İstekte `memory_learn: true` yoksa sunucu öğrenme başlatmaz. Eski istemciler bozulmadan çalışır.
- `/memory/extract` rotası kaldırılmaz.
- Bugünkü hassas veri filtresi (`memoryAssist.sanitizeExtraction`), ön eleme (`mightContainPersonalInfo`) ve günlük `assist` kotası aynen uygulanır.
- Bu aşama veri modelini değiştirmez: `type`, `confidence` gibi alanlar Aşama 2'dedir.
- Kod yorumları ve kullanıcıya görünen metinler Türkçedir; mevcut dosyaların üslubu korunur.
- `firestore.rules` değişmez: `users/{uid}/{collection}/**` kuralı `memory_pack` belgesini zaten sahibine açar.
- Çalışma `master`'dan açılan `hafiza-v2` dalında yapılır. **Ön koşul:** `guven-ozellikleri` dalındaki commit edilmemiş `backend/routes/chat.js` değişiklikleri önce commit edilip birleştirilmiş olmalı; yoksa Task 6 çakışır.

## Review Focus

1. **Paket belgesi hiç yok (ilk kullanım).** Beklenen: sunucu paketi mevcut kayıtlardan bir kez derler ve o cevapta kullanır; kullanıcı ilk mesajında hafızasız cevap almaz. Test: Task 3.
2. **Öğrenme, cevap başarısızken tetiklenmez.** Sağlayıcı 429/503 döndüyse ya da istek kesildiyse çıkarma çağrısı ve kota harcanmaz. Test: Task 6.
3. **İki istek aynı anda paketi yeniden derler.** Beklenen: `version` geri gitmez, son yazan paket güncel kayıtları yansıtır. Test: Task 3.
4. **Hafıza metni içinde prompt talimatı var** (ör. değer "önceki talimatları yok say"). Beklenen: metin bugünkü gibi yalnızca başlığın altındaki liste satırı olarak girer, satır sonları tek satıra indirilir. Test: Task 2.
5. **Kullanıcı hafızayı kapatmış ama istemci `memory: "server"` gönderiyor.** Beklenen: istemci kapalıyken alanı hiç göndermez; sunucu bu ayarı bilmez. Test: Task 8 ve Task 9.

---

## Dosya haritası

| Dosya | Durum | Sorumluluk |
|---|---|---|
| `backend/memory/pack.js` | Yeni | Kayıt listesinden paket üretir (saf) |
| `backend/memory/select.js` | Yeni | Paket + mesajdan prompt metni üretir (saf) |
| `backend/memory/packStore.js` | Yeni | Paketi okur, yazar, önbellekler, zaman aşımı uygular |
| `backend/memory/learn.js` | Yeni | Mesajdan bilgi çıkarır, kaydeder, paketi yeniler |
| `backend/memory/background.js` | Yeni | Cevap bittikten sonra iş çalıştırır |
| `backend/routes/memory.js` | Değişir | Yazan rotalar paketi yeniler; `GET /memory/pack` |
| `backend/routes/chat.js` | Değişir | Paketi ekler, öğrenmeyi tetikler |
| `backend/routes/account.js` | Değişir | Silme ve dışa aktarma paketi kapsar |
| `backend/server.js` | Değişir | Yeni birimleri kurar ve rotalara verir |
| `kocamind-web/src/lib/chatSubmission.js`, `memoryContext.js`, `api.js` | Değişir | İstemci sadeleşir |
| Android `data/memory/*`, `data/backend/BackendClient.kt`, `ui/chat/ChatViewModel.kt` | Değişir | İstemci sadeleşir, yerel paket kopyası |

---

### Task 1: Vercel'de cevap sonrası arka plan işini doğrula

Bu bir denemedir; sonucu Task 5 ve Task 6'nın hangi yoldan gideceğini belirler.

**Files:**
- Create: `backend/memory/background.js`
- Test: `backend/test/memoryBackground.test.js`
- Modify: `backend/package.json` (`@vercel/functions` bağımlılığı)

**Interfaces:**
- Produces: `runAfterResponse(res, task: () => Promise<void>): void`. `res` 200 durumuyla `finish` olduğunda `task`'ı çalıştırır; başka durumda ya da bağlantı `close` ile kesildiyse çalıştırmaz. `task`'ın hatası yutulur ve `console.warn` ile loglanır. Vercel'de çalışıyorsa promise `waitUntil`'e verilir; `@vercel/functions` yüklenemezse sadece çalıştırılır.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('200 ile biten cevaptan sonra iş çalışır', async () => { /* express app, res.json({ok:true}); task çağrıldı */ });
test('503 ile biten cevapta iş çalışmaz', async () => { /* res.status(503).json(...); task çağrılmadı */ });
test('iş hata fırlatırsa süreç çökmez', async () => { /* task = async () => { throw new Error('x') }; istek 200 döner */ });
```

- [ ] **Step 2:** `cd backend && node --test test/memoryBackground.test.js` → FAIL (modül yok).
- [ ] **Step 3:** `runAfterResponse` fonksiyonunu yaz. `@vercel/functions` içinden `waitUntil` `try { require(...) } catch` ile alınır.
- [ ] **Step 4:** Testler PASS.
- [ ] **Step 5: Canlı deneme.** `server.js`'e geçici, yönetici korumalı `GET /admin/debug/after-response` rotası ekle: cevabı hemen döndürür, `runAfterResponse` ile 3 saniye bekleyip `debug/after_response` belgesine zaman damgası yazar. Önizleme ortamına deploy et, rotayı çağır, 10 saniye sonra belgenin yazıldığını doğrula.
- [ ] **Step 6: Sonucu kaydet.** Belge yazıldıysa `MEMORY_SERVER_LEARN=true` önizleme ve canlı ortam değişkenine eklenir. Yazılmadıysa değişken eklenmez; Task 6'daki tetikleme kodu yine yazılır ama kapalı kalır ve istemciler `/memory/extract` çağırmaya devam eder (Task 8 ve 9 bunu `serverLearn` alanıyla zaten ele alır). Sonuç bu dosyanın sonuna tek satır not olarak yazılır.
- [ ] **Step 7:** Geçici rotayı sil. Commit: `Hafıza v2: cevap sonrası arka plan işi`.

---

### Task 2: Paket derleyici ve seçici (saf fonksiyonlar)

**Files:**
- Create: `backend/memory/pack.js`, `backend/memory/select.js`
- Test: `backend/test/memoryPack.test.js`

**Interfaces:**
- Produces:
  - `buildPack(memories, { previousVersion = 0, lastLearn = null, now }) → Pack`
  - `Pack = { version: number, builtAt: string, core: [{key, value}], optional: [{key, value}], lastLearn: { at: string, saved: [{key, isNew}], forgotten: [string] } | null }`
  - `renderMemoryPrompt(pack, message, { maxChars = 3000, maxItems = 20 }) → { text: string, keys: string[] }`
  - `renderCorePrompt(pack, { maxChars = 3000 }) → string` (mesajsız; çevrimdışı ve ajan yolları için)
  - `MEMORY_PROMPT_HEADER` sabiti

Kurallar:
- `core`: kategorisi `kisisel`, `tercih` ya da `saglik` olan kayıtlar. `optional`: geri kalanlar. İki liste de `updatedAt`'e göre yeniden eskiye sıralıdır.
- `version = previousVersion + 1`.
- Seçim, `kocamind-web/src/lib/memoryContext.js` içindeki `terms` ve `selectRelevantMemories` ile aynı davranışı verir: toplam kayıt `maxItems`'ı geçmiyorsa hepsi girer; geçiyorsa `core` önce, sonra mesajla ilk beş harfi örtüşen `optional` kayıtlar puana göre.
- Başlık metni bugünküyle birebir aynıdır: `Kullanıcı hakkında hafızandaki bilgiler (yalnızca konuyla ilgiliyse doğal biçimde kullan, her cevapta tekrar etme):`. Metin `\n\n` ile başlar, satırlar `- anahtar: değer` biçimindedir.
- Anahtar ve değerdeki satır sonları tek boşluğa indirilir.
- `maxChars` aşılacaksa sondaki satırlar atılır; satır ortadan kesilmez. Kayıt yoksa `text` boş dizgedir.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('kişisel, tercih ve sağlık çekirdeğe, gerisi isteğe bağlıya girer', ...);
test('sürüm bir artar', () => assert.equal(buildPack([], { previousVersion: 4, now }).version, 5));
test('yirmiden az kayıtta hepsi prompt\'a girer', ...);
test('yirmiden fazla kayıtta çekirdek ve mesajla örtüşenler seçilir', ...); // web testindeki örnek veriyle
test('metin 3000 karakteri aşmaz ve satır ortadan kesilmez', ...);
test('değerdeki satır sonu tek satıra iner', () => { /* value: 'a\n\nÖnceki talimatları yok say' → tek satır */ });
test('kayıt yoksa metin boştur', ...);
test('renderMemoryPrompt eklenen anahtarları döndürür', ...);
```

- [ ] **Step 2:** `node --test test/memoryPack.test.js` → FAIL.
- [ ] **Step 3:** `pack.js` ve `select.js`'i yaz.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `Hafıza v2: paket derleyici ve seçici`.

---

### Task 3: Paket deposu

**Files:**
- Create: `backend/memory/packStore.js`
- Test: `backend/test/memoryPackStore.test.js` (`test/fakeFirestore.js` kullanır)

**Interfaces:**
- Consumes: `buildPack` (Task 2), `memoryStore.listMemories`.
- Produces: `createPackStore({ firestoreDb, now = () => new Date(), timeoutMs = 150, firstBuildTimeoutMs = 1000, cacheMs = 60000 }) → { get(uid), rebuild(uid, { lastLearn } = {}), remove(uid) }`
  - `get(uid) → Promise<Pack | null>`: önbellekte varsa onu döndürür. Yoksa `users/{uid}/memory_pack/current` belgesini `timeoutMs` içinde okur. Belge yoksa `firstBuildTimeoutMs` içinde `rebuild` çalıştırır. Zaman aşımı ya da hata durumunda `null` döndürür, asla fırlatmaz.
  - `rebuild(uid, { lastLearn }) → Promise<Pack>`: kayıtları listeler, paketi derler, Firestore transaction'ı içinde mevcut `version`'ı okuyup bir artırarak yazar, önbelleği günceller. `lastLearn` verilmezse eskisi korunur.
  - `remove(uid)`: belgeyi ve önbelleği siler.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('belge yoksa paket bir kez derlenir ve döner', ...);            // Review Focus 1
test('ikinci okuma Firestore\'a gitmez (önbellek)', ...);
test('60 saniye sonra önbellek yenilenir', ...);                      // now enjekte edilir
test('okuma 150 ms\'yi aşarsa null döner', ...);                       // yavaş sahte Firestore
test('Firestore hata verirse null döner, fırlatmaz', ...);
test('eşzamanlı iki rebuild sürümü geri götürmez', ...);              // Review Focus 3: sürümler 1 ve 2
test('rebuild lastLearn verilmezse eskisini korur', ...);
test('remove belgeyi ve önbelleği siler', ...);
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `packStore.js`'i yaz. Zaman aşımı `Promise.race` ile uygulanır.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit: `Hafıza v2: paket deposu`.

---

### Task 4: Hafıza rotaları paketi günceller, `GET /memory/pack`

**Files:**
- Modify: `backend/routes/memory.js` (rotalar: satır 23, 81, 157, 191 ve toplu silme), `backend/routes/account.js:118` ve `:224-240`, `backend/server.js:437`
- Test: `backend/test/memoryPackRoutes.test.js`, `backend/test/accountDelete.test.js`

**Interfaces:**
- Consumes: `createPackStore` (Task 3), `renderCorePrompt` (Task 2).
- Produces:
  - `registerMemoryRoutes(app, { ..., packStore, serverLearn = false })`
  - `GET /memory/pack` → `{ version, text, lastLearn, serverLearn }`. `text` = `renderCorePrompt(pack)`. Kimlik doğrulanmış token'dan gelir; yol parametresi yoktur. Paket okunamazsa `{ version: 0, text: '', lastLearn: null, serverLearn }` ve 200.
  - `/memory/save`, `/memory/delete`, `/memory/import`, `/memory/extract` ve toplu silme başarıyla bittikten sonra `packStore.rebuild(uid)` çağırır. Yeniden derleme hatası rotanın cevabını bozmaz; loglanır.
  - Hesap silme `packStore.remove(uid)` çağırır; dışa aktarma çıktısına `memoryPack` alanı eklenir.
  - Ajanın `save_memory` aracı (`backend/agent/tools.js:214`) da hafızaya yazar. Kayıttan sonra `context.packStore` varsa `rebuild(userId)` çağırır; hata aracın sonucunu bozmaz. `packStore`, `backend/agent/routes.js` içindeki araç bağlamına eklenir (sohbet rotasının bağlamına Task 6'da eklenir). Bu yazar ilk planda atlanmıştı; Task 3 denetimi sırasında bulundu.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('kayıt eklenince paketin sürümü artar', ...);
test('kayıt silinince paketten çıkar', ...);
test('GET /memory/pack çekirdek metni ve sürümü döndürür', ...);
test('GET /memory/pack başkasının paketini döndürmez', ...); // iki kullanıcı, token'a göre
test('paket derleme hata verse de /memory/save 200 döner', ...);
test('hesap silme memory_pack belgesini siler', ...);        // accountDelete.test.js
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Rotaları güncelle; `server.js`'te `packStore` oluşturulup `registerMemoryRoutes` ve hesap rotalarına verilir. `serverLearn = process.env.MEMORY_SERVER_LEARN === 'true'`.
- [ ] **Step 4:** `cd backend && npm test` → tümü PASS.
- [ ] **Step 5:** Commit: `Hafıza v2: paket rotası ve otomatik yenileme`.

---

### Task 5: Öğrenme birimi

`/memory/extract` rotasının gövdesi ortak bir fonksiyona taşınır; rota ve arka plan aynı kodu kullanır.

**Files:**
- Create: `backend/memory/learn.js`
- Modify: `backend/routes/memory.js:23-54`
- Test: `backend/test/memoryLearn.test.js`; mevcut `memoryAssist.test.js` ve çıkarma rotası testleri değişmeden geçmeli

**Interfaces:**
- Consumes: `memoryStore`, `memoryAssist.extractMemories`, `memoryAssist.mightContainPersonalInfo`, `memoryAssist.isAssistAvailable`, `packStore.rebuild`.
- Produces: `createLearner({ firestoreDb, fetch, packStore, metrics, now }) → { learn({ uid, message }) → Promise<{ saved: [{...memory, isNew}], forgotten: [string], skipped: boolean, usage }> }`
  - Ön eleme tutmazsa ya da yardımcı model yoksa `{ saved: [], forgotten: [], skipped: true }` döner, model çağrılmaz.
  - Kayıt sınırı, güncelleme ve `isNew` davranışı bugünkü rota ile birebir aynıdır.
  - Bir şey kaydedildiyse ya da unutulduysa `packStore.rebuild(uid, { lastLearn: { at, saved: [{key, isNew}], forgotten } })` çağrılır.
  - Kota bu fonksiyonda düşülmez; çağıran taraf yönetir.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('kişisel bilgi içermeyen mesajda model çağrılmaz', ...);
test('yeni bilgi kaydedilir ve isNew true gelir', ...);
test('aynı değer tekrar kaydedilmez', ...);
test('100 kayıt sınırında yeni kayıt atlanır, güncelleme yapılır', ...);
test('kayıt sonrası paketin lastLearn alanı dolar', ...);
test('hiçbir şey değişmediyse paket yeniden derlenmez', ...);
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `learn.js`'i yaz; `/memory/extract` rotası `learner.learn` çağıracak şekilde sadeleşir, cevap biçimi değişmez.
- [ ] **Step 4:** `npm test` → tümü PASS.
- [ ] **Step 5:** Commit: `Hafıza v2: ortak öğrenme birimi`.

---

### Task 6: Sohbet rotası hafızayı ekler ve öğrenmeyi tetikler

**Files:**
- Modify: `backend/routes/chat.js:61` (bağımlılıklar), `:135-152` (okumalar ve system prompt), `backend/server.js:426`
- Test: `backend/test/chatMemory.test.js` (`chatRoute.test.js`'teki `chatApp` düzeniyle)

**Interfaces:**
- Consumes: `packStore.get` (Task 3), `renderMemoryPrompt` (Task 2), `learner.learn` (Task 5), `runAfterResponse` (Task 1), `enforceDailyQuota`.
- Produces: `registerChatRoutes(app, { ..., packStore = null, learner = null, serverLearn = false, consumeAssistQuota = null })`
  - `req.body.memory === 'server'` ve `packStore` varsa: `packStore.get(uid)` mevcut `Promise.all` listesine ek bir okuma olarak eklenir (ayrı `await` yok). Sonuç `renderMemoryPrompt(pack, message)` ile metne çevrilir ve system prompt parçalarına `styleRule(...)`'dan sonra eklenir.
  - `req.body.memory_learn === true`, `serverLearn` ve `learner` varsa: `runAfterResponse(res, () => learner.learn({ uid, message }))` kaydedilir. Öğrenmeden önce `consumeAssistQuota(uid)` çağrılır; kota dolmuşsa öğrenme atlanır.
  - `deep_research` yolu (satır 63) bu değişikliğin dışındadır.
  - Paket okuma süresi `metrics.track({ route: 'memory_pack_read', latencyMs, ok })` ile yazılır.

`consumeAssistQuota`'nın `quota.js` içindeki mevcut `assist` kotasını ara katman dışında nasıl düşeceği `backend/quota.js` okunarak belirlenir; yeni bir kota türü eklenmez.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('memory: "server" ile paket system prompt\'a girer', ...);      // fetch'e giden payload'da başlık ve kayıt var
test('memory alanı yoksa hafıza eklenmez', ...);
test('paket null dönerse sohbet hafızasız 200 döner', ...);
test('paket okuma fırlatsa bile sohbet 200 döner', ...);
test('memory_learn ile 200 cevaptan sonra learn çağrılır', ...);
test('sağlayıcı 503 dönerse learn çağrılmaz', ...);                  // Review Focus 2
test('serverLearn kapalıyken learn çağrılmaz', ...);
test('kota doluysa learn çağrılmaz', ...);
test('akışlı cevapta da learn cevap bittikten sonra çağrılır', ...);
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `chat.js`'i güncelle; `server.js`'te `learner` oluşturulup verilir.
- [ ] **Step 4:** `npm test` → tümü PASS (mevcut test dosyaları dahil).
- [ ] **Step 5:** Commit: `Hafıza v2: sohbet rotası hafızayı ekler ve öğrenir`.

---

### Task 7: Sunucu tarafını canlıda doğrula

- [ ] **Step 1:** Önizleme ortamına deploy et.
- [ ] **Step 2:** Test hesabıyla hafızaya bir kayıt ekle; `GET /memory/pack` cevabında göründüğünü doğrula.
- [ ] **Step 3:** `memory: "server"` ile bir `/chat` isteği at; cevabın kaydı bildiğini doğrula. Alan olmadan atılan istekte bilmediğini doğrula.
- [ ] **Step 4:** `memory_learn: true` ile "Adım Deneme, Üsküp'te yaşıyorum" gönder; 10 saniye sonra `GET /memory/pack` cevabında `lastLearn` alanının dolduğunu doğrula. (Task 1 başarısız olduysa bu adım atlanır ve nota yazılır.)
- [ ] **Step 5:** Metriklerde `memory_pack_read` gecikmesinin p95'ini oku; 50 ms'yi aşıyorsa dur ve bildir.
- [ ] **Step 6:** Test kayıtlarını sil.

---

### Task 8: Web istemcisi sadeleşir

**Files:**
- Modify: `kocamind-web/src/lib/chatSubmission.js:64-80, 122-123, 230, 358, 414-447`, `kocamind-web/src/lib/memoryContext.js`, `kocamind-web/src/lib/api.js`
- Test: `kocamind-web/src/lib/memoryContext.test.js`, yeni `kocamind-web/src/lib/memoryPack.test.js`

**Interfaces:**
- Consumes: `GET /memory/pack` (Task 4), `/chat` alanları (Task 6).
- Produces:
  - `api.js`: `memoryPack() → Promise<{version, text, lastLearn, serverLearn}>`
  - `chatSubmission.js`: `/chat` isteğine `loadSetting('memory_enabled', true)` açıksa `memory: 'server'`; ayrıca `auto_memory` açıksa `memory_learn: true` eklenir. Hafıza kapalıyken iki alan da gönderilmez.
  - `memoryPrompt` artık `custom_prompt`'a eklenmez. Ajan yolu (satır 358) paketin `text` alanını kullanır.
  - `rememberInBackground`: `serverLearn` doğruysa `/memory/extract` çağırmaz; cevap bittikten 4 saniye sonra `memoryPack()` çağırır ve `lastLearn.at` daha önce görülenden yeniyse bugünkü "Hafızaya eklendi … Geri al" bildirimini `lastLearn.saved` ile gösterir. `serverLearn` yanlışsa bugünkü davranış aynen sürer.
  - `memoryContext.js`'ten `selectRelevantMemories`, `formatMemoriesForPrompt`, `terms`, `MAX_PROMPT_MEMORIES`, `ALWAYS_INCLUDED_CATEGORIES` silinir.

- [ ] **Step 1: Başarısız testleri yaz**

```js
test('hafıza açıkken istek memory: "server" taşır', ...);
test('hafıza kapalıyken memory ve memory_learn gönderilmez', ...);     // Review Focus 5
test('otomatik kayıt kapalıyken memory_learn gönderilmez', ...);
test('serverLearn doğruyken /memory/extract çağrılmaz', ...);
test('serverLearn yanlışken /memory/extract çağrılır', ...);
test('yeni lastLearn gelince Geri al bildirimi gösterilir, aynısı ikinci kez gösterilmez', ...);
```

- [ ] **Step 2:** `cd kocamind-web && npm test` → FAIL.
- [ ] **Step 3:** Değişiklikleri yap; silinen fonksiyonların testlerini `memoryContext.test.js`'ten çıkar.
- [ ] **Step 4:** `npm test` ve `npm run lint` → PASS.
- [ ] **Step 5:** Tarayıcıda doğrula: giriş yap, hafızada kayıt varken soru sor, cevabın kaydı kullandığını gör; ağ sekmesinde `/chat` gövdesinde `memory: "server"` olduğunu ve `/memory/extract` çağrılmadığını gör.
- [ ] **Step 6:** Commit: `Hafıza v2: web hafızayı sunucuya bırakır`.

---

### Task 9: Android istemcisi sadeleşir

**Files:**
- Modify: `kocamind-android/app/src/main/java/com/tyler/kocamind/data/backend/BackendClient.kt`, `data/memory/MemoryRepository.kt`, `data/memory/MemoryContext.kt`, `ui/chat/ChatViewModel.kt:733, 1074`
- Test: `kocamind-android/app/src/test/java/com/tyler/kocamind/data/memory/MemoryRepositoryTest.kt`, `MemoryContextTest.kt`

**Interfaces:**
- Consumes: `GET /memory/pack`, `/chat` alanları.
- Produces:
  - `data class MemoryPack(val version: Int, val text: String, val lastLearn: LastLearn?, val serverLearn: Boolean)` ve `data class LastLearn(val at: String, val savedKeys: List<String>, val forgotten: Int)`
  - `BackendClient.memoryPack(): MemoryPack`
  - `MemoryRepository`: paketi `MemoryCache` düzeniyle kullanıcı başına dosyada saklar; `refresh()` paketi de yeniler. `promptFor(text)` yerine `corePrompt(): String` gelir ve saklanan `text`'i döndürür.
  - Bulut sohbetinde (`ChatViewModel.kt:733`) hafıza metni `custom_prompt`'a eklenmez; isteğe hafıza açıksa `memory = "server"`, otomatik kayıt açıksa ve sohbet gizli değilse `memory_learn = true` eklenir. Gizli sohbette `memory_learn` gönderilmez.
  - Telefondaki yerel model yolu (`ChatViewModel.kt:1074`) `corePrompt()` kullanır.
  - `rememberInBackground`: `serverLearn` doğruysa çıkarma çağırmaz; 4 saniye sonra paketi yeniler ve `lastLearn` yeniyse `onSaved` ile bildirir. Yanlışsa bugünkü davranış sürer.
  - `MemoryContext.kt`'ten `selectRelevantMemories`, `formatMemoriesForPrompt`, `terms` ve ilgili sabitler silinir.

- [ ] **Step 1: Başarısız testleri yaz**

```kotlin
@Test fun `paket yerelde saklanir ve internetsiz okunur`()
@Test fun `surum degisince yerel kopya yenilenir`()
@Test fun `serverLearn dogruyken cikarma cagrilmaz`()
@Test fun `serverLearn yanlisken cikarma cagrilir`()
@Test fun `gizli sohbette memory_learn gonderilmez`()
@Test fun `hafiza kapaliyken memory alani gonderilmez`()
```

- [ ] **Step 2:** `cd kocamind-android && ./gradlew :app:testDebugUnitTest --tests "*memory*"` → FAIL.
- [ ] **Step 3:** Değişiklikleri yap; silinen fonksiyonların testlerini çıkar.
- [ ] **Step 4:** `./gradlew :app:testDebugUnitTest` → PASS.
- [ ] **Step 5:** Cihazda doğrula: bulut sohbeti hafızayı kullanıyor; uçak modunda yerel model saklanan metni kullanıyor; gizli sohbetten sonra `lastLearn` değişmiyor.
- [ ] **Step 6:** Commit: `Hafıza v2: Android hafızayı sunucuya bırakır`.

---

### Task 10: Canlıya alma

- [ ] **Step 1:** Backend'i canlıya deploy et. Bu adım eski istemcileri etkilemez; alanlar gönderilmediği sürece davranış aynıdır.
- [ ] **Step 2:** 24 saat `memory_pack_read` gecikmesini ve hata oranını izle.
- [ ] **Step 3:** Web'i deploy et.
- [ ] **Step 4:** Android sürümünü yayınla.
- [ ] **Step 5:** Geri dönüş: web bir önceki deploy'a alınır; backend'de `MEMORY_SERVER_LEARN` kaldırılırsa öğrenme istemciye döner.

---

## Deneme sonucu notu

(Task 1, Step 6 burayı doldurur.)
