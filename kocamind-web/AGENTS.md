# KocaMind Web

Türkçe yapay zeka sohbet asistanı. React + Vite SPA; bütün AI çağrıları KocaMind backend üzerinden yapılır.

## Tech Stack

- **Frontend**: React 19, Vite 8, CSS custom properties (dark/light)
- **AI**: Backend `/chat` (OpenAI Responses, DeepSeek) ve sunucu tarafı agent `/agent/run`
- **Auth/Sync**: Firebase Auth + Firestore
- **Storage**: localStorage (chats, settings, PWA cache)
- **Deploy**: Vercel (`https://kocamind.com`)

## Dizin Yapısı

```
src/
├── App.jsx          # Ana uygulama ve durum yönetimi
├── App.css          # Global stiller, design token'lar
├── components/      # UI bileşenleri
│   ├── SettingsModal.jsx  # Ayarlar (11 sekmeli)
│   ├── Sidebar.jsx
│   └── ...
└── lib/
    ├── chatSubmission.js   # Mesaj gönderme akışı (medya, Gmail, agent, /chat)
    ├── nativeAgentRunner.js # Sunucu agent'ının SSE istemcisi ve onay akışı
    ├── pluginManager.js    # Ayarlardaki araç kataloğu ve Gmail gelen kutusu okuma
    └── ...
```

## Komutlar

```bash
npm run dev      # Geliştirme sunucusu
npm run build    # Production build
npm run lint     # ESLint
npm run preview  # Build önizleme
```

## Deploy

```bash
npm run build
vercel --prod --yes   # Direkt production deploy, kocamind.com'a alias
```

## Kod Kuralları

- CSS değişkenleri: `--bg`, `--surface`, `--accent`, `--text` vb. kullan
- localStorage: `STORAGE_KEY`, `MODEL_KEY`, `SETTINGS_KEY` vb. sabitler
- Mesaj objesi: `{ role: 'user'|'ai', content, id, timestamp, ... }`
- Türkçe karakterler ve format korunur
- Yorum ekleme
- Mevcut pattern'leri takip et, yeni kütüphane eklemeden önce kod tabanını kontrol et

## Önemli Notlar

- Kullanıcı Türkçe konuşur
- AI cevapları Türkçe olmalı (dil ayarı İngilizce değilse)
- Streaming: `/chat` ve `/agent/run` SSE akışları `createSmoothTextStream` ile gösterilir
- Araçlar tarayıcıda çalıştırılmaz; araç seçimi, doğrulama ve riskli işlem onayı sunucudaki agent'tadır
- `save_memory` aracı sessiz çalışır, sohbet ekranında görünmez
- PWA desteği var (`vite-plugin-pwa`)
