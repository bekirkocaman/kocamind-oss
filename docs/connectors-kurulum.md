# Bağlantılar ve Skill'ler — kurulum rehberi

Bu rehber, `skill-mcp-yerel` dalındaki Skill sistemi ve Bağlantılar (MCP) özelliklerini canlıya almak için **senin** yapman gereken adımları anlatır. Kod hazır ve test edildi. Dış hesaplarda (Google Cloud, GitHub, Vercel) yapılacak işleri ben yapamam.

Tasarım belgeleri:
- [Skill tasarımı](superpowers/specs/2026-10-12-skills-design.md)
- [MCP / bağlantılar tasarımı](superpowers/specs/2026-10-12-mcp-connectors-design.md)

## 0. Hiçbir şey yapmazsan ne olur?

- **Skill'ler hemen çalışır.** Ek ayar gerekmiyor. Asistan tipleri (genel, kod, hukuk, sağlık, derin araştırma) artık `backend/skills/` altındaki paketlerden geliyor. Ek olarak dilekçe, CV, resmî e-posta ve kod inceleme skill'leri var.
- **OpenAI sohbeti de ortak araçları kullanır.** Bu değişiklik canlıda gerçek OpenAI hesabıyla test edilmedi. OpenAI 400 hatası verirse sohbet otomatik olarak eski araçsız yola döner. Tamamen kapatmak için Vercel'e `OPENAI_CHAT_TOOLS=false` ekle.
- **Bağlantılar kapalı kalır.** `CONNECTOR_TOKEN_KEY` tanımlı olmadığı için Ayarlar > Bağlantılar'da Google Takvim, Drive, Notion ve GitHub "Yakında" görünür. Mevcut Gmail bağlantısı eskisi gibi çalışır.

## 1. Şifreleme anahtarı (zorunlu)

Bağlantı tokenları Firestore'a AES-256-GCM ile şifrelenerek yazılır. 32 baytlık rastgele bir anahtar üret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Bunu Vercel `kocamind-backend` projesine **Production** ortamı için `CONNECTOR_TOKEN_KEY` olarak ekle. Anahtarı kimseyle paylaşma ve kaybetme: değişirse bütün kullanıcıların bağlantıları "yeniden bağlan" durumuna düşer.

