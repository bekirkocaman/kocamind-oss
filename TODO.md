# KocaMind Yapılacaklar

**Hedef:** Yaklaşık 5–6 ay içinde (Mart–Nisan 2027) web, mobil ve backend'i kaliteli ve güvenilir halde yayına açmak.
**Kapsam:** Web + mobil + backend. IDE, video ve KocaMind 2.0 fikirleri yayından sonra (bkz. Buzdolabı).

## Kurallar

- "Şimdi" bölümünde aynı anda en fazla 3 iş olur. Biri bitmeden yenisi eklenmez.
- Her iş yarım günlük adımlara bölünür. Yarım günde bitmeyecek madde, adım değil projedir.
- Her pazartesi 15 dk: biteni işaretle, sıradakini aktif fazdan "Şimdi"ye çek.
- Yeni fikir gelirse düşünmeden Buzdolabı'na yazılır. Faz bitmeden fikir tartışılmaz.
- Faz 3'te 3–4 kişilik ücretsiz kapalı beta başlar. Hataların çoğu gerçek kullanımda ortaya çıkar.

## Şimdi (en fazla 3)

- [ ] Eşitlemeyi iki cihazda (telefon + web) gerçek hesapla dene: aynı sohbete iki taraftan yazma, bir tarafta silme, çevrimdışı yazıp bağlanma.

## Faz 1 — Veri bütünlüğü ve para (Ekim–Kasım 2026)

Amaç: hiçbir kullanıcının verisi kaybolmasın, karışmasın, haksız ücret yemesin.

