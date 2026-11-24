# KocaMind IDE

Electron, React ve Monaco Editor tabanlı; açılan yerel klasörde dosya okuyan, düzenleyen, komut çalıştıran ve her kritik adımı kullanıcı onayına sunan akıllı kod asistanına sahip masaüstü geliştirme ortamıdır. DeepSeek Harness (`dsh`) mimari prensiplerinden (bağımsız ve değiştirilebilir bileşenler, ekleme-yalnız oturum kaydı, onay politikası, diff denetimi, iz/trajectory görünümü) esinlenilerek geliştirilen yerel bir agent çekirdeğine sahiptir. Hassas API anahtarları masaüstüne inmez; model çıkarımları KocaMind backend vekili üzerinden kotalı ve kimlik doğrulamalı olarak yürütülürken, dosya ve terminal araçları doğrudan kullanıcının bilgisayarında Electron ana sürecinde çalışır.

## Çalıştırma

### Gereksinimler
- **Node.js**: v20+ (önerilen v22+ veya v24)
- **npm**: v10+

### Kurulum
```bash
cd kocamind-ide
npm install
```

### Geliştirme
Vite geliştirme sunucusunu ve Electron masaüstü uygulamasını eş zamanlı başlatır:
```bash
npm run dev:electron
```
*(Yalnızca web arayüzünü tarayıcıda çalıştırmak için: `npm run dev`)*

### Testler
Bütün testler harici test çatısı gerektirmeksizin Node.js yerleşik test koşucusu (`node --test`) ile çalışır.

> **Önemli (Windows Notu):** Windows ortamında `node --test` çalıştırırken doğrudan klasör yolu vermek yerine dosya glob'ları verilmelidir; aksi takdirde test dosyaları otomatik taranmayabilir.

- **Electron ve Agent çekirdeği testleri:**
  ```bash
  node --test electron/agent/test/*.test.cjs electron/test/*.test.cjs
  ```
- **React ve Arayüz testleri:**
  ```bash
  node --test src/agent/*.test.ts src/editor/*.test.ts src/terminal/*.test.ts
  ```

### Tip ve Kod Kalite Denetimi
```bash
npx tsc -b
npx oxlint
```

### Üretim Derlemesi
TypeScript tip kontrolü ve Vite derlemesini çalıştırır (`dist/` çıktısı üretir):
```bash
npm run build
```

### Masaüstü Paketleme
Paketleme yapılandırması `electron-builder` ile `package.json` içerisinde Windows (NSIS), macOS (DMG) ve Linux (AppImage) için tanımlanmıştır:
```bash
npm run pack   # Dizin halinde paketler (release/)
npm run dist   # Kurulum paketini üretir
```
*(Not: Paketleme betikleri yapılandırılmış olmakla birlikte henüz üretim ortamında uçtan uca denenmemiştir.)*

## Ortam Değişkenleri

Uygulama varsayılan değerlerle doğrudan çalışabilir; gerektiğinde aşağıdaki ortam değişkenleri ile yapılandırılabilir:

### IDE (Masaüstü) Tarafı
| Değişken | Açıklama | Koddan Varsayılan Değer |
|---|---|---|
| `KOCAMIND_API_URL` | KocaMind backend API taban adresi | `https://api.kocamind.com` |
| `KOCAMIND_WEB_URL` | Tarayıcıdan giriş yönlendirmesi için web adresi | `https://kocamind.com` |
| `KOCAMIND_FIREBASE_API_KEY` | Firebase REST API anahtarı (custom token takası için) | `AIzaSyCXZA4rixnuuus280X8yzh339e-mln6X8M` |
| `KOCAMIND_DEV` | Geliştirme modunu belirler (`0` verilirse yerel dist/index.html yüklenir) | Paketlenmemişken `1` (aktif) |

