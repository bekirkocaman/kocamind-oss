# Güven Özellikleri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sayaç, görünür hafıza, gizli sohbet, Türkiye işleri ve "emin değilim" kuralını web + Android + backend'e eklemek.

**Architecture:** Yeni altyapı yok. Backend'in zaten gönderdiği kota başlıkları, mevcut hafıza uçları, yerel GGUF modeli ve skill deposu kullanılır. Saf mantık (metin, eşik, liste) test edilebilir küçük fonksiyonlara, arayüz ince bileşenlere konur.

**Tech Stack:** Node/Express + `node:test` (backend), React + Vitest (web), Kotlin + Jetpack Compose + JUnit (Android).

**Spec:** `docs/superpowers/specs/2026-11-03-guven-ozellikleri-design.md`

## Global Constraints

- Arayüz metinleri doğal Türkçe; aşağıdaki metinler birebir kullanılır.
- Sayaç eşiği: `remaining <= floor(limit * 0.2)` iken uyarı görünür; üstündeyken hiçbir şey görünmez.
- Kota yenilenmesi UTC gece yarısı (Türkiye 03:00); geri sayım mevcut `resetCountdown` ile.
- Gizli sohbette backend'e hiçbir istek gitmez, sohbet depoya yazılmaz, hafıza çıkarımı yapılmaz. Yalnızca Android.
- Fiyat ya da plan metni eklenmez.
- Her görev ayrı commit; commit mesajları Türkçe ve `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` ile biter.

## Review Focus

