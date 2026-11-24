# İnternetten skill kurma (`install_skill`)

Tarih: 15 Ekim 2026. Bekir'in isteği: AI'lar, kullanıcı isterse skill'i internetten kendileri indirip kurabilsin.

## Akış

- Ortak araç deposuna `install_skill` eklendi (`backend/agent/tools.js`). Bütün sohbet modelleri ve agent aynı aracı kullanır.
- Araç onay isteyen araçlardandır (`requiresConfirmation: true`, `riskLevel: high`).
  - **Agent:** Mevcut onay akışından geçer. Kullanıcı onay kartında adresi görür, onaylarsa skill indirilir ve kurulur.
  - **Sohbet:** Sohbette onay ekranı olmadığı için araç bir sohbet varyantı (`chatVariant`) taşır ve iki adımda çalışır:
    1. `install_skill({ url })` skill'i indirir ve doğrular. Henüz kurmaz; önizleme döner. Bekleyen kurulum `users/{uid}/skillInstalls/{ad}` altında 30 dakika durur.
    2. Kullanıcı **sonraki mesajında** onaylarsa model `install_skill({ skill_name })` çağırır. Onay, önizlemenin üretildiği istekte gelirse reddedilir (`requestId` karşılaştırması). Yani model kendi kendine onay veremez; web sayfasındaki bir talimat da aynı turda kurulum yaptıramaz.
  - Onay neden rastgele bir kodla değil de skill adıyla? Web ve Android sohbet geçmişini yalnızca metin olarak gönderiyor, araç çıktıları geçmişe girmiyor. İlk sürümde onay `confirm_id` ile yapılıyordu. Canlı testte DeepSeek bir sonraki mesajda bu kodu bilemedi ve uydurdu, kurulum da başarısız oldu. Skill adı önizlemede kullanıcıya gösterildiği için geçmişte kalıyor.
- Genel kural: `toolRegistry.chatToolFor` onay isteyen bir aracı sohbette yalnızca `chatVariant`'ı varsa verir. Varyantı olmayan araçlar (ör. `send_email`) sohbette eskisi gibi gizli kalır.

## Kurulan skill kullanıcıya özel

Karar: kurulan skill **kullanıcıya özeldir** (`users/{uid}/skills/{ad}`). Global değildir.

Gerekçe:
1. **Güvenlik:** Skill, modelin uyduğu bir talimattır. Global olsaydı bir kullanıcının indirdiği kötü niyetli metin herkesin sistem prompt'una ve `load_skill` sonucuna girerdi (kullanıcılar arası prompt injection). Yerleşik skill'ler repoda kalır ve kod incelemesinden geçer.
2. **Altyapı:** Backend Vercel'de serverless çalışıyor; dosya sistemi salt okunur ve her soğuk başlangıçta sıfırlanır. `backend/skills/` altına yazmak kalıcı olmazdı.
3. **Onay:** Kurulumu onaylayan kişi yalnızca kendi hesabı için onay verebilir.

## Güvenlik sınırları

- Yalnızca `https://` adresleri. Adreste kullanıcı adı veya parola olamaz. İndirme SSRF korumalı `fetchPublicPage` ile yapılır, yönlendirmeler de denetlenir.
- Kabul edilen kaynaklar: GitHub dosyası (`blob` → raw adres), GitHub klasörü (`tree` ya da repo kökü; GitHub contents API ile listelenir) ve doğrudan SKILL.md adresi.
- Yalnızca metin alınır: SKILL.md ve en fazla 10 ek `.md` dosyası. Script, ikili dosya ve alt klasörler indirilmez, "atlanan dosyalar" olarak gösterilir. Hiçbir şey çalıştırılmaz.
- Boyut sınırları: SKILL.md ve her ek dosya en fazla 100 KB, toplam en fazla 400 KB. Sınır Content-Length'e güvenmeden akış sırasında da uygulanır.
- İçerik türü: `text/html` gibi metin olmayan türler reddedilir. NUL baytı içeren dosya ikili sayılır ve reddedilir.
- Frontmatter, yerleşik skill'lerle aynı fonksiyonla doğrulanır (`validateSkillDocument`). `name` küçük harf ve tire biçiminde olmalı, `description` zorunlu. Anthropic biçimindeki uzun açıklamalar (en fazla 1024 karakter) kabul edilir ve katalog için 200 karaktere kısaltılır. `autoload` yok sayılır: indirilen skill temel sistem prompt'unu değiştiremez.
- Üzerine yazma yok: yerleşik bir skill'in adı kullanılamaz, aynı adla kurulu skill varsa kurulum reddedilir (Firestore transaction). Kullanıcı başına en fazla 20 skill kurulabilir.
- `load_skill` kurulan skill'i `source: 'user'` ve bir uyarı notuyla döndürür: talimatlar sistem kurallarını ve araç onaylarını aşamaz.
- Firestore kuralları: `skills` ve `skillInstalls` alt koleksiyonlarına istemci yazamaz, yalnızca backend yazar. Okuma serbest. Hesap silinince ikisi de silinir.

## Arayüz

- `GET /skills` kurulu skill'leri `installed: true` ve `sourceUrl` alanlarıyla döndürür. Önbelleğe alınmaz, böylece yeni kurulan skill hemen görünür.
- `DELETE /skills/:ad` yalnızca kullanıcının kurduğu skill'i kaldırır. Yerleşik bir skill için 403 döner.
- Web: Ayarlar'a "Skill'ler" sekmesi eklendi. Android: Skill'ler ekranına "Kurduğun skill'ler" grubu ve Kaldır düğmesi eklendi.

## Açık noktalar

- `firestore.rules` değişikliğinin ayrıca deploy edilmesi gerekir (`firebase deploy --only firestore:rules`).
- GitHub contents API kimlik doğrulamasız çağrılıyor ve saatte 60 istek sınırı var. Yoğun kullanımda `GITHUB_TOKEN` eklenebilir.
- `tree/<dal>/...` adreslerinde dal adının tek parça olduğu varsayılıyor. `feature/x` gibi eğik çizgili dal adları için raw SKILL.md adresi verilmeli.