Ayrıca şu iki değişken tanımlı olmalı:
- `PUBLIC_BACKEND_URL` = `https://api.kocamind.com` (zaten var)
- `CONNECTORS_RETURN_URL` = `https://kocamind.com/` (bağlantıdan sonra kullanıcının döneceği adres; web uygulaması `?durum=` parametresini okuyup Ayarlar > Bağlantılar'ı açar)

Yalnız bu adımla **Notion** kullanılabilir hâle gelir, çünkü Notion dinamik istemci kaydı (DCR) destekliyor. Diğerleri için aşağıdaki OAuth uygulamaları gerekiyor.

## 2. Google Takvim ve Drive

1. [Google Cloud Console](https://console.cloud.google.com/) → mevcut `kocamind` projesi.
2. **APIs & Services → Library**: "Google Calendar API" ve "Google Drive API"yi etkinleştir.
3. **OAuth consent screen**: uygulama adı KocaMind, destek e-postası, gizlilik politikası adresi. Kapsamlar:
   - `https://www.googleapis.com/auth/calendar.events` (hassas kapsam: Google doğrulaması gerekir, ücretli denetim gerekmez)
   - `https://www.googleapis.com/auth/drive.file` (hassas değil)
4. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized redirect URI: `https://api.kocamind.com/connectors/callback`
5. Çıkan değerleri Vercel'e ekle: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

Not: Uygulama Google doğrulamasından geçene kadar consent ekranı "Testing" modunda kalır. Bu modda yalnızca test kullanıcısı olarak eklediğin hesaplar bağlanabilir ve yenileme tokenları 7 günde düşer.

Drive kısıtı: `drive.file` kapsamı yalnızca KocaMind'in oluşturduğu ya da kullanıcının KocaMind ile açtığı dosyaları görür. Kullanıcının bütün Drive'ını göremez. Bu bilinçli bir seçim, çünkü geniş Drive kapsamı ücretli CASA denetimi gerektiriyor. Kullanıcının mevcut dosyalarını seçebilmesi için ileride web'e Google Picker eklenebilir.

## 3. GitHub

1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**.
   - Homepage URL: `https://kocamind.com`
   - Authorization callback URL: `https://api.kocamind.com/connectors/callback`
2. Vercel'e ekle: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`.
3. İsteğe bağlı: varsayılan kapsam `repo read:org` (özel depolar dahil). Daha dar tutmak istersen `GITHUB_OAUTH_SCOPES=public_repo read:user` ekle.

Bağlantı GitHub'ın uzak MCP sunucusunu (`https://api.githubcopilot.com/mcp/`) kullanıcının OAuth tokenıyla çağırır. Bu sunucunun OAuth App tokenlarını kabul ettiğini canlıda **doğrulamadım**. İlk bağlantı denemesinden sonra bir şey sor ("depolarımı listele") ve sonucu kontrol et.

## 4. Notion

Ek ayar gerekmiyor. İlk bağlantıda KocaMind, Notion'un MCP sunucusunda (`https://mcp.notion.com/mcp`) kendini otomatik kaydeder. Güvenlik önlemi olarak, keşfedilen yetkilendirme sunucusunun alan adı `notion.com` ile bitmiyorsa bağlantı reddedilir. Bu akış canlıda **test edilmedi**.

## 5. Diğer ayarlar (isteğe bağlı)

| Değişken | Varsayılan | Ne işe yarar |
|---|---|---|
| `CONNECTORS_FREE` | yok (Plus gerekli) | `true` ise bağlantılar ücretsiz kullanıcılara da açılır |
| `CONNECTORS_DISABLED` | yok | Virgülle ayrılmış bağlayıcıları kapatır, örn. `github,notion` |
| `MAX_CHAT_TOOLS` | 24 | Sohbette bu sayıdan fazla araç varsa model `find_tools` ile arar |
| `SKILL_CATALOG_LIMIT` | 30 | Bu sayıdan fazla skill varsa katalog yerine `find_skills` kullanılır |
| `OPENAI_CHAT_TOOLS` | açık | `false` ise OpenAI sohbeti ortak araçları almaz |

## 5b. Android

Android'de Ayarlar > Yapay zekâ altında **Bağlantılar** ve **Skill'ler** sayfaları var. Bağla'ya basınca izin ekranı tarayıcıda açılır. Bağlantı bitince sunucu kullanıcıyı web'e değil `kocamind://baglantilar?durum=...` adresine yönlendirir ve uygulama bu adresle Bağlantılar sayfasına döner. Uygulama bağlanırken isteğe `{"client":"android"}` ekler. Dönüş adresi istekten alınmaz, yalnızca izinli iki sabitten (web ya da android) biri seçilir. Ek ortam değişkeni gerekmiyor.

## 6. Firestore kuralları

Yeni koleksiyonlar (`connector_connections`, `connector_oauth_states`, `connector_clients`) mevcut catch-all deny kuralıyla istemciye zaten kapalı. `firestore.rules` değişmedi. Ancak 7 Ekim'deki `billing` açığı düzeltmesinin deploy edildiğinden emin değilim, onu ayrıca kontrol et:

```bash
npx firebase-tools deploy --only firestore:rules
```

## 7. Deneme listesi

1. Vercel'e değişkenleri ekleyip backend'i deploy et (`backend/` içinde `vercel --prod`), web'i deploy et (`kocamind-web/` içinde `vercel --prod`).
2. `https://api.kocamind.com/health` 200 dönmeli.
3. Plus hesabınla Ayarlar > Bağlantılar → Google Takvim → Bağla. Google izin ekranından sonra "Google Takvim bağlandı." bildirimi görünmeli.
4. Sohbette (DeepSeek ve GPT ile ayrı ayrı) "Bu hafta takvimimde ne var?" diye sor. Araç durumu görünmeli, gerçek etkinlikler listelenmeli.
5. Sohbette "Yarın 15:00'e toplantı ekle" de. Model bunun Agent modunda onayla yapılabileceğini söylemeli. Agent modunda aynı isteği ver: onay kartı çıkmalı, onaydan sonra etkinlik eklenmeli.
6. Hukuk asistanını seçip "kira artışı için dilekçe yaz" de. Model `dilekce` skill'ini yüklemeli (araç durumu: `load_skill`).
7. Bağlantıyı kes. Google hesabının "Üçüncü taraf erişimi" listesinden de KocaMind kalkmalı.