### Backend Tarafı
| Değişken | Açıklama | Koddan Varsayılan Değer |
|---|---|---|
| `IDE_MODELS` | IDE'de kullanılabilecek aktif sağlayıcı:model listesi | `deepseek:deepseek-chat` |
| `FREE_DAILY_IDE_LIMIT` | Ücretsiz kullanıcılar için günlük IDE istek kotası | `150` |
| `PRO_DAILY_IDE_LIMIT` | Pro aboneler için günlük IDE istek kotası | `3000` |

## Giriş Akışı (Tarayıcıdan Giriş ve Yerel Dönüş)

Kullanıcı masaüstü uygulamasında API anahtarı veya parola girmez; tarayıcı tabanlı güvenli bir OAuth benzeri döngü çalışır:

1. **Giriş Başlatma:** Kullanıcı paneldeki "Giriş Yap" düğmesine tıklar (`auth:login` IPC çağrısı).
2. **Geçici Yerel Sunucu:** Electron ana süreci (`electron/auth.cjs`), `127.0.0.1` adresinde işletim sisteminin atadığı rastgele bir portta geçici bir HTTP sunucusu açar ve 32 baytlık rastgele bir `state` (base64url) üretir.
3. **Tarayıcı Açılışı:** Sistem varsayılan tarayıcısında `${KOCAMIND_WEB_URL}/ide-login?port=${port}&state=${state}` adresi açılır.
4. **Tek Kullanımlık Kod Üretimi:** Web arayüzünde oturumu açık olan kullanıcı onay verdiğinde, web frontend'i `POST /ide/auth/code` çağrısı yapar. Backend, 120 saniye geçerli tek kullanımlık bir giriş kodu (`code`) üretir; kodun SHA-256 özetini ve `stateHash` değerini Firestore `ide_login_codes` koleksiyonuna yazar.
5. **Yerel Geri Dönüş:** Tarayıcı `http://127.0.0.1:${port}/callback?code=${code}&state=${state}` adresine yönlenir ve tarayıcı sekmesinde onay mesajı gösterilir.
6. **Doğrulama ve Takas:** Yerel HTTP sunucusu gelen `state` değerini zamanlama saldırılarına dayanıklı biçimde (`crypto.timingSafeEqual`) doğrular. Ardından backend'in `POST /ide/auth/exchange` ucuna `code` ve `state` gönderir.
7. **Jeton Üretimi:** Backend kodu bir kez kullanılmak üzere tüketir (`used: true`) ve `{ ide: true }` yetkili bir Firebase `customToken` döner.
8. **Jeton Saklama:** Electron, Firebase Auth REST API ile bu customToken'ı `idToken` ve `refreshToken` ile takas eder.

### Güvenlik Önlemleri
- **Tek Kullanımlık Kod:** Kodlar 120 saniye TTL ile sınırlandırılmıştır; Firestore'da açık metin yerine SHA-256 özeti tutulur ve ilk kullanımda geçersiz kılınır.
- **Sadece Yerel Ağ (127.0.0.1):** Dinleyici sunucu yalnızca yerel döngü arayüzüne bağlıdır; dış ağlardan erişilemez.
- **Güvenli Saklama (`safeStorage`):** Yenileme jetonu işletim sisteminin yerel şifreleme mekanizmasıyla (Windows DPAPI, macOS Keychain, Linux Secret Service) şifrelenerek `auth.bin` dosyasında saklanır. Şifreleme desteklenmiyorsa jeton diske hiç yazılmaz.
- **Gizlilik:** Loglarda veya hata mesajlarında yetkilendirme kodları ve jetonlar asla yazdırılmaz.

## Özellikler

### Asistan Paneli (Agent Panel)
- **Çalışma Modları:**
  - `Her şeyi sor` (`ask`): Okuma serbesttir; dosya oluşturma/düzenleme ve komut çalıştırma kullanıcı onayına sunulur.
  - `Düzenlemeyi otomatik yap` (`auto-edit`): Dosya okuma ve yazma serbesttir; terminal komutları onay ister.
  - `Salt okuma` (`read-only`): Yalnızca okuma ve arama araçları serbesttir; hiçbir dosya yazma veya komut çalıştırma yapılamaz.
