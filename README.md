# KocaMind

KocaMind; Türkçe konuşan, uygun fiyatlı ve yüksek kaliteli bir yapay zekâ asistanıdır. Sohbet, fotoğraf ve video üretimi, onay isteyen Agent modu, derin araştırma, belge ve görsel ekleme, sesli mesaj/sesli okuma ile Android cihazlarda internetsiz yerel yapay zekâ (`llama.cpp` GGUF) yeteneklerini tek uygulamada birleştirir.

## Repo Haritası

- [`backend/`](backend/README.md) — Express tabanlı çoklu model ağ geçidi, Firebase Auth/Firestore entegrasyonu, Qdrant RAG, hafıza, iyzico faturalama, medya ve agent araçlarını sunan sunucu servisi.
- [`kocamind-web/`](kocamind-web/README.md) — React 19 ve Vite ile geliştirilen, Firebase destekli, SSE akışlı web sohbet istemcisi (PWA).
- [`kocamind-android/`](kocamind-android/README.md) — Kotlin ve Jetpack Compose ile geliştirilmiş, bulut modellerinin yanı sıra `llama.cpp` JNI köprüsü üzerinden çevrimdışı GGUF modelleri çalıştıran native Android uygulaması.
- `kocamind-ide/` — Electron, React ve Monaco Editor tabanlı masaüstü kod geliştirme arayüzü (yayın sonrası kapsamda).
- `docs/` — Tasarım planları, kurulum kılavuzları, marka belgeleri ve [mimari dokümantasyon](docs/mimari.md).

## Yerel Çalıştırma

### 1. Backend (`backend/`)

Gereksinimler: Node.js 20+.

```bash
cd backend
npm install
cp .env.example .env   # Windows CMD: copy .env.example .env
npm start
```

- Varsayılan port: `3001` (`PORT` ortam değişkeni ile değiştirilebilir).
- Sağlık kontrolü: `GET /` ve `GET /health`.
- Yerel ortamda Firebase için `FIREBASE_SERVICE_ACCOUNT` (tek satırlık JSON) veya Application Default Credentials gerekir; ayrıca en az bir aktif model sağlayıcı anahtarı (`OPENAI_API_KEY` veya `DEEPSEEK_API_KEY`) tanımlanmalıdır.

### 2. Web İstemcisi (`kocamind-web/`)

```bash
cd kocamind-web
npm install
cp .env.example .env.local   # Windows CMD: copy .env.example .env.local
npm run dev
```

- Yerelde backend'e bağlanmak için `.env.local` içine `VITE_BACKEND_URL=http://localhost:3001` ekleyin. Firebase Web SDK değişkenleri `kocamind-web/src/lib/firebase.js` içinde varsayılan değerlere sahiptir; kendi Firebase projenizi kullanacaksanız `VITE_FIREBASE_*` değişkenlerini ekleyin.
- Geliştirme sunucusu varsayılan olarak Vite üzerinden `5173` portunda açılır.

### 3. Testler

- **Backend:**
  ```bash
  cd backend
  node --test test/*.test.js
  ```
  > **Windows notu:** Windows üzerinde `node --test test` gibi klasör adı vermek çalışmaz; `test/*.test.js` dosya kalıbı kullanılmalıdır.
- **Web:**
  ```bash
  cd kocamind-web
  npx vitest run
  ```

## Ortam Değişkenleri

Gizli anahtar değerleri repoya ve belgelere yazılmaz; yalnızca değişken adları aşağıda listelenmiştir.

### Backend (`backend/.env`)

