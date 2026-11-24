# KocaMind Backend

Express tabanlı AI gateway, RAG, hafıza, dosya/ses işleme ve agent araçları servisi.

```bash
npm install
copy .env.example .env
npm run dev
```

Sağlık kontrolü `GET /`, model kataloğu `GET /models` adresindedir. Diğer bütün endpointler geçerli Firebase ID token ister. Request gövdesindeki `userId` güvenilir kabul edilmez ve doğrulanmış token UID’siyle değiştirilir.

Production gereksinimleri:

- `FIREBASE_SERVICE_ACCOUNT` veya Application Default Credentials
- Daraltılmış `ALLOWED_ORIGINS`
- Kullanılan sağlayıcıların API anahtarları
- Kalıcı RAG için Qdrant
- Admin hesapları için Firebase custom claim: `{ admin: true }`

Service-account JSON’u veya sağlayıcı anahtarlarını repoya eklemeyin.

## iyzico abonelik kurulumu

Abonelik akışı varsayılan olarak sandbox modundadır. Kart bilgileri KocaMind'e gelmez; iyzico ödeme formunda işlenir. Gerekli ortam değişkenleri:

- `IYZICO_MODE=sandbox` ve `IYZICO_BASE_URL=https://sandbox-api.iyzipay.com`
- `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_MERCHANT_ID`
- `PUBLIC_BACKEND_URL` ve `PUBLIC_FRONTEND_URL`

Anahtarları `.env.billing.local` dosyasına ekledikten sonra aylık 350 TL Plus planını bir kez oluşturun:

```bash
npm run billing:setup
```

Komutun döndürdüğü değeri `IYZICO_PRICING_PLAN_REFERENCE_CODE` olarak sunucu ortamına ekleyin. iyzico panelindeki abonelik bildirim adresini şu HTTPS endpoint'ine ayarlayın:

```text
https://<backend-domain>/billing/iyzico/webhook
```

Sandbox ödeme, callback ve webhook akışı doğrulanmadan `IYZICO_MODE=live` kullanmayın.

## Gözlemleme

- `GET /health`: Firestore ve Qdrant erişimini, model anahtarlarının tanımlı olup olmadığını evet/hayır olarak döner. Sağlıksızsa `503` verir; uptime izleyicisine bu adresi ekleyin.
- `GET /admin/metrics?days=7` (yönetici): model başına günlük çağrı sayısı, hata oranı, HTTP durum kodları, ortalama gecikme, token sayıları ve tahmini maliyet.
- Kullanıcı başına günlük token ve tahmini maliyet `usage_daily/{uid}_{gün}` belgesine eklenir.
- Maliyet tahmini için fiyatları ortam değişkeniyle verin (1 milyon token başına USD). Tanımlanmayan modelde maliyet alanı boş kalır:

```bash
MODEL_PRICING_JSON={"gpt-5.6-luna":{"inputPerMTok":0,"outputPerMTok":0},"deepseek-chat":{"inputPerMTok":0,"outputPerMTok":0}}
```

Değerleri sağlayıcının güncel fiyat sayfasından doldurun.

## Hesap silme (60 gün bekleme)

- `DELETE /account` hesabı hemen silmez: `account_deletions/{uid}` kaydı açar, kullanıcıya `deletionPending` custom claim'i verir ve oturumlarını kapatır. Bu süre içinde API yalnızca `GET /account/deletion`, `POST /account/restore` ve `DELETE /account/now` uçlarına izin verir (`423 ACCOUNT_PENDING_DELETION`); Firestore kuralları da istemci erişimini kapatır.
- 60 gün dolunca Vercel Cron (`vercel.json > crons`, her gün 03:00 UTC) `GET /cron/purge-deleted-accounts` ucunu çağırır. Firestore verileri, Storage dosyaları (`generated-images/`, `generated-videos/`), Qdrant dokümanları ve Firebase Auth kullanıcısı silinir; faturalar yasal süre boyunca kalır.
- Cron ucu `CRON_SECRET` ortam değişkeni olmadan çalışmaz. Vercel'de bu değişkeni tanımlayın; Vercel her cron isteğine `Authorization: Bearer $CRON_SECRET` başlığını kendisi ekler.
- Başarısız silmeler `account_deletions` kaydında `lastError` ile kalır ve ertesi gün tekrar denenir.

## Kendini geliştiren döngü (`learning/`)

Kullanıcının beğen/beğenme oyları tek sinyal kaynağıdır. Hiçbir şey kendiliğinden canlıya alınmaz; prompt değişiklikleri her zaman insan onaylı PR ile gelir.

