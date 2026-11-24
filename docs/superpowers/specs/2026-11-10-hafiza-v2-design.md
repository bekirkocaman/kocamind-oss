# Hafıza v2: tek beyin, zengin hafıza, kendi kendine gelişme

Tarih: 10 Kasım 2026
Durum: Tasarım, Bekir'in onayını bekliyor

## Amaç

KocaMind'ın web, Android ve (yakında) masaüstü uygulamaları aynı kullanıcı hafızasını aynı şekilde kullansın; hafıza sohbeti yavaşlatmasın; zamanla kendi kendine düzelsin.

Bu spec üç alt projenin ilkidir. Sıra: (1) Hafıza v2, (2) KocaMind Masaüstü, (3) Bilgisayar ajanı. Diğer ikisinin kendi spec'i olacak.

## Bekir'in verdiği kararlar

- Hız her şeyden önce gelir.
- Bütün istemciler ortak hafızayı kullanır.
- Hafıza kendi kendine gelişir. Kullanıcının verisi otomatik düzenlenir; çıkarma kuralları ve prompt değişiklikleri ölçümle birlikte Bekir'e sunulur ve onayla canlıya alınır.

## Bugünkü durum

- Depo ortak: Firestore `users/{uid}/memories`, anahtar-değer, kullanıcı başına en fazla 100 kayıt (`backend/memoryStore.js`, `backend/memoryAssist.js`).
- Hafızayı seçme ve prompt'a ekleme istemcide yapılıyor ve iki kopya var: `kocamind-web/src/lib/memoryContext.js` ve `kocamind-android/.../data/memory/MemoryContext.kt`. `backend/routes/chat.js` hafızayı eklemiyor; sadece öğrenilen cevap tarzını ve sohbet özetini ekliyor.
- Yeni bilgi öğrenme istemcinin ayrıca attığı `/memory/extract` isteğiyle oluyor (`chatSubmission.js:66`, `BackendClient.kt:381`).
- Sadece kişisel bilgiler öğreniliyor. Seçim, kelimelerin ilk beş harfinin örtüşmesine bakıyor.
- Gece işi (`backend/learning/nightly.js`, cron `30 3 * * *`) hafızaya dokunmuyor.

## Hedefler ve ölçütler

1. Hafıza seçme ve ekleme mantığı tek yerde, sunucuda.
2. Hafıza, sohbetin ilk token süresine p95'te 50 ms'den fazla eklemez. Cevap yolunda hafıza için model çağrısı yoktur.
3. Hafıza arızası sohbeti durdurmaz.
4. Eski uygulama sürümleri bozulmadan çalışır.
5. Gece bakımı tekrarları birleştirir, çelişkileri çözer, eskiyeni arşivler; her değişiklik kullanıcıya görünür ve geri alınabilir.

## Kapsam dışı

- Vektör araması ve bilgi grafiği. Birkaç yüz kayıtta kelime eşleşmesi yeterli ve daha hızlı.
- `cihaz` türündeki kayıtları doldurmak. Bu spec alanı ve kuralını tanımlar; doldurma bilgisayar ajanı spec'ine aittir.
- Masaüstü istemcisi.
- Çıkarma prompt'unun kendiliğinden değişmesi.

## Mimari

```
Web / Android / PC ──mesaj──▶ /chat
                               │ 1. hafıza paketini oku (önbellek, model yok)
                               │ 2. system prompt'a ekle
                               │ 3. modele gönder, cevabı akıt
                               ▼
                         cevap biter
                               │ 4. arka planda: bilgi çıkar, kaydet
                               │ 5. paketi yeniden derle
                               ▼
        sonuç pakete yazılır; istemci GET /memory/pack ile okur
```

### Birimler

