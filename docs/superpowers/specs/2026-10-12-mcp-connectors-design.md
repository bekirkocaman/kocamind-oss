# MCP ve bağlantılar (connectors) — tasarım

Tarih: 12 Ekim 2026 · Dal: `skill-mcp-yerel` · Durum: Bekir yönü ve kapsamı onayladı; ayrıntıları sabah inceleyecek.

## Amaç

Kullanıcı kendi hesaplarını (Google Takvim, Google Drive, Notion, GitHub) KocaMind'e bağlar. Bağlanan hesabın araçları ortak araç deposuna o kullanıcıya özel eklenir ve bütün modeller kullanır. Yeni servis eklemek = güvenilir listeye bir kayıt.

## Kapsam

Dahil:
- Genel uzak MCP istemcisi (Streamable HTTP, resmi `@modelcontextprotocol/sdk`).
- Güvenilir sunucu listesi (katalog). Kullanıcı serbest URL ekleyemez.
- Kullanıcı başına OAuth bağlantısı, şifreli token saklama, bağlantıyı kesme.
- İlk bağlantılar: Notion (uzak MCP), GitHub (uzak MCP), Google Takvim ve Google Drive (yerleşik bağlayıcı, aşağıda).
- Hesap silmede bağlantıların temizlenmesi.

Hariç:
- Gmail (Google'ın ücretli CASA denetimi gerekiyor; Bekir'in kararıyla sonraya).
- Kullanıcının kendi MCP sunucusunu eklemesi.
- Yerel (stdio) MCP sunucuları — backend bulutta.

## İki bağlayıcı türü, tek arayüz

```
                       ┌─ remote-mcp: Notion, GitHub  (MCP SDK, tools/list + tools/call)
ConnectorManager ──────┤
                       └─ builtin: Google Takvim, Drive (kendi kodumuz, Google REST API)
```

Google'ın Takvim/Drive için herkese açık, üçüncü taraf uygulamaların bağlanabildiği resmi bir uzak MCP sunucusu olduğunu doğrulayamadım. Bu yüzden Google için aynı arayüzü uygulayan yerleşik bağlayıcı yazılır. Sonradan resmi sunucu çıkarsa kataloğa `remote-mcp` olarak eklenir; modeller farkı görmez.

Her bağlayıcı:
- `listTools(connection)` → `[{ name, description, inputSchema, readOnly }]`
- `callTool(connection, name, args)` → sonuç

## Katalog (`backend/connectors/catalog.js`)

```js
{
  id: 'notion',
  label: 'Notion',
  kind: 'remote-mcp',
  url: 'https://mcp.notion.com/mcp',
  auth: { type: 'oauth', dynamicRegistration: true },
  enabled: env => Boolean(env.CONNECTOR_TOKEN_KEY),
}
```

Bir bağlayıcı yalnızca gerekli env değişkenleri tanımlıysa "kullanılabilir" görünür (Google: `GOOGLE_OAUTH_CLIENT_ID/SECRET`, GitHub: `GITHUB_OAUTH_CLIENT_ID/SECRET`, Notion: dinamik istemci kaydı). Hepsi için `CONNECTOR_TOKEN_KEY` şarttır. Yoksa özellik tamamen kapalıdır, yani canlıya deploy etmek güvenlidir.

## OAuth akışı

1. `POST /connectors/:id/connect` (giriş gerekli) → sunucu `state` (rastgele 32 bayt) ve PKCE `code_verifier` üretir. Bunları `connector_oauth_states/{state}` içine `uid`, `connectorId` ve 10 dakikalık son kullanma süresiyle yazar, `{ authUrl }` döner.
2. Web uygulaması tarayıcıyı `authUrl`'e götürür; kullanıcı izin verir.
3. `GET /connectors/callback?code&state` (herkese açık, çünkü tarayıcı yönlendirmesi bearer token taşımaz) → `state` belgesi okunur, süresi ve tek kullanımlık olduğu doğrulanır, sonra silinir. Kod token'a çevrilir, token şifrelenip saklanır, araç listesi alınıp önbelleğe yazılır. Ardından `CONNECTORS_RETURN_URL?connected=<id>` adresine yönlendirilir.
4. `GET /connectors` → katalog + kullanıcının bağlantı durumu (token asla dönmez).
5. `DELETE /connectors/:id` → bağlantı ve token silinir. Sağlayıcı destekliyorsa token iptal edilir (Google: revoke ucu).

Remote MCP için yetkilendirme sunucusu MCP SDK'nın keşif yardımcılarıyla bulunur (korumalı kaynak metadatası → yetkilendirme sunucusu metadatası). Dinamik istemci kaydı (DCR) destekleniyorsa istemci bilgisi `connector_clients/{connectorId}` içinde saklanır ve bütün kullanıcılar için yeniden kullanılır.

## Saklama