- **Geri bildirim:** `POST /feedback` (`{ type: 'up'|'down'|null, chatId, messageId, provider, model, question, answer }`). Kayıt `feedback/{uid}_{chatId}_{messageId}` belgesine yazılır, oy `model_scores/{kategori}_{model}` sayaçlarına eklenir. Kategoriler: `kod`, `matematik`, `yazi`, `arastirma`, `sohbet` (`learning/categories.js`).
- **Otomatik model:** `/models` listesinin başında `auto` görünür (en az iki model açıksa). `/chat` isteğinde `model: 'auto'` gelirse `learning/router.js` kategoriye göre Thompson örneklemesiyle model seçer; kalite eşitse ucuz model kazanır. Cevabı veren model `X-KocaMind-Provider` / `X-KocaMind-Model` başlıklarında döner. Ayarlar:
  - `AUTO_ROUTER_MODELS=gpt-5.6-luna,deepseek-chat` (isteğe bağlı aday listesi)
  - `AUTO_ROUTER_COST_WEIGHT=0.15` (maliyetin ağırlığı; fiyatlar `MODEL_PRICING_JSON`'dan)
- **Yanıt tarzı:** Gece işi kullanıcının oylarından kısa/ayrıntılı tercihini öğrenir (`user_style/{uid}`), sohbet sistem talimatına tek satır ekler. Kullanıcı Ayarlar > Gizlilik'ten kapatabilir (`GET/POST /learning/style`).
- **Gece işi:** Vercel Cron her gün 03:30 UTC'de `GET /cron/self-improve` çağırır (`CRON_SECRET` gerekir). Beğenilmeyen cevapları `eval_cases` test setine ekler, yanıt tarzlarını yeniler ve `improvement_reports/{gün}` raporunu yazar. Model çağırmaz, para harcamaz. Yönetici raporu: `GET /admin/learning/report?day=YYYY-MM-DD`.
- **Prompt denemesi (elle, ücretli):** Bir skill'i değiştirmeden önce adayı test setinde dene:

  ```bash
  node scripts/promptEval.js --skill genel-asistan --variant aday.md --limit 20
  ```

  Hakem model iki cevabı kör karşılaştırır; rapor `scripts/out/` altına yazılır (kullanıcı sorularını içermez). En az 10 kararlı karşılaştırmada %60 kazanırsa değişiklik önerilir.
- `feedback`, `eval_cases` ve `user_style` hesap silme ve dışa aktarmaya dahildir.

## IDE uçları

KocaMind masaüstü IDE'sinin (`kocamind-ide`) model tamamlama, web araçları ve tarayıcı tabanlı giriş akışı için sunulan backend uçları:

- `GET /ide/models`: IDE'de kullanılabilecek aktif ve araç destekli model listesini döner (`Firebase ID token` gerektirir; kota tüketmez; ortam değişkeni: `IDE_MODELS`, varsayılan `deepseek:deepseek-chat`).
- `POST /ide/complete`: IDE kod asistanı için streaming (SSE) veya tekil yanıtlı model tamamlama vekili (`Firebase ID token` gerektirir; kota türü: `ide`; ortam değişkenleri: `FREE_DAILY_IDE_LIMIT` [varsayılan: 150], `PRO_DAILY_IDE_LIMIT` [varsayılan: 3000], `IDE_MODELS`).
- `POST /ide/web/search`: IDE asistanı için internet araması vekili (`Firebase ID token` gerektirir; kota türü: `ide`; ortam değişkenleri: `FREE_DAILY_IDE_LIMIT`, `PRO_DAILY_IDE_LIMIT`).
- `POST /ide/web/fetch`: Belirtilen web adresinin metin içeriğini çeker ve en fazla 60.000 karakterle döner (`Firebase ID token` gerektirir; kota türü: `ide`; ortam değişkenleri: `FREE_DAILY_IDE_LIMIT`, `PRO_DAILY_IDE_LIMIT`).
- `POST /ide/auth/code`: Web oturumu açık olan kullanıcı için 120 saniye geçerli tek kullanımlık giriş kodu üretir (`Firebase ID token` gerektirir; kota tüketmez).
- `POST /ide/auth/exchange`: Masaüstü uygulamasının tek kullanımlık kod ve state karşılığında Firebase `customToken` aldığı uçtur (**kimlik gerektirmeyen tek IDE ucudur**; dakikada 20 istek rate-limit korumalıdır; kota tüketmez).