| Birim | Dosya | Sorumluluk | Bağımlılık |
|---|---|---|---|
| Hafıza deposu | `backend/memoryStore.js` (mevcut, genişler) | Kayıt okuma, yazma, durum değiştirme | Firestore |
| Paket derleyici | `backend/memory/pack.js` (yeni) | Kayıtlardan paket üretir; saf fonksiyon | Yok |
| Paket deposu | `backend/memory/packStore.js` (yeni) | Paketi okur, yazar, bellekte önbellekler, zaman aşımı uygular | Firestore |
| Seçici | `backend/memory/select.js` (yeni) | Mesaja göre `optional` kayıtlardan ilgili olanları seçer; saf fonksiyon | Yok |
| Arka plan öğrenme | `backend/memory/learn.js` (yeni) | Cevap sonrası çıkarma, kaydetme, paketi yenileme | Depo, `memoryAssist`, paket |
| Sinyaller | `backend/memory/signals.js` (yeni) | Kullanım sayacı ve beğenmeme sinyali; toplu yazma | Depo |
| Gece bakımı | `backend/learning/memoryMaintenance.js` (yeni) | Birleştirme, çelişki, arşiv, geçmiş özeti | Depo, `memoryAssist`, paket |

`pack.js` ve `select.js` saf fonksiyon olduğu için Firestore olmadan test edilir.

### Hafıza paketi

Belge: `users/{uid}/memory_pack/current`

- `core`: her istekte eklenen hazır metin. Kişisel, tercih ve sağlık kategorisindeki `bilgi` kayıtları ile bütün `talimat` kayıtları.
- `optional`: konuya göre seçilecek kayıtların listesi (`key`, `value`, `type`, `deviceId`).
- `version`: her derlemede artan sayı.
- `builtAt`: derlenme zamanı.

Kurallar:

- Prompt'a giren toplam metin en fazla 3000 karakter. Sığmazsa önce güveni düşük, sonra en uzun süredir kullanılmayan kayıtlar dışarıda kalır.
- Sadece `aktif` durumdaki ve güveni 0.3'ün üstündeki kayıtlar pakete girer.
- Paket, hafıza her değiştiğinde yeniden derlenir: kaydetme, silme, içe aktarma, arka plan öğrenme, gece bakımı.
- Sunucu paketi kullanıcı başına 60 saniye bellekte tutar. Aynı sunucu örneğinde yapılan yazma önbelleği siler.
- Okuma 150 ms'de bitmezse sohbet hafızasız devam eder.

### Sohbet rotası

`backend/routes/chat.js` içinde system prompt kurulurken:

1. İstekte `memory: "server"` varsa paket, diğer okumalarla aynı anda okunur (ayrı bekleme yok).
2. `core` ve seçicinin `optional` içinden seçtiği kayıtlar bugünkü başlıkla eklenir ("Kullanıcı hakkında hafızandaki bilgiler...").
3. `cihaz` kayıtları sadece istekteki `device_id` ile eşleşiyorsa eklenir.
4. Eklenen kayıtların anahtarları sinyal birimine bildirilir.

İstekte `memory: "server"` yoksa sunucu hiçbir şey eklemez. Eski istemciler hafızayı kendi ekleyip göndermeye devam eder; çift ekleme olmaz.

### Arka plan öğrenme

Cevap tamamlandıktan sonra sunucu çıkarma işini Vercel `waitUntil` ile kendisi başlatır.

- Bugünkü ön eleme (`mightContainPersonalInfo`) ve günlük `assist` kotası aynen uygulanır.
- Öğrenme yalnızca istekte `memory_learn: true` varsa başlar. Gizli sohbeti ve "otomatik kayıt" ayarını sunucu bilmez; bu durumlarda istemci alanı göndermez.
- Öğrenmenin sonucu pakete `lastLearn` alanı olarak yazılır: zaman, kaydedilen anahtarlar (`isNew` işaretiyle) ve unutulanlar. İstemci cevap bittikten birkaç saniye sonra `GET /memory/pack` çağırır; `lastLearn` yeniyse "Geri al" bildirimini gösterir. Bu çağrı model ve kota harcamaz.
- Sonucu aynı bağlantıdan olay olarak göndermek reddedildi: akışlı cevap beş ayrı yerde kapanıyor (`chatToolLoop.js`, `responsesToolLoop.js`, `openaiResponses.js`, `chat.js`); hepsine dokunmak sohbetin en kritik yolunu riske atar.
- `/memory/extract` rotası eski istemciler için ve arka plan işi çalışmazsa yedek olarak yerinde kalır. `GET /memory/pack` cevabındaki `serverLearn` alanı istemciye hangisini kullanacağını söyler.