- **Araçlar Kataloğu:**
  - `read_file`: Çalışma alanındaki dosya içeriğini (isteğe bağlı satır aralığıyla) okur.
  - `list_dir`: Belirtilen klasördeki dosya ve alt klasörleri listeler.
  - `glob`: Belirtilen kalıba (`pattern`) uyan dosyaları arar.
  - `grep`: Dosya içeriklerinde regex araması yapar (satır numarası ve metin eşleşmesiyle).
  - `write_file`: Çalışma alanında yeni bir dosya oluşturur veya mevcut dosyayı baştan yazar.
  - `edit_file`: Dosya içinde `old_string` metnini `new_string` ile değiştirir (`replace_all` destekler).
  - `run_command`: Çalışma alanı kökünde terminal komutu yürütür (çıktı sınırı ve süre bütçesi korumalı).
  - `update_plan`: Çok adımlı görevlerde yapılacaklar planını (`pending`, `in_progress`, `completed`) dinamik olarak günceller.
  - `task`: Bağımsız okuma/araştırma görevlerini alt asistanlara paralel olarak dağıtır.
  - `load_skill`: Projedeki bir yeteneğin (`.kocamind/skills/<ad>/SKILL.md`) ayrıntılı talimatlarını bağlama yükler.
  - `web_search`: Backend vekili üzerinden güncel internet aramaları yapar.
  - `web_fetch`: Belirtilen web sayfasının metin içeriğini çeker (60.000 karakter sınırı).
- **Onay ve Diff Görünümü:** Dosya değişikliklerinde Monaco tabanlı yan yana/satır içi diff arayüzü açılır; kullanıcı değişiklikleri satır satır inceleyip onaylayabilir veya reddedebilir.
- **Okumadan Düzenleme Yasağı:** Asistan bir dosyayı `read_file` ile okumadan `edit_file` veya var olan dosyaya `write_file` uygulayamaz. Dosya okunduktan sonra diskte değişmişse sha256 uyuşmazlığı tespit edilerek işlem durdurulur ve önce dosyanın güncel halinin okunması zorunlu tutulur.
- **Geri Al (Undo/Revert):** `agent:revertLastTurn` mekanizması, son turda `write_file` ve `edit_file` ile yapılan dosya değişikliklerini otomatik oluşturulan checkpoint kayıtlarından önceki orijinal haline geri döndürür (yeni açılan dosyalar silinir, değişenler eski haline gelir).
- **İz Görünümü (Trace View):** Geçmiş ve aktif turların adımları, çağrılan araçlar, yürütme süreleri, token kullanımı ve onay geçmişi `TraceView` üzerinden incelenebilir.
- **Oturumlar (Session Management):** Oturumlar JSONL tabanlı ekleme-yalnız (`append-only`) dosyalar halinde saklanır. Var olan oturumlar listelenebilir, kaldığı yerden sürdürülebilir (`agent:resume`) veya yeni oturuma geçilebilir.
- **Bağlam Sıkıştırma (Context Compaction):** Token bütçesi sınırına yaklaşıldığında, önce eski araç çıktıları kırpılır (`trimOldToolOutputs`); bütçe yine yetersizse geçmiş turlar model tarafından özetlenerek sistem talimatına dönüştürülür (`summarizeHistory`).
- **Alt Asistan (`task`):** Birbirinden bağımsız dosya tarama ve araştırma işleri, yalnızca salt okunur araçlarla (`read_file`, `list_dir`, `glob`, `grep`, `web_search`, `web_fetch`) sınırlı alt asistanlara devredilerek paralel çalıştırılır.
- **Proje Talimatları:** Çalışma alanının kökünde yer alan `KOCAMIND.md` veya `AGENTS.md` dosyası otomatik olarak okunarak modelin sistem mesajına eklenir (en fazla 20 KB).
- **Proje Yetenekleri (Skills):** Proje dizinindeki `.kocamind/skills/<ad>/SKILL.md` dosyaları otomatik olarak taranır ve sistem mesajında bir katalog olarak sunulur; asistan ihtiyaç duyduğunda `load_skill` aracıyla tam talimatları yükler.
  ```markdown
  ---
  name: ornek-skill
  description: Bu skill'in ne yaptığını belirten kısa açıklama.
  ---

  Skill'in ayrıntılı talimatları, kuralları ve adımları...
  ```
