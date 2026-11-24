# KocaMind Web

React 19 ve Vite ile geliştirilen KocaMind sohbet istemcisi. Firebase Authentication/Firestore, çoklu yapay zekâ sağlayıcıları, streaming, araçlar, RAG, hafıza ve PWA desteği içerir.

## Yerel geliştirme

Gereksinimler: Node.js 20+ ve çalışan KocaMind backend servisi.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Kalite kontrolleri:

```bash
npm run lint
npm test
npm run build
```

## Ortam değişkenleri

Değişkenler `.env.example` içinde belgelenmiştir. `VITE_` ile başlayan değerler tarayıcıya açıktır; gizli anahtarlar burada tutulmamalıdır. AI sağlayıcı anahtarlarının tamamı backend’de kalır.

## Kimlik doğrulama

`/` sağlık kontrolü ve `/models` kataloğu dışındaki backend endpointleri Firebase ID token ister. Web istemcisi güncel tokenı `Authorization: Bearer …` başlığıyla otomatik gönderir. Yönetim ekranı için kullanıcı tokenında `admin: true` custom claim bulunmalıdır.

## Veri modeli

- Yerel sohbetler: `localStorage / kocamind_chats`
- Bulut sohbetleri: `users/{uid}/chats/{chatId}`
- Özel asistanlar: `users/{uid}/settings/assistants`
- Geri bildirimler: `feedback/{id}`

Firestore kuralları her kullanıcının yalnızca kendi ağacına erişmesine izin verir.

## Dağıtım

Frontend build çıktısı `dist/` klasörüne yazılır. Backend dağıtımında `FIREBASE_SERVICE_ACCOUNT` veya çalışma ortamının Application Default Credentials yapılandırması zorunludur. Production CORS adresleri `ALLOWED_ORIGINS` ile açıkça tanımlanmalıdır.

Gizlilik ve kullanım koşulları `public/privacy.html` ve `public/terms.html` altındadır. Hukuki metinler production öncesinde hukuk danışmanı tarafından gözden geçirilmelidir.