**Doğrulanması gereken varsayım:** `waitUntil` projede şu an kullanılmıyor. Uygulama planının ilk adımı, Vercel'de cevap gittikten sonra arka plan işinin tamamlandığını küçük bir denemeyle doğrulamaktır. Çalışmazsa çıkarma bugünkü gibi istemci tetiklemeli kalır; spec'in geri kalanı değişmez.

### İstemciler

- Web: `chatSubmission.js` hafızayı seçip eklemeyi ve `/memory/extract` çağrısını bırakır, isteğe `memory: "server"` ve (otomatik kayıt açıksa) `memory_learn: true` ekler, cevaptan sonra paketi okuyup `lastLearn`'e bakar. Ajan yolu paketin hazır metnini kullanır. `memoryContext.js` içindeki `selectRelevantMemories` ve `formatMemoriesForPrompt` silinir; sohbet bağlamı planlama fonksiyonları kalır.
- Android: aynı değişiklik `MemoryRepository.kt`, `MemoryContext.kt`, `BackendClient.kt` içinde. Ek olarak paketin `core` metni ve `version` yerelde saklanır; telefondaki yerel model internetsiz çalışırken bu metni aynen kullanır.
- Yeni uç: `GET /memory/pack` paketin `core` metnini ve `version` değerini döndürür.
- Hafıza sayfası (liste, sil, içe aktar, yorum) bugünkü rotalarla çalışmaya devam eder.

## Veri modeli

`users/{uid}/memories/{key}` kayıtlarına eklenen alanlar. Eksik alan varsayılan değerle okunur; veri taşıma işi yoktur.

| Alan | Değer | Varsayılan |
|---|---|---|
| `type` | `bilgi`, `talimat`, `gecmis`, `cihaz` | `bilgi` |
| `confidence` | 0 ile 1 arası | 0.7 |
| `lastUsedAt` | ISO tarih | boş |
| `useCount` | sayı | 0 |
| `status` | `aktif`, `arsiv`, `gecersiz` | `aktif` |
| `supersededBy` | yerini alan kaydın anahtarı | boş |
| `deviceId` | sadece `cihaz` türünde | boş |

### Türler

| Tür | Örnek | Pakete girişi |
|---|---|---|
| `bilgi` | "şehir: Üsküp" | Kişisel, tercih, sağlık her zaman; diğerleri konuyla ilgiliyse |
| `talimat` | "Kısa ve net cevap istiyor" | Her zaman |
| `gecmis` | "5 Kasım: masaüstü planı konuşuldu" | Konuyla ilgiliyse |
| `cihaz` | "Projeler `D:\Kod` altında" | Sadece o cihazdan gelen isteklerde |

### Kurallar

- Bilgi değişince eski kayıt silinmez; `gecersiz` olur ve `supersededBy` yenisini gösterir. Kullanıcı kendisi silerse kayıt gerçekten silinir.
- Aktif kayıt sınırı 300: 150 `bilgi`, 30 `talimat`, 80 `gecmis`, 40 `cihaz`. `arsiv` ve `gecersiz` kayıtlar sınıra sayılmaz. Kullanıcı başına `gecersiz` kayıt 200'ü geçerse en eskileri silinir.
- Kullanım sayaçları sunucu belleğinde birikir ve toplu yazılır. Sunucu örneği kapanırsa birikenler kaybolabilir; bu kabul edilir.
- Bugünkü hassas veri filtresi (parola, kart, T.C. kimlik, IBAN) bütün türlere uygulanır.
- Gizli sohbetten hiçbir türde kayıt çıkmaz.
- Hesap silme ve dışa aktarma (`backend/routes/account.js`) `memory_pack` belgesini de kapsar.

## Kendi kendine gelişme

### Gün içi sinyaller (model çağrısı yok)

- Kullanım: prompt'a giren kayıtların `useCount` ve `lastUsedAt` alanları güncellenir.
- Beğenmeme: beğenilmeyen cevapta prompt'a girmiş kayıtların `confidence` değeri 0.1 düşer. 0.3'ün altına inen kayıt pakete girmez ama silinmez.
- Düzeltme: kullanıcının düzeltmesi, zaten çalışan arka plan çıkarma çağrısında mevcut anahtarın güncellenmesiyle işlenir. Ek çağrı yoktur.

Beğenmeme sinyali için sohbet rotası, cevaba hangi hafıza anahtarlarının girdiğini geri bildirim kaydıyla eşleştirilebilecek biçimde saklar.