- **Model Seçimi:** Asistan panelindeki model seçici (`ModelPicker`) ile backend kataloğundaki uygun modeller arasında geçiş yapılabilir.

### Editör ve Çalışma Alanı
- **Sekme Yönetimi:** Açık dosyalar için sekmeler, kirli (kaydedilmemiş) dosya göstergesi (`●`), `Ctrl+S` ile kaydetme, `Ctrl+W` ile sekme kapatma.
- **Dosya İşlemleri:** Dosya ağacından yeni dosya/klasör oluşturma, yeniden adlandırma, çöp kutusuna güvenli silme (`shell.trashItem`).
- **Hızlı Dosya Açma (`Ctrl+P`):** Proje içindeki dosyaları bulanık arama (`fuzzy search`) ile hızlıca bulup açmayı sağlayan QuickOpen arayüzü.
- **Alt Terminal Paneli (`Ctrl+` `):** Çalışma alanı kök dizininde komut çalıştırabilen, canlı ANSI renkli çıktı akışı sunan, komut geçmişi (yukarı/aşağı ok) ve çalışan süreci sonlandırma desteği bulunan entegre terminal paneli.

## Güvenlik Modeli

1. **Çalışma Alanı Sınırı:** Bütün dosya erişim araçları (`read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`) açılan çalışma alanı klasörüyle sınırlandırılmıştır. Mutlak yollar, `..` ile kök dışına çıkma ve sembolik bağlar (symlink) üzerinden dışarı taşma girişimleri reddedilir.
2. **Onay Politikası ve Tehlikeli Komut Koruması:**
   - Okuma araçları serbestken; dosya yazma ve komut çalıştırma kullanıcı onayına bağlıdır.
   - `rm -rf`, `del /s`, `rd /s`, `format`, `mkfs`, `dd`, `shutdown`, `git push`, `git reset --hard`, `git clean`, `npm publish`, `curl/wget | sh`, `sudo`, `chmod -R 777`, `Remove-Item -Recurse` vb. tehlikeli komut kalıpları, `auto-edit` modunda olunsa dahi **kesinlikle kullanıcı onayı gerektirir**.
3. **Electron Sandbox ve Gezinme Kısıtlamaları:**
   - Renderer pencereleri `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` bayraklarıyla çalışır.
   - Pencere içinde bilinmeyen adreslere gezinme (`will-navigate`, `will-redirect`) engellenir.
   - Yeni pencere açma istekleri (`setWindowOpenHandler`) engellenir; yalnızca güvenli dış bağlantılar (`https:`, `mailto:`) sistem varsayılan tarayıcısında açılır.
   - Webview (`will-attach-webview`) ve yetkisiz oturum izinleri (`setPermissionRequestHandler`) tamamen kapatılmıştır.
   - Monaco Editor kaynakları harici CDN yerine doğrudan yerel paket içerisinden yüklenir.
4. **Sunucunun Araç Çalıştırmaması:**
   - Backend asla yerel dosya okuma/yazma veya terminal komutu çalıştırma yetkisine sahip değildir.
   - Backend yalnızca kotalı bir model ve web vekili olarak çalışır; tüm araç kararları ve çalıştırma işlemleri kullanıcının yerel makinesinde gerçekleşir.

## Bilinen Sınırlar

- **Gerçek PTY Desteği Yok:** Dahili terminal ve `run_command` aracı, sanal terminal emülatörü (node-pty) yerine `child_process.spawn` tabanlı süreç akışı kullanır. İnteraktif CLI uygulamaları (`nano`, `vim`, interaktif soru-cevap CLI'ları) desteklenmez.
- **Terminal Değişikliklerinin Geri Alınamaması:** `agent:revertLastTurn` mekanizması yalnızca `write_file` ve `edit_file` ile yapılan dosya değişikliklerini geri alabilir. `run_command` aracılığıyla kabukta çalıştırılan komutların (örn. `git`, derleme, dosya taşıma vb.) yol açtığı yan etkiler geri alınamaz.
- **Uçtan Uca Manuel Doğrulama:** Kod tabanındaki tüm birim ve entegrasyon testleri (%100 oranında) geçmektedir; ancak uygulama henüz son kullanıcı düzeyinde masaüstünde manuel uçtan uca doğrulanmamıştır.
- **Dağıtım Paketleri:** `electron-builder` yapılandırması mevcut olmakla birlikte ikili kurulum paketleri (installer) henüz derlenip test edilmemiştir.
- **Tek Çalışma Alanı:** Aynı anda tek bir kök klasör açılabilir; çoklu çalışma alanı (multi-root workspace) desteği bulunmamaktadır.

## Klasör Yapısı

```text
kocamind-ide/
├── electron/                   # Electron ana süreç kodları
│   ├── main.cjs                # Giriş noktası, pencere yaşam döngüsü ve IPC kayıtları
│   ├── auth.cjs                # Tarayıcı tabanlı giriş ve güvenli jeton saklama
│   ├── agentIpc.cjs            # Agent arayüzü ile çekirdek arası IPC köprüsü
│   ├── terminalIpc.cjs         # Alt terminal süreci çalıştırma ve çıktı akışı
│   ├── workspaceIpc.cjs        # Klasör açma, dosya okuma/yazma/silme işlemleri
│   ├── security.cjs            # Pencere sertleştirme, gezinme ve CSP güvenlik politikaları
│   ├── agent/                  # Agent çekirdeği (saf CommonJS, arayüzden bağımsız)
│   │   ├── index.cjs           # Runtime yöneticisi ve proje istemi oluşturucu
│   │   ├── loop.cjs            # Çok adımlı agent yürütme döngüsü
│   │   ├── approvals.cjs       # Mod tablosu ve tehlikeli komut denetimi
│   │   ├── sessionLog.cjs      # JSONL oturum kaydı ve plan geri yükleme
│   │   ├── checkpoints.cjs     # Tur bazlı dosya yedekleme ve geri alma
│   │   ├── compact.cjs         # Bağlam kırpma ve geçmiş özetleme
│   │   ├── projectContext.cjs  # KOCAMIND.md, AGENTS.md ve .kocamind/skills/ ayrıştırıcı
│   │   ├── modelAdapter.cjs    # Backend /ide/complete vekiline bağlanan model adaptörü
│   │   ├── tools/              # Agent araçları (read_file, edit_file, task vb.)
│   │   └── test/               # Agent çekirdeği birim testleri
│   └── test/                   # Electron ana süreç ve entegrasyon testleri
├── src/                        # React ve Vite tabanlı kullanıcı arayüzü
│   ├── main.tsx                # React kökü
│   ├── App.tsx                 # Ana pencere düzeni, menü, dosya ağacı, editör ve paneller
│   ├── agent/                  # Asistan paneli, onay ekranı, diff ve iz bileşenleri
│   ├── editor/                 # Monaco editör, sekme yöneticisi ve QuickOpen (Ctrl+P)
│   ├── terminal/               # Alt terminal paneli ve ANSI renk işleyici
│   └── types/                  # Ortak TypeScript tip tanımları
├── package.json                # Bağımlılıklar, betikler ve electron-builder ayarları
└── vite.config.ts              # Vite yapılandırması
```
