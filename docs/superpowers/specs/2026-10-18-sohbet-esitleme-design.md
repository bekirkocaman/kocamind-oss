# Sohbet eşitleme: çakışma çözümü, tekrar deneme, gerçek zamanlı güncelleme

Tarih: 18 Ekim 2026. TODO Faz 1, ilk madde.

## Sorun

Web ve Android sohbetleri `users/{uid}/chats/{chatId}` altında tutuyor (şema: `kocamind-web/src/lib/chatSchema.js`, `CloudChatMapping.kt`). Bugünkü akışta üç veri kaybı yolu var:

1. **Kör üzerine yazma.** Her iki istemci de değişen sohbeti `set()` ile bütünüyle yazıyor. İki cihaz aynı sohbete mesaj eklerse sonra yazanınki kalır, diğerinin mesajları kaybolur.
2. **Silinen sohbet geri geliyor.** Eşitleme yalnızca "yeni olan kazanır" diyor. Bir cihazda silinen sohbet öbür cihazda duruyorsa, o cihaz onu "bulutta yok, yükleyeyim" diye geri yazıyor.
3. **Web'de başarısız yazma bekliyor.** Yazma başarısız olursa yalnızca sohbet tekrar değişince deneniyor. Başarısız silme hiç denenmiyor.

## Karar: son eşitlenen hâle göre üç yönlü birleştirme

Her istemci, her sohbet için en son bulutla anlaştığı hâli saklar. Buna **taban** diyoruz: `{ updatedAt, ids }`, yani zaman ve mesaj kimlikleri. Mesaj kimlikleri ortak şema sayesinde iki tarafta da sabit.

### Mesajlar (`mergeMessages`)

- Taban yoksa (ilk eşitleme) eski davranış sürer: `updatedAt`'i yeni olan taraf kazanır.
- Taban varsa, tabanda olup bir tarafta artık bulunmayan mesaj o tarafta **silinmiştir** (düzenleme ya da yeniden deneme mesajları keser). Silinen mesaj sonuçta yer almaz.
- Kalanların birleşimi alınır. Sıra, yeni olan tarafın sırasıdır. Öbür taraftaki yeni mesajlar zaman damgasına göre araya yerleşir (kendinden önceki ya da eşit zamanlı son mesajın arkasına).
- Aynı kimlikli mesajın içeriği iki tarafta farklıysa yeni olan taraf kazanır.
- Başlık, sabitleme ve arşiv yeni olan taraftan alınır. `updatedAt` iki tarafın büyüğüdür.

### Sohbet listesi (`planSync`)

| Durum | Taban | Sonuç |
|---|---|---|
| İkisinde de var | önemsiz | `mergeChat` |
| Yalnız yerelde | yok | Yeni yerel sohbet → yükle |
| Yalnız yerelde | var, yerel tabandan sonra değişmemiş | Başka cihazda silinmiş → yerelden sil |
| Yalnız yerelde | var, yerel sonradan değişmiş | Düzenleme silmeden önemli → koru, yükle |
| Yalnız bulutta | yok | Yeni uzak sohbet → yerele ekle |
| Yalnız bulutta | var, bulut tabandan sonra değişmemiş | Bu cihazda silinmiş → buluttan sil (başarısız silmenin tekrarı da budur) |
| Yalnız bulutta | var, bulut sonradan değişmiş | Koru, yerele ekle |
| Bekleyen yerel silme (Android) | önemsiz | Buluttan sil |

Kural: veri kaybıyla tutarsızlık arasında kalınırsa veri korunur.

### Yazma: işlem (transaction) içinde birleştirerek

Tek sohbet yazılırken (`pushChat`) buluttaki belge bir Firestore transaction'ı içinde okunur, tabanla birleştirilir ve sonuç yazılır. Böylece iki cihaz aynı anda yazsa bile biri öbürünün yazdığını ezemez. Taban yalnızca transaction başarıyla bitince güncellenir. Transaction çevrimdışıyken başarısız olur. O zaman sohbet bekleyen yazmalara eklenir ve sonra yeniden denenir:

- Android: bekleyen işlemler zaten saklanıyor (`PendingOps`); bağlantı gelince `sync` dener.
- Web: bekleyen yazma ve silmeler `localStorage`'da tutulur; `online` olayında ve artan aralıklarla (5 sn'den 5 dk'ya) yeniden denenir.

### Gerçek zamanlı güncelleme

Giriş yapılıyken iki istemci de `users/{uid}/chats` koleksiyonunu dinler (`onSnapshot` / `addSnapshotListener`). Gelen değişiklik yerel sohbetle aynı kurallarla birleştirilir; yerelde gönderilmemiş değişiklik varsa birleşik sonuç yeniden yazılır.

### Açık sohbet

Ekrandaki açık sohbet bellekte ayrı bir kopya tutar. Uzaktan gelen mesaj yerel depoya yazıldıktan sonra ekran eski listeyi kaydederse, gelen mesaj "silinmiş" görünürdü. Bunu önlemek için ekran, gördüğü mesaj kimliklerini (`seenIds`) tutar. Kayıt sırasında depoda olup ekranın hiç görmediği mesajlar korunur ve ekrana eklenir. Ekranın görüp kaldırdığı mesajlar silinmiş sayılır. Cevap akmıyorsa uzaktan gelen değişiklik ekrana hemen yansır.

### Web'e özgü alanlar

Web mesajlarındaki `imageUrl` ve `agentSteps` alanlarını Android bilmiyor. Android bir web sohbetini güncellerken bu alanları buluttaki belgeden aynen taşır (`toCloudChat(..., preserve)`), böylece silinmezler.

## Kapsam dışı

- Aynı mesajın iki cihazda aynı anda düzenlenmesi: yeni olan kazanır.
- Firestore'un çevrimdışı önbelleği: dinleyici yalnızca sunucudan gelen hâli işler.