### Gece bakımı

Mevcut `/cron/self-improve` işine eklenir. Sadece son 24 saatte hafızası değişen kullanıcılar işlenir. Yardımcı model (bugün çıkarmada kullanılan) çağrılır; kullanıcı başına gecede en fazla iki çağrı.

Sırayla:

1. Birleştir: aynı bilgiyi taşıyan kayıtlar tek kayda iner.
2. Çelişkiyi çöz: çatışan iki kayıttan yenisi kalır, eskisi `gecersiz` olur.
3. Arşivle: 90 gündür prompt'a girmemiş ve `confidence` değeri 0.5'in altındaki kayıtlar `arsiv` olur. Kişisel, sağlık kategorileri ve `talimat` türü arşivlenmez.
4. Geçmişi özetle: günün gizli olmayan sohbetlerinden en fazla üç `gecmis` kaydı çıkar.
5. Paketi yeniden derle.

Gece bakımının her değişikliği `users/{uid}/memory_changes` altına yazılır (ne değişti, eski değer, tarih) ve hafıza sayfasında "Geri al" ile gösterilir. Kayıtlar 30 gün tutulur.

### Kural değişiklikleri (onaylı)

- Test seti: `memory_eval_cases`. Her vaka bir mesaj ve beklenen sonuçtur: kaydetmeli, kaydetmemeli, hassas.
- Kaynaklar: elle yazılan çekirdek set (repoda) ve kullanıcının "Geri al" ile reddettiği kayıtlar. Reddedilen kayıttan üretilen vaka, mevcut `eval_cases` düzenindeki gibi `uid` alanını yalnızca hesap silmede temizlenebilsin diye tutar; `uid` raporlara yazılmaz.
- Gece raporuna (`improvement_reports/{gün}`) hafıza bölümü eklenir: eklenen, geri alınan, birleştirilen, arşivlenen kayıt sayıları ve kategori başına geri alma oranı.
- Çıkarma prompt'u değişecekse `scripts/promptEval.js` düzeniyle eski ve yeni prompt test setinde ölçülür. Sonuç Bekir'e sunulur; onayla canlıya alınır. Sistem prompt'u kendiliğinden değiştirmez.

## Hata davranışı

| Durum | Davranış |
|---|---|
| Paket okunamadı ya da 150 ms'yi aştı | Sohbet hafızasız devam eder; metrik ve log yazılır |
| Arka plan çıkarma çöktü | Kullanıcı etkilenmez; metrik yazılır |
| Paket derleme çöktü | Eski paket kullanılır |
| Gece bakımı bir kullanıcıda çöktü | O kullanıcı atlanır, diğerleri işlenir, rapora yazılır |
| Yardımcı model kapalı | Çıkarma ve gece bakımı durur; okuma tarafı çalışır |

## Testler

- Birim (`backend/test/`): paket derleme ve boyut sınırı, seçici, tür payları, `gecersiz`/`supersededBy` kuralı, güven düşürme, arşiv kuralı, hassas veri filtresi, gizli sohbet.
- Rota: `/chat` işaret varken paketi ekler, yokken eklemez; zaman aşımında hafızasız cevap verir; öğrenme yalnızca başarılı cevaptan sonra ve `memory_learn` varken çalışır; `/memory/pack` sadece kendi kullanıcısının paketini döndürür.
- Gecikme: paket okuma süresi mevcut süre ölçümüne (`b0ada35`) ayrı bir kalem olarak yazılır.
- Web: `memoryContext.test.js` sadeleşir; `chatSubmission` `memory: "server"` gönderir ve `/memory/extract` çağırmaz.
- Android: yerel paket kopyası internetsiz modda kullanılır; sürüm değişince yenilenir.

## Yapım sırası

1. **Tek beyin:** `waitUntil` denemesi, paket, sunucuda ekleme, arka plan öğrenme, `/memory/pack`, web ve Android'in sadeleşmesi.
2. **Zengin hafıza:** yeni alanlar, türler, sınırlar, sinyaller.
3. **Gece bakımı ve test seti.**

Her aşama tek başına canlıya çıkabilir. Aşama 1, veri modelini değiştirmeden mevcut kayıtlarla çalışır.