| Değişken | Ne İçin | Durum (Zorunlu / Varsayılanlı / Özelliğe Özel) |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service-account JSON'u | Hayır (ADC alternatifi; prod'da önerilir) |
| `FIREBASE_PROJECT_ID` | Firebase proje kimliği | Varsayılanlı (`kocamind`) |
| `FIREBASE_STORAGE_BUCKET` | Üretilen görsel/video dosyaları için Storage kovası | Varsayılanlı (`kocamind.firebasestorage.app`) |
| `OPENAI_API_KEY` | OpenAI Responses API anahtarı | Sağlayıcı anahtarı (`/health` için OpenAI veya DeepSeek gerekir) |
| `DEEPSEEK_API_KEY` | DeepSeek API anahtarı | Sağlayıcı anahtarı (`/health` için OpenAI veya DeepSeek gerekir) |
| `EVREN_LLM_API_KEY` | EVREN (SSB SAYZEK) model servisi anahtarı | Özelliğe özel (tanımlıysa EVREN modelleri açılır) |
| `GEMINI_API_KEY` | Google Gemini görsel/video üretimi ve sohbet anahtarı | Özelliğe özel (görsel/video için yeterli; sohbet için `GEMINI_CHAT_ENABLED=true` da gerekir) |
| `GEMINI_CHAT_ENABLED` | `true` ve `GEMINI_API_KEY` birlikteyse Gemini sohbet modellerini açar | Özelliğe özel (varsayılan kapalı) |
| `GROQ_API_KEY` | Groq API anahtarı (katalogda tanımlı, varsayılan aktif değil) | Opsiyonel |
| `ANTHROPIC_API_KEY` | Anthropic API anahtarı (katalogda tanımlı, varsayılan aktif değil) | Opsiyonel |
| `XAI_API_KEY` | xAI API anahtarı (katalogda tanımlı, varsayılan aktif değil) | Opsiyonel |
| `TAVILY_API_KEY` | Web araması (`webSearch`) için Tavily API anahtarı | Özelliğe özel (yoksa DuckDuckGo yedeği kullanılır) |
| `QDRANT_URL` | Kalıcı RAG vektör veritabanı adresi | Varsayılanlı (`http://localhost:6333`; RAG için erişilebilir olmalı) |
| `ALLOWED_ORIGINS` | Virgülle ayrılmış CORS izinli origin listesi | Varsayılanlı (`kocamind.com` ve `localhost:5173`; üretim alanları her zaman eklenir) |
| `PORT` | Backend dinleme portu | Varsayılanlı (`3001`) |
| `CRON_SECRET` | Vercel Cron (`/cron/*`) uçları için Bearer sırrı | Özelliğe özel (cron uçları için gerekir) |
| `RESEND_API_KEY` | Resend üzerinden e-posta gönderimi | Özelliğe özel (e-posta gönderimi için gerekir) |
| `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_PRICING_PLAN_REFERENCE_CODE` | iyzico abonelik ve checkout entegrasyonu | Özelliğe özel (faturalamayı etkinleştirir) |
| `IYZICO_MERCHANT_ID` | iyzico webhook (`x-iyz-signature-v3`) imza doğrulaması | Özelliğe özel (webhook doğrulaması için gerekir) |
| `IYZICO_MODE`, `IYZICO_BASE_URL` | iyzico çalışma modu (`live` / sandbox) ve API taban adresi | Varsayılanlı (`sandbox` ve `sandbox-api.iyzipay.com`; `live` ise `api.iyzipay.com`) |
| `BILLING_SETUP_TOKEN` | `POST /billing/setup` ile sandbox planı oluşturma sırrı | Özelliğe özel |
| `PUBLIC_BACKEND_URL`, `PUBLIC_FRONTEND_URL` | Ödeme callback ve yönlendirme adresleri | Varsayılanlı (`https://api.kocamind.com` ve `https://kocamind.com`) |
| `CONNECTOR_TOKEN_KEY` | Google Takvim/Drive, Notion, GitHub OAuth token şifreleme anahtarı | Özelliğe özel (bağlayıcılar için gerekir) |
| `MODEL_PRICING_JSON` | Model başına 1M token USD fiyat haritası (maliyet ölçümü) | Opsiyonel |
| `AUTO_ROUTER_MODELS`, `AUTO_ROUTER_COST_WEIGHT` | Otomatik model seçici adayları ve maliyet ağırlığı | Opsiyonel |
| `ALERT_WEBHOOK_URL`, `ALERT_ERROR_RATE`, `ALERT_MIN_CALLS`, `ALERT_AVG_LATENCY_MS`, `ALERT_CLIENT_ERRORS`, `ALERT_CLIENT_ERROR_SPIKE` | Model sağlığı ve istemci hata uyarı webhook'u ile eşikleri | Özelliğe özel (webhook URL gerekir; eşikler varsayılanlı) |
| `JAILBREAK_GUARD` | `off` yapılırsa jailbreak ön taramasını devre dışı bırakır | Varsayılanlı (etkin) |
| `FREE_DAILY_*_LIMIT`, `PRO_DAILY_*_LIMIT` | Günlük kullanım kotaları (`CHAT`, `AGENT`, `IMAGE`, `VIDEO`, `CODE`, `UPLOAD`, `SEARCH`, `ASSIST`, `IDE`, `FEEDBACK`) | Varsayılanlı (`backend/quota.js`) |
| `IDE_MODELS` | `/ide/models` ve `/ide/complete` için izinli model listesi | Opsiyonel |
| `MEMORY_SERVER_LEARN` | `true` ise sunucu tarafı arka plan hafıza öğrenimini açar | Varsayılanlı (`false`) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Yönetici `send_email` aracı için Gmail kimlik bilgileri | Özelliğe özel |

### Web (`kocamind-web/.env.local`)

| Değişken | Ne İçin | Durum (Zorunlu / Varsayılanlı / Özelliğe Özel) |
|---|---|---|
| `VITE_BACKEND_URL` | Backend API taban adresi | Varsayılanlı (`https://api.kocamind.com`; yerelde `http://localhost:3001`) |
| `VITE_FIREBASE_API_KEY` | Firebase Web SDK API anahtarı | Varsayılanlı (`kocamind-web/src/lib/firebase.js`) |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth alan adı | Varsayılanlı (`kocamind.firebaseapp.com`) |
| `VITE_FIREBASE_PROJECT_ID` | Firebase proje kimliği | Varsayılanlı (`kocamind`) |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage kovası | Varsayılanlı (`kocamind.firebasestorage.app`) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase mesajlaşma gönderici kimliği | Varsayılanlı (`956051927831`) |
| `VITE_FIREBASE_APP_ID` | Firebase uygulama kimliği | Varsayılanlı (`kocamind-web/src/lib/firebase.js`) |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google ile giriş için OAuth istemci kimliği | Opsiyonel |
| `VITE_USE_FIREBASE_EMULATOR` | `1` yapılırsa E2E/yerel testlerde Auth ve Firestore emülatörünü etkinleştirir | Özelliğe özel (kabul edilen değer: `1`) |

## Dağıtım

- **Backend ve Web:** Her iki servis de Vercel üzerine dağıtılır (`backend/vercel.json`, `kocamind-web/vercel.json`).
- **Firestore Kuralları:**
  ```bash
  firebase deploy --only firestore:rules
  ```
- **Android ve IDE Dağıtımı:** Android release APK imzalama adımları [`kocamind-android/README.md`](kocamind-android/README.md) içinde belgelenmiştir; uçtan uca yayın/mağaza dağıtım adımları ve `kocamind-ide/` paketleme dağıtımı bu dokümanda doğrulanmamıştır.

## Daha Fazlası

Sistem bileşenleri, sohbet veri akışı, Firestore koleksiyonları, güvenlik katmanları ve cron işleri için bkz. [`docs/mimari.md`](docs/mimari.md).