1. Limiti olmayan (Pro'da kind tanımsız) yanıt: başlık yok → sayaç hiç görünmez, hata vermez. (Görev 1 testleri)
2. 429 akış başlamadan gelir: Android `readEvents` gövdeyi okumadan önce kodu kontrol etmeli. (Görev 1 testi)
3. "Geri al"a bağlantı yokken basılması: silme başarısızsa kullanıcıya "Geri alınamadı" bildirimi. (Görev 2 testi)
4. Sohbet başladıktan sonra gizli moda geçiş: izin verilmez (yalnızca boş sohbette). (Görev 3 testi)
5. Gizli sohbet açıkken model listesinden bulut modeli seçmek: gönderim yine yerel modele gider. (Görev 3 testi)

---

### Task 1: Şeffaf sayaç

**Files:**
- Modify: `backend/quota.js` (429 dalı)
- Test: `backend/test/quota.test.js`
- Modify: `kocamind-web/src/lib/usage.js`, `kocamind-web/src/lib/chatSubmission.js` (~428–530), `kocamind-web/src/App.jsx` (durum), mesaj kutusunun bulunduğu bileşen
- Create: `kocamind-web/src/components/chat/QuotaNotice.jsx`
- Test: `kocamind-web/src/lib/usage.test.js`
- Modify: `kocamind-android/.../ui/settings/UsageLogic.kt`, `data/backend/BackendClient.kt` (`ChatBackend`, `streamChat`, `readEvents`), `ui/chat/ChatViewModel.kt` (`ChatUiState`, `sendToCloud`, `sendToOffline`), `ui/chat/ChatScreen.kt`, `ui/chat/MessageRow.kt`
- Test: `kocamind-android/app/src/test/.../ui/settings/UsageLogicTest.kt` (yoksa oluştur), `ui/chat/ChatViewModelTest.kt`

**Interfaces:**
- Produces (web `usage.js`): `parseQuotaHeaders(headers: Headers) -> {remaining:number, limit:number} | null`, `quotaNotice(q) -> string | null`, `quotaExhaustedText(now?: Date) -> string`
- Produces (Android `UsageLogic.kt`): `data class QuotaState(val remaining: Int, val limit: Int)`, `fun quotaNotice(q: QuotaState): String?`, `fun quotaExhaustedText(now: Instant): String`, `class QuotaExceededException(message: String) : BackendException`
- Produces: `ChatBackend.lastQuota: QuotaState?` (varsayılan `null`), `ChatUiState.quota: QuotaState?`, `ChatUiState.quotaExhausted: Boolean`
- Metinler: uyarı `"Bugün $remaining mesaj hakkın kaldı · 03:00'te yenilenir"`; bitti `"Bugünkü mesaj hakkın bitti. $countdown sonra yenilenir."`; yerel not `"Telefonda üretildi · hak harcamaz"`; düğme `"Telefondaki modelle devam et"`

- [ ] **Step 1: Backend testleri.** `quota.test.js`'e: limit dolunca yanıt 429, `X-Daily-Remaining` başlığı `"0"` ve gövdede `code: 'daily_limit'`.
- [ ] **Step 2:** `cd backend && npm test` → yeni test FAIL.
- [ ] **Step 3:** `quota.js` 429 dalında `X-Daily-Remaining: 0` ve `code: 'daily_limit'` ekle.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Web testleri** (`usage.test.js`):
  - `parseQuotaHeaders(new Headers({'X-Daily-Limit':'50','X-Daily-Remaining':'8'}))` → `{remaining:8, limit:50}`; başlık yoksa `null`.
  - `quotaNotice({remaining:10, limit:50})` → `"Bugün 10 mesaj hakkın kaldı · 03:00'te yenilenir"`; `{remaining:11, limit:50}` → `null`; `{remaining:0, limit:50}` → `null` (bitti durumu ayrı).
  - `quotaExhaustedText(new Date('2026-11-03T23:00:00Z'))` → `"Bugünkü mesaj hakkın bitti. 01:00:00 sonra yenilenir."`
- [ ] **Step 6:** `cd kocamind-web && npx vitest run src/lib/usage.test.js` → FAIL.
- [ ] **Step 7:** Fonksiyonları `usage.js`'e yaz. `chatSubmission.js`'de `/chat` yanıtından sonra `onQuota?.(parseQuotaHeaders(response.headers))`; `response.status === 429` ise `onQuotaExhausted?.()` ve hata balonu yerine durum. `QuotaNotice` mesaj kutusunun üstünde ince satır; bitmişse `quotaExhaustedText` her saniye güncellenir.
- [ ] **Step 8:** vitest → PASS; `npm run build` hatasız.
- [ ] **Step 9: Android testleri:** `quotaNotice(QuotaState(10,50))` metni, `QuotaState(11,50)` → `null`, `quotaExhaustedText` aynı örnek; `ChatViewModelTest`: sahte backend `QuotaExceededException` fırlatınca `state.quotaExhausted == true` ve mesaj `isError` değil; yerel yanıtta `answeredBy` `"local/"` ile başlar.
- [ ] **Step 10:** `cd kocamind-android && ./gradlew testDebugUnitTest` → yeni testler FAIL.
- [ ] **Step 11:** Uygula. `readEvents`'te `response.code == 429` → `QuotaExceededException`; `onHeaders`'ta `lastQuota` doldur. `sendToCloud` sonrası `quota = backend.lastQuota`. `ChatScreen` mesaj kutusunun üstünde uyarı satırı; bitmişse geri sayım + yerel model indirilmişse "Telefondaki modelle devam et" (seçince yerel modeli seçer). `MessageRow`: `answeredBy` `"local/"` ile başlıyorsa küçük not.
- [ ] **Step 12:** `./gradlew testDebugUnitTest` → PASS.
- [ ] **Step 13: Commit** `Sayaç: kalan mesaj hakkı sohbette görünür`

### Task 2: Görünür hafıza

**Files:**
- Modify: `kocamind-android/.../data/memory/MemoryRepository.kt` (`MemoryApi`, `ChatMemorySource`, `rememberInBackground`), `data/backend/BackendClient.kt` (`extractMemories`), `ui/chat/ChatViewModel.kt` (`ChatEvent`), `ui/chat/ChatScreen.kt` (bildirim)
- Test: `kocamind-android/app/src/test/.../data/memory/` altındaki repository testi, `ChatViewModelTest.kt`
- Modify: `kocamind-web/src/hooks/useToasts.js`, toast'u çizen bileşen, `kocamind-web/src/lib/chatSubmission.js` (`rememberInBackground`)
- Test: `kocamind-web/src/hooks/useToasts.test.js` (yoksa oluştur)

**Interfaces:**
- Produces (Android): `MemoryApi.extractMemories(message): ExtractResult` (`data class ExtractResult(val savedKeys: List<String>, val forgotten: Int)`); `ChatMemorySource.rememberInBackground(text: String, onSaved: (List<String>) -> Unit = {})`; `ChatMemorySource.forget(keys: List<String>): Boolean`; `ChatEvent.MemorySaved(keys: List<String>)`; `ChatViewModel.undoMemory(keys: List<String>)`
- Produces (web): `showToast(message, type = 'info', action?: {label: string, onClick: () => void})`
- Metinler: `"Hafızaya eklendi: ${keys.joinToString(", ")}"`, eylem `"Geri al"`, başarılı `"Geri alındı"`, başarısız `"Geri alınamadı"`

- [ ] **Step 1: Testler.** Android: `extractMemories` `saved` dizisinden anahtarları okur; `rememberInBackground` hafıza kapalıyken API'yi çağırmaz (mevcut davranışı sabitler); `undoMemory(listOf("isim"))` her anahtar için `deleteMemory` çağırır, hata olursa `Toast("Geri alınamadı")`. Web: `showToast('x','info',{label:'Geri al',onClick})` toast nesnesinde `action` taşır; eylemli toast 6000 ms kalır.
- [ ] **Step 2:** İlgili test komutları → FAIL.
- [ ] **Step 3:** Uygula. Android `ChatScreen` `MemorySaved` olayında eylemli bildirim gösterir ("Geri al" → `undoMemory`). Web `rememberInBackground` kaydedilenler için eylemli toast; `onClick` her anahtar için mevcut hafıza silme API'sini çağırıp `refreshMemories()`.
- [ ] **Step 4:** Testler → PASS; web build.
- [ ] **Step 5: Commit** `Hafıza: kayıt anında bildirim ve geri al`

### Task 3: Gizli sohbet (Android)

**Files:**
- Modify: `kocamind-android/.../ui/chat/ChatViewModel.kt` (`ChatUiState`, `send`, `scheduleSave`/`persist`, `clearChat`), `ui/chat/ChatScreen.kt` (`EmptyState`, üst işaret)
- Test: `ChatViewModelTest.kt`

**Interfaces:**
- Produces: `ChatUiState.privateChat: Boolean`, `ChatViewModel.setPrivateChat(on: Boolean)`
- Metinler: anahtar `"Gizli sohbet"`; işaret `"Gizli sohbet · Bu sohbet telefondan çıkmaz ve kaydedilmez"`; model yoksa uyarı başlığı `"Yerel model gerekli"`, metin `"Gizli sohbet telefondaki modelle çalışır. Önce bir model indir."` (eylem `OpenOfflineModels`)

- [ ] **Step 1: Testler** (`ChatViewModelTest`):
  - `privateChat` açık + bulut modeli seçili → `send()` sonrası sahte backend `streamChat` 0 kez çağrılır, yerel `generate` 1 kez.
  - Gizli sohbette mesaj sonrası sahte store'a hiç yazılmaz; `memory.rememberInBackground` çağrılmaz.
  - İndirilmiş model yokken `setPrivateChat(true)` → `privateChat` false kalır, `Alert` olayı `OpenOfflineModels` eylemiyle.
  - Mesaj varken `setPrivateChat(true)` → değişmez.
  - Yeni sohbet (`clearChat`) → `privateChat` false.
- [ ] **Step 2:** `./gradlew testDebugUnitTest` → FAIL.
- [ ] **Step 3:** Uygula. `send()` başında `privateChat` ise doğrudan `sendToOffline`; ek/mod varsa mevcut "Yerel AI metin sohbeti içindir" uyarısı. `scheduleSave`/`saveNow` gizli sohbette çıkış yapar. `EmptyState`'e anahtar, sohbet ekranının üstüne işaret.
- [ ] **Step 4:** Testler → PASS.
- [ ] **Step 5: Commit** `Gizli sohbet: telefondan çıkmayan, kaydedilmeyen sohbet`

### Task 4: Türkiye'ye özel işler

**Files:**
- Create: `backend/skills/fatura-okuma/SKILL.md`, `backend/skills/soru-cozme/SKILL.md` (mevcut `dilekce/SKILL.md` ön bilgi biçimi: `name`, `title`, `description`, `assistants: [tiger]`)
- Test: `backend/test/skillStore.test.js` (skill sayısı/adları sabitlenmişse güncelle)
- Create: `kocamind-web/src/lib/suggestions.js`, `kocamind-web/src/lib/suggestions.test.js`
- Modify: `kocamind-web/src/components/EmptyState.jsx` (+ `.css`), onu çağıran bileşen
- Create: `kocamind-android/.../ui/chat/Suggestions.kt`; Test: `ui/chat/SuggestionsTest.kt`
- Modify: `ui/chat/ChatScreen.kt` (`EmptyState`)

**Interfaces:**
- Produces: `SUGGESTIONS` (web dizi, Android `val SUGGESTIONS: List<Suggestion>`; `Suggestion(id, label, prompt, needsImage)`), sırası ve içeriği:
  - `dilekce`, `"Dilekçe yaz"`, `"Bir dilekçe yazmama yardım et. Konu: "`, false
  - `resmi-eposta`, `"Resmi e-posta yaz"`, `"Resmi bir e-posta yazmama yardım et. Kime ve ne hakkında: "`, false
  - `fatura`, `"Faturamı açıkla"`, `"Bu faturayı sade Türkçe açıkla: kalemler, toplam tutar ve son ödeme tarihi."`, true
  - `soru`, `"Fotoğraftan soru çöz"`, `"Bu soruyu adım adım çöz, cevabı en sonda ver."`, true
- `EmptyState` `onPick(suggestion)` alır: mesaj kutusunu `prompt` ile doldurur (göndermez); `needsImage` ise fotoğraf seçiciyi açar.

- [ ] **Step 1: Testler:** web ve Android'de liste 4 öğe, id sırası yukarıdaki gibi, `needsImage` yalnızca `fatura` ve `soru` için true. Backend: skill deposu `fatura-okuma` ve `soru-cozme`'yi yükler.
- [ ] **Step 2:** Testler → FAIL.
- [ ] **Step 3:** Skill'leri yaz: `fatura-okuma` kalemleri, toplamı, son ödeme tarihini ve olağandışı kalemleri sade Türkçe açıklar, okunamayan rakamı uydurmaz; `soru-cozme` soruyu adım adım çözer, cevabı en sonda `Cevap: X` biçiminde verir, şıklar okunamıyorsa sorar. Listeleri ve kartları ekle.
- [ ] **Step 4:** Testler → PASS; web build; web önizlemede boş ekran kartları görünür.
- [ ] **Step 5: Commit** `Türkiye işleri: boş ekranda öneri kartları, fatura ve soru skill'leri`

### Task 5: "Emin değilim" kuralı

**Files:**
- Modify: `kocamind-web/src/lib/prompts.js` ("ARAMA YAPMADIĞINDA" bölümü)
- Test: `kocamind-web/src/lib/prompts.test.js` (yoksa oluştur)
- Modify: `kocamind-android/.../ui/chat/ChatViewModel.kt` (`buildInstructions`); Test: `ChatViewModelTest.kt`
- Modify: `backend/server.js` `ASSISTANT_PROMPTS` içinde aynı çelişkili ifade varsa

**Interfaces:**
- Kural metni (birebir): `Bilmediğin ya da emin olmadığın bir konuda bunu açıkça söyle ("Emin değilim" de), tahmini tahmin olarak belirt; kaynak, rakam, tarih veya alıntı uydurma.`

- [ ] **Step 1: Testler:** web istemi kural metnini içerir ve `"sanırım" gibi belirsiz ifadeler kullanma` ile `Direkt ve kendinden emin cevap ver` satırlarını **içermez**; Android: gönderilen `ChatStreamRequest.instructions` kural metnini içerir.
- [ ] **Step 2:** Testler → FAIL.
- [ ] **Step 3:** Web'de çelişkili iki satırı kural metniyle değiştir; Android `buildInstructions`'a ekle; backend'de aynı çelişki varsa düzelt.
- [ ] **Step 4:** Testler → PASS.
- [ ] **Step 5: Commit** `Dürüstlük: emin olmadığında söyleme kuralı`

Not: Kaynak gösterme web isteminde zaten `📌 Kaynaklar` biçimiyle var; ayrı arayüz işi yapılmaz.

### Task 6: Son doğrulama

- [ ] `cd backend && npm test` → hepsi PASS
- [ ] `cd kocamind-web && npm test && npm run build` → PASS
- [ ] `cd kocamind-android && ./gradlew testDebugUnitTest` → PASS
- [ ] Web önizlemede: boş ekran kartları, toast "Geri al". Android arayüzü cihazda denenmediyse raporda belirt.