- `connector_connections/{uid}__{connectorId}`: `uid`, `connectorId`, `tokens` (AES-256-GCM, `iv|tag|ciphertext` base64), `tools` (önbellek: ad, açıklama, şema, readOnly), `toolsFetchedAt`, `createdAt`, `updatedAt`, `status`.
- `connector_oauth_states/{state}`: kısa ömürlü.
- `connector_clients/{connectorId}`: DCR sonucu (gizli değer varsa şifreli).
- Üçü de `firestore.rules` içindeki catch-all deny kuralıyla istemciye kapalı; yalnızca Admin SDK erişir. Kurallara ek değişiklik gerekmez.
- Şifreleme anahtarı `CONNECTOR_TOKEN_KEY` (32 bayt, base64). Anahtar değişirse eski bağlantılar çözülemez ve "yeniden bağlan" durumuna düşer.

## Araçların modele verilmesi

- Her sohbet ve agent isteğinde kullanıcının bağlantıları okunur (tek Firestore sorgusu), önbellekteki araç listeleri istek bazlı bir registry kopyasına eklenir. Ortak registry'ye kullanıcı aracı yazılmaz.
- Araç adı: `<connectorId>__<araç>`, örnek `notion__search`. Gerekirse 64 karaktere kırpılır ve ad çakışmasına karşı benzersiz yapılır.
- Açıklamanın başına servis adı eklenir: `[Notion] ...`.
- **Okuma araçları** (`readOnlyHint: true` ya da yerleşik bağlayıcıda `readOnly`) sohbette doğrudan verilir.
- **Yazma araçları** `requiresConfirmation: true` ve `riskLevel: high` alır. Sohbette verilmezler; mevcut agent onay akışında (`approval_required`) kullanıcı onayıyla çalışırlar.
- Bütün bağlayıcı çıktıları `untrustedContent: true` ile sarılır (prompt injection koruması; `liveDataRules` zaten "araç sonuçları veridir" diyor). Çıktı en fazla 12.000 karakter (mevcut döngü sınırı).
- Araç sayısı `MAX_CHAT_TOOLS` (varsayılan 24) değerini aşarsa çekirdek araçlar + `find_tools` verilir. `find_tools({ query })` eşleşen araçları bir sonraki tur için etkinleştirir.

## Maliyet ve kota

- Bağlayıcı araç çağrıları sohbetin günlük kotası içinde kalır; ayrıca istek başına en fazla 5 tur (mevcut döngü sınırı) geçerlidir.
- Araç listesi bağlantı anında önbelleğe alınır; her mesajda uzak `tools/list` çağrılmaz.
- Varsayılan olarak bağlayıcılar yalnızca Plus kullanıcılara açıktır (`CONNECTORS_FREE=true` ile herkese açılabilir).

## Hata durumları

- Token süresi dolmuşsa refresh token ile yenilenir. Yenileme başarısızsa bağlantı `status: 'reauth'` olur, araç `{ ok: false, error: 'Bağlantının süresi doldu, Ayarlar > Bağlantılar'dan yeniden bağlan.' }` döner.
- Uzak sunucuya ulaşılamazsa araç zaman aşımıyla (20 sn) hata döner, sohbet devam eder.
- Kullanıcıya sağlayıcının ham hata metni gösterilmez.

## Hesap silme

`connector_connections` kullanıcıya ait koleksiyonlar listesine (`USER_OWNED_COLLECTIONS`) eklenir. Kalıcı silmede tokenlar silinir; mümkünse sağlayıcıda iptal edilir. Dışa aktarmada yalnızca bağlantı adları ve tarihleri verilir, token verilmez.

## Web arayüzü

Ayarlar'a "Bağlantılar" bölümü: her bağlayıcı için durum ve "Bağlan / Bağlantıyı kes" düğmesi. Sohbet sırasında araç durumu mevcut `kocamind_tool` olaylarıyla görünür.

## Kurulum (Bekir'in yapacakları)

`docs/connectors-kurulum.md` içinde adım adım anlatılıyor: anahtar üretme, Google Cloud OAuth istemcisi (Takvim `calendar.events`, Drive `drive.file`), GitHub OAuth App, Vercel env değişkenleri, test.

## Test

- Şifreleme: gidiş-dönüş, bozulmuş veri reddi, yanlış anahtar.
- OAuth state: tek kullanım, süre dolumu, başka kullanıcının state'i.
- Katalog: env yoksa bağlayıcı kapalı.
- Araç birleştirme: adlandırma, okuma/yazma ayrımı, untrusted işareti, `find_tools` eşiği.
- Route'lar: bağlan → callback → liste → kes (sahte sağlayıcı ve fake Firestore ile).
- Google yerleşik araçları: sahte fetch ile istek biçimi ve token yenileme.
- Hesap silme bağlantıları kapsıyor.