_(18 Ekim 2026: kod maddeleri bitti; kalan iş canlı iki cihaz denemesi, Şimdi'de.)_

## Faz 2 — Test, CI ve gözlem (Aralık 2026)

Amaç: bir şey bozulduğunda kullanıcıdan önce sen öğren.

- [ ] Ödeme akışını iyzico sandbox ile uçtan uca dene (webhook imza ve tekrar senaryoları backend testlerinde var).
- [ ] Giriş yapmış Plus kullanıcı E2E senaryosu için test hesabı kur.
- [ ] Hata kayıtlarına uyarılar ekle; mobil çökme raporları. _(Model gecikmesi/hata/token/maliyet metrikleri ve `/health` var.)_
- [ ] Tekrarlanabilir ve geri alınabilir yayın akışı: web deploy, backend, APK, sürümleme.

## Faz 3 — Kalite + kapalı beta (Ocak–Şubat 2027)

Amaç: cevaplar gerçekten iyi olsun ve bunu ölçerek bil.

- [ ] Gizlilik politikası ve kullanım şartları. _(Beta gerçek kullanıcı verisi topladığı için betadan önce hazır olmalı.)_
- [ ] 3–4 kişilik ücretsiz kapalı beta başlat; hata bildirimi ve cevap puanlama ekle.
- [ ] Kötü cevap örneklerini cihaz, APK sürümü, model/GGUF dosyası ve üretim ayarlarıyla birlikte kaydet.
- [ ] Türkçe kalite seti: gündelik sohbet, çok adımlı mantık, matematik, yönerge takibi, bağlam hatırlama, bilinmeyen sorular. Modelleri aynı sorularla cihazda karşılaştır.
- [ ] Elle verilen `qualityScore`/zekâ puanlarını ölçülmüş sonuçlarla değiştir veya tahmin olarak etiketle.
- [ ] Düşünme (96/192) ve çıktı (512–1024) token sınırlarını soru zorluğuna göre ölçüp ayarla; bitiş nedenini kaydet. _(Kesilen cevap artık işaretleniyor.)_
- [ ] 2048–4096 token bağlamda sistem istemi/hafıza/geçmiş dengesini ölç; her modelin sohbet şablonu, düşünme ve stop ayarlarını doğrula.
- [ ] RAG: belge listesine sayfalama, yükleme ilerlemesi ve yanıttan kaynak belgeye erişim.

## Faz 4 — Yayına hazırlık (Mart 2027)

- [ ] Güvenlik ve gizlilik son kontrol: yetki rolleri, veri saklama süresi, Firebase kuralları, secret yönetimi.
- [ ] Kota: başarısız üretimde kota iadesi ve tekrar isteklerde çift ücret/kota tüketimi koruması. _(Kota doğrulanamazsa 503 zaten var.)_
- [ ] Onboarding / ilk kullanım yönlendirmesi.
- [ ] Kök README, mimari ve veri akışı açıklaması; mobil README'yi gerçek kurulum belgesiyle değiştir.
- [ ] Beta geri bildirimlerinden çıkan kritik hataları kapat.

## AI Ortak Depo (araç altyapısı)

Amaç: her konu için ayrı araç yazmadan, çok sayıda model ve araçla ölçeklenen tek bir depo. Az sayıda genel araç (arama, sayfa okuma, kod çalıştırma, RAG, hafıza) konuların çoğunu kapsar; özel araç yalnızca hesap erişimi, yan etkili eylem veya sık ve aramanın güvenilmez kaldığı veri için yazılır. Her madde ayrı spec → plan → uygulama. _(12 Ekim 2026)_

- [ ] Depo + model kartı: araçlara raf etiketi, modellere yetenek kartı (`supportsTools`, `maxTools`, `format`, `nativeTools`); yeni model = katalogda 1 satır, yeni araç = depoda 1 kayıt. OpenAI sohbetini de depoya bağla (şu an yalnızca kendi web aramasını görüyor). Araç sayısı sınırı aşınca `find_tools` ile ihtiyaç anında çekme.
- [ ] Kod çalıştırma sandbox'ı: model Python yazar, izole bir kutuda çalışır (Vercel Sandbox / E2B gibi). Hesap, birim/kur çevirme, CSV/Excel analizi, grafik. Kullanıcı kodu asla kendi sunucumuzda çalışmaz.
- [ ] Skill'ler + MCP: asistan tiplerinin (hukuk, sağlık, kod…) ihtiyaç anında çektiği talimat paketleri; dış entegrasyonlar (Gmail, takvim, Drive…) için MCP connector desteği. _(13 Ekim 2026: `skill-mcp-yerel` dalında kod ve testler hazır: 9 skill, Google Takvim/Drive, Notion, GitHub bağlantıları, OpenAI dahil bütün modeller ortak depoda. Kalan: OAuth uygulamaları ve env değişkenleri (`docs/connectors-kurulum.md`), canlı uçtan uca deneme.)_

## Buzdolabı (yayından sonra)

Güzel fikirler, ama yayına kadar dokunulmaz.

**IDE**
- IDE derlemesindeki kullanılmayan importlar ve klasör seçici TypeScript hatası.
- Gerçek model ve ses bağlantısı; dosyaya kaydetme, değişiklik önizleme/onay, terminal, Git, masaüstü paketi.

**Video üretim planları**
- Free: `gemini-omni-1.1-flash`; ayda 5 video, 3–5 sn, 360p/720p.
- Plus: `veo-3.1-fast-generate-preview`; ayda 30 video, 8 sn, 720p/1080p, ses ve görselden video.
- Pro: `veo-3.1-generate-preview`; ayda 100 video, 1080p/4K, referans görsel, ilk-son kare, video uzatma.
- Maliyet kontrolü: günlük/aylık kota, yeniden üretme sınırı, kuyruk, başarısız işlem takibi.
- Altyapı: backend job sistemi, ilerleme durumu, güvenli depolama, oynatıcı, API anahtarları yalnızca backend'de.

**KocaMind 2.0**
- Model Hub: yerel ve bulut modellerini tek arayüzde yönetme, akıllı model seçimi.
- Multimodal: görsel, PDF, ekran görüntüsü, ses, kamera.
- Kişisel bilgi kasası / gelişmiş RAG.
- Gerçek agent iş akışları: planlama, dosya tarama, rapor, görev oluşturma.
- MCP uyumluluğu ve MCP Apps.
- Hafıza görme/düzeltme/silme/dışa aktarma arayüzü.
- Offline-first AI: internetsiz dosya arama, özetleme, hafıza.
- AI çalışma alanı: dosyalar, sohbetler, görevler, agent'lar ve hafıza tek ekranda.
- Güven merkezi: kullanılan model, veri kaynağı, araç çağrıları, cihazda/bulutta işleme.
- Plugin SDK: manifest, izin sistemi, araç sözleşmesi, örnek eklentiler.

## Tamamlananlar

- [x] Giriş yapmış kullanıcıyla uçtan uca testler (`npm run test:e2e:full`, CI'da `web-e2e-full`): Firebase Auth/Firestore emülatörü + sahte model + gerçek backend + web. Sohbet ve ortak şema, iki cihazda gerçek zamanlı eşitleme ve silme, bağlantı kesilince kuyruk, hesap silme talebi ve geri alma. _(18 Ekim 2026; yerelde 8/8 tekrar temiz)_
- [x] Mobil CI (`.github/workflows/android.yml`): temiz kurulum, derleme/tip kontrolü, birim testleri, debug APK, Android lint (hata derlemeyi durdurur) ve imzasız release derlemesi. İki lint hatası düzeltildi (bildirim izni kontrolü, `LocalActivity`). _(18 Ekim 2026)_
- [x] Uzun sohbet özeti iki bölüme ayrıldı: "Kullanıcının söyledikleri" bilgi kabul edilir, "Asistanın önceki cevapları (doğrulanmamış)" kesin bilgi gibi tekrarlanmaz. Backend, web ve Android aynı başlığı kullanır (testle kilitli). Otomatik hafıza, kişi yorumu ve yerel sohbet hatırlatması zaten yalnız kullanıcı mesajından besleniyordu. _(18 Ekim 2026)_
- [x] Yerel model indirme: 13 model belirli Hugging Face commit'ine sabitlendi; inerken SHA-256 doğrulanır (`.part` → yerine taşıma), eski doğrulanmamış dosya ilk yüklemede bir kez kontrol edilip bozuksa silinir. _(18 Ekim 2026, testli; telefonda gerçek indirme denenmedi)_
- [x] Hesap silme: adımlar silme kaydına işlenir, yarıda kalan silme yalnız kalan adımları tekrarlar; geri almada önce kayıt silinir (kayıt kalıp hesabın sonradan silinmesi engellendi); kilit konamayan talep tekrarda kilitlenir; mail hatası işlemi bozmaz; bekleyen Qdrant silmeleri cron'da yeniden denenir. _(18 Ekim 2026, testli; canlıda denenmedi)_
- [x] Mobil hafıza: Firestore `users/{uid}/memories` kullanıcı başına cihazda da tutulur (açılışta ve çevrimdışıyken buradan); yerel model artık hafızayı da kullanıyor, hesap silinince kopya silinir. _(18 Ekim 2026, testli; telefonda denenmedi)_
- [x] Kotlin çevrimdışı kuyruk: hesap değişince süren iş durur, açık sohbet sahibinin geçmişine yazılır (önceden sonraki hesaba sızabiliyordu). Kuyruk kendi sohbetine döner, aynı mesaj iki kez gitmez. _(18 Ekim 2026, testli; telefonda denenmedi)_
- [x] Web ve Android ortak sohbet şeması: her mesajda `id`, `user`/`ai` rolü, milisaniye `timestamp` (`chatSchema.js`, `CloudChatMapping.kt`). _(18 Ekim 2026)_
- [x] Sohbet eşitleme: üç yönlü birleştirme, transaction ile yazma, başarısız yazma/silmeyi tekrar deneme, gerçek zamanlı dinleme; silinen sohbet geri gelmez. Spec: `docs/superpowers/specs/2026-10-18-sohbet-esitleme-design.md`. _(18 Ekim 2026, testli; canlıda iki cihazla denenmedi)_
- [x] AI'ların internetten skill kurması (`install_skill`) ve EVREN modelleri. _(15 Ekim 2026)_

- [x] Eski `/tools/*` endpointleri kaldırıldı; araçlar yalnızca onaylı sunucu agent'ından çalışıyor. _(24 Eylül 2026)_
- [x] `/tools/scrape` kaldırıldı; agent aracı SSRF korumalı. DNS rebinding açığı kapatıldı.
- [x] Hafıza/profiller Firestore'a taşındı (`users/{uid}/memories`, `admin_profiles`).
- [x] Hesap silme/dışa aktarma kapsamı genişletildi; hatalar yutulmuyor, faturalar saklanıyor.
- [x] Mobil `package.json` ve kilit dosyası tamamlandı, `llama.rn` sabitlendi, `tsc` temiz.
- [x] E2E testleri Plus erişim koşuluna göre güncellendi; misafir yolu ayrı test edildi.
- [x] Tarih/saat, hesaplama, birim dönüşümü çevrimdışı cihaz araçlarına yönlendirildi (`offlineDeviceTools.ts`).
- [x] Model gecikmesi/hata/token/maliyet metrikleri ve `/health` eklendi.
- [x] Otomatik hafıza ve uzun sohbet özetleme.
- [x] RAG yüklemesi sıfır parçayı, başarısız embedding'i ve yarım kaydı başarı saymıyor; yarım kalan kayıt temizleniyor. _(7 Ekim 2026)_
