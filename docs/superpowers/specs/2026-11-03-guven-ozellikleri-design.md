# Güven özellikleri: tasarım

3 Kasım 2026. Dayanak: `docs/brand/2026-10-28-fark-mesaji-ve-play-metni.md` ("seni kandırmayan yapay zeka") ve BekooOS'taki rakip notları. Rakip yorumlarındaki ortak şikâyet: gizli ücret, çabuk biten mesaj hakkı, kullanıcının neyin olduğunu bilmemesi.

## Amaç

Fark mesajındaki "Dürüst / İş bitirir / Türkçe önce" sözlerini uygulamada görünür kanıta çevirmek. Beş özellik sırayla, her biri ayrı commit.

## Mevcut durum (kodda doğrulandı)

- Kota: `backend/quota.js` günlük sayaç tutuyor, her istekte `X-Daily-Limit` ve `X-Daily-Remaining` başlıklarını gönderiyor. `/usage/me` var. Kullanım bilgisi yalnızca Ayarlar > Kullanım'da görünüyor, sohbet ekranında yok.
- Hafıza: Ayarlar > Hafıza ekranı Android'de ve web'de var (listeleme, tek tek silme, tümünü silme, "Hafızayı kullan" anahtarı, içe aktarma). Web'de kayıttan sonra bilgi mesajı çıkıyor. Android'de kayıt **sessiz** (`MemoryRepository`: "arka planda, sessizce").
- Yerel model: Android'de GGUF + llama.cpp (`data/offline`). Web'de yerel model yok.
- Skill'ler: `dilekce`, `resmi-eposta`, `hukuk-bilgisi`, `cv-yazma`, `saglik-bilgisi`, `derin-arastirma` vb. var ama kullanıcı bunları boş sohbet ekranında görmüyor.

## 1. Şeffaf sayaç

Kota mesaj sayısına göre işliyor, token'a göre değil. Bu yüzden "bu yanıt şu kadar token harcadı" demeyiz; ancak gerçek olanı gösteririz.

- Android ve web, sohbet yanıtındaki `X-Daily-Limit` / `X-Daily-Remaining` başlıklarını okur ve kalan hakkı durum olarak tutar.
- Kalan hak limitin %20'sine düşünce, mesaj kutusunun üstünde ince bir satır çıkar: "Bugün 8 mesaj hakkın kaldı · 03:00'te yenilenir". Altında değilken hiçbir şey gösterilmez (kalabalık yapmaz).
- Hak bitince (429) hata balonu yerine özel bir durum gösterilir: "Bugünkü mesaj hakkın bitti. HH:MM:ss sonra yenilenir." Yenilenme hesabı mevcut `resetCountdown` mantığını kullanır. Android'de indirilmiş yerel model varsa "Telefondaki modelle devam et" düğmesi de çıkar.
- Yerel modelin ürettiği yanıtın altında küçük not: "Telefonda üretildi · hak harcamaz".
- Test: başlık ayrıştırma ve eşik mantığı için birim testleri (web `usage.test.js`, Android `UsageLogic` testleri).

## 2. Görünür hafıza

Ekran zaten var, eksik olan **sohbet sırasındaki görünürlük**.

- Android'de hafızaya bir bilgi kaydedilince Snackbar çıkar: "Hafızaya eklendi: <anahtar> · Geri al". "Geri al" o kaydı siler.
- Web'deki bilgi mesajına da "Geri al" eklenir.
- Hafıza kapalıyken ("Hafızayı kullan" kapalı) otomatik kayıt hiç çalışmaz. Bu davranış kodda doğrulanacak, değilse düzeltilecek.
- Test: geri alma işleminin doğru kaydı sildiğini gösteren repository/birim testi.

## 3. Gizli sohbet (yalnızca Android)

- Yeni sohbet ekranında "Gizli sohbet" anahtarı. Açıkken:
  - Mesajlar yalnızca telefondaki yerel modelle üretilir, backend'e hiçbir istek gitmez.
  - Sohbet geçmişe kaydedilmez, eşitlenmez, hafıza çıkarımı yapılmaz.
  - Ekranın üstünde sabit işaret: "Gizli sohbet · Bu sohbet telefondan çıkmaz ve kaydedilmez".
- Yerel model indirilmemişse anahtar Çevrimdışı Modeller ekranına yönlendirir.
- Fotoğraf/video üretimi, web araması, Agent ve Derin Araştırma gizli sohbette kapalıdır (hepsi bulut ister).
- Web'de yapılmaz: yerel model olmadığı için "telefondan çıkmaz" sözü doğru olmaz.
- Test: gizli modda backend istemcisinin çağrılmadığını ve sohbetin depoya yazılmadığını gösteren ViewModel testi.

## 4. Türkiye'ye özel işler

Yeni altyapı yok; mevcut skill'leri bulunur hale getiriyoruz.

- Boş sohbet ekranında 4 öneri kartı: "Dilekçe yaz", "Resmi e-posta yaz", "Faturamı açıkla", "Fotoğraftan soru çöz".
- Kart, mesaj kutusunu hazır bir başlangıç cümlesiyle doldurur (göndermez). Fotoğraf isteyen kartlar fotoğraf seçiciyi açar.
- İki yeni skill: `fatura-okuma` (elektrik/su/doğalgaz/telefon faturasındaki kalemleri ve tutarı sade Türkçe açıklar) ve `soru-cozme` (YKS/KPSS tarzı soruyu adım adım çözer, cevabı en sonda verir). Mevcut skill klasör biçimine uyar.
- Test: skill dosyalarının mevcut skill testlerinden geçmesi; kart → istem eşlemesi için birim testi.

## 5. "Emin değilim" dürüstlüğü

- Sistem istemlerine (web `prompts.js`, Android `ChatViewModel` sistem istemi, gerekiyorsa backend) kural eklenir: bilmediğini ya da emin olmadığını açıkça söyle, tahmini tahmin diye belirt, kaynak, rakam veya alıntı uydurma.
- Derin Araştırma kaynak döndürüyor ama arayüzde gösterilmiyorsa, yanıtın altına kaynak bağlantıları eklenir. Kaynak hiç dönmüyorsa bu madde bu spec'in kapsamı dışında kalır ve not olarak yazılır.
- Test: istem metninin kuralı içerdiğini gösteren birim testi. Model davranışı Faz 3'teki Türkçe kalite setiyle ölçülecek; burada iddia edilmez.

## Kapsam dışı

- Token bazlı maliyet gösterimi (kota token'la işlemiyor).
- Web'de gizli sohbet.
- Fiyat ve plan metinleri (`[KARAR]` bekliyor).

## Doğrulama

Her adımdan sonra: web için `npm test` (+ build), backend için `npm test`, Android için birim testleri (`gradlew testDebugUnitTest`). Görsel değişiklikler web önizlemesinde kontrol edilir. Android arayüzü cihazda denenmedikçe "denenmedi" diye raporlanır.
