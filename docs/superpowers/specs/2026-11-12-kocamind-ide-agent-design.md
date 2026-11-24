# KocaMind IDE: kod agent'ı tasarımı

Tarih: 2026-11-12. Durum: Aşama 1 başladı.

## Amaç

`kocamind-ide` (Electron + React + Monaco) içinde, açılan klasörde dosya okuyan, düzenleyen, komut çalıştıran ve her riskli adımı kullanıcıya onaylatan bir kod agent'ı. Örnek alınan: DeepSeek Harness (`dsh`, Ağustos 2026, MIT). Ondan alınan fikirler: her parçanın değiştirilebilir olması, ekleme-yalnız oturum kaydı, onay politikası, adım/tur olayları, diff inceleme, iz (trajectory) görünümü.

`dsh`'nin kendisini gömmüyoruz: geliştirici önizlemesinde, uyumluluğu bozacağını söylüyor ve Cordis çatısını getiriyor. Aynı özellikleri kendi küçük çekirdeğimizle yazıyoruz.

## Mimari kararlar

1. **Döngü masaüstünde, model backend'de.** Agent döngüsü ve araçlar Electron ana sürecinde çalışır (dosya ve kabuk yerelde). Model çağrısı backend üzerinden gider; API anahtarı masaüstüne hiç inmez. Model, döngüye bir "adaptör" olarak verilir; test adaptörü sahte, gerçek adaptör Aşama 2'de backend'e bağlanır.
2. **Çekirdek arayüzden bağımsız.** `kocamind-ide/electron/agent/` saf Node (CommonJS), bağımlılıksız, `node --test` ile test edilir. Arayüz çekirdeğe yalnızca IPC ile ulaşır.
3. **Çalışma alanı sınırı.** Bütün dosya araçları açılan klasörün içinde kalır; `..`, mutlak yol ve sembolik bağ ile dışarı çıkış reddedilir.
4. **Onay politikası.** Okuma serbest; yazma ve komut varsayılan olarak onay ister. Tehlikeli komut kalıpları her modda onay ister.
5. **Ekleme-yalnız oturum kaydı.** Her tur JSONL'e olay olarak yazılır; model geçmişi bu kayıttan türetilir. Kayıt yeniden yazılmaz.
6. **Backend harness'ındaki dersler aynen taşınır:** araç ve süre bütçesi, sınırda araçsız son cevap, iptal, okuma araçlarında paralellik ve bir kez yeniden deneme, geçersiz parametrede onay istememe.

## Aşamalar

| Aşama | İçerik | Durum |
|---|---|---|
| 1a | Çekirdek: çalışma alanı, araçlar (`read_file`, `list_dir`, `glob`, `grep`, `write_file`, `edit_file`, `run_command`, `update_plan`), araç kaydı, oturum kaydı, onay politikası, agent döngüsü, sahte model ile testler | başladı |
| 1b | Arayüz temeli: gerçek klasör açma (IPC), dosya okuma/kaydetme, TypeScript derlemesinin temizlenmesi | başladı |
| 2 | Backend `/ide/complete` (kimlik doğrulamalı, kotalı model vekili) + gerçek model adaptörü + IDE'de giriş | bekliyor |
| 3 | Sohbet panelinin döngüye bağlanması: akış, araç kartları, diff inceleme ve onay ekranı, plan görünümü | bekliyor |
| 4 | Terminal paneli, oturumu sürdürme/dallandırma, bağlam sıkıştırma, iz görünümü | bekliyor |
| 5 | Alt agent'lar, skill'ler (`SKILL.md`), modlar (standart / salt-okuma / otomatik düzenleme), zamanlanmış görevler | bekliyor |
| 6 | Masaüstü paketi (electron-builder), otomatik güncelleme | bekliyor |

1b'deki yol sınırlama yardımcısı, 1a'nın `workspace.cjs` dosyasıyla Aşama 2'de birleştirilecek (iki görev aynı anda yazıldığı için şimdilik ayrı).

## Antigravity'de model dağıtımı

Görevler `.argon/<ad>/gorev.md` yuvalarına yazılır; Antigravity'de ilgili model seçilip `gorev <ad>` yazılarak başlatılır (kural: `.agents/rules/argon-kopru.md`). Aynı anda çalışan görevlerin dosya listeleri kesişmez.

| Havuz | Model | İş türü |
|---|---|---|
| Argon (haftalık sınırlı) | Gemini 4 Argon | Zor, tasarım ağırlıklı çekirdek işler |
| Gemini | Gemini 3.8 Flash | Arayüz, mekanik düzenleme, net tanımlı testler |
| Claude / GPT | Claude Sonnet 5.5, Opus 5.5 | İkinci göz inceleme (kod yazmadan rapor), orta zorlukta işler |

Görevi Claude Code yazar ve sonucu diff ile testle denetler; kod yazmaz.
