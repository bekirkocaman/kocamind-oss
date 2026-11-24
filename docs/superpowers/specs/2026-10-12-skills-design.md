# Skill sistemi — tasarım

Tarih: 12 Ekim 2026 · Dal: `skill-mcp-yerel` · Durum: Bekir yönü onayladı ("önerdiğin yönle devam et"), ayrıntıları sabah inceleyecek.

## Amaç

Her konu için araç yazmadan modellere uzmanlık kazandırmak. Skill kod değil, gerektiğinde yüklenen talimat paketidir. Bütün modeller (DeepSeek, Gemini, Groq, xAI, Anthropic uyumlu uç, OpenAI agent) aynı skill deposunu kullanır. Yeni skill eklemek = `backend/skills/` altına bir klasör; route koduna dokunulmaz.

## Neyi kapsamaz

- Kullanıcının kendi skill'ini yazması (kullanıcı içeriği = güvenlik riski; sonraya).
- Skill içinden script çalıştırma (kod sandbox'ı ayrı iş, TODO "AI Ortak Depo" madde 2).
- Admin paneli: skill'ler repoda, Git ile sürümlenir, backend ile deploy edilir.

## Yapı

```
backend/skills/
  genel-asistan/SKILL.md
  kod-asistani/SKILL.md
  hukuk-asistani/SKILL.md
  hukuk-asistani/dilekce-yapisi.md     ← ek dosya (isteğe bağlı)
  ...
```

`SKILL.md` biçimi:

```markdown
---
name: hukuk-asistani
description: Türk hukuku sorularında dikkatli, kaynak gösteren avukat asistanı davranışı.
assistants: [lawyer]
autoload: true
---
Talimatlar (Markdown)...
```

Alanlar:
- `name` (zorunlu): klasör adıyla aynı, `[a-z0-9-]`, en fazla 64 karakter.
- `description` (zorunlu): tek satır, en fazla 200 karakter. Katalogda görünen tek şey bu.
- `assistants` (isteğe bağlı): skill'in hangi asistan tiplerinde katalogda görüneceği. Boşsa `*` (hepsi).
- `autoload` (isteğe bağlı, varsayılan `false`): o asistan seçilince tam metin baştan sistem prompt'una girer. Eski `ASSISTANT_PROMPTS` bunun yerini alır.

Bozuk skill (eksik alan, ad uyuşmazlığı) başlangıçta atlanır ve uyarı loglanır; sunucu çökmez. Testler bütün repo skill'lerinin geçerli olduğunu doğrular, yani bozuk skill CI'da yakalanır.

## Üç katman (ilerlemeli yükleme)

1. **Katalog:** Sistem prompt'una her uygun skill için 1 satır girer: `- cv-yazma: CV ve ön yazı hazırlar.` 30 skill ≈ birkaç yüz token.
2. **Yükleme:** Ortak `ToolRegistry`'ye `load_skill({ name, file? })` aracı eklenir. Model gerekince çağırır, tam talimatı alır. Ortak depoda olduğu için araç destekleyen her model otomatik kullanır.
3. **Ek dosya:** `load_skill({ name, file: "dilekce-yapisi.md" })` skill klasöründeki ek Markdown dosyasını döndürür.

Katalog `SKILL_CATALOG_LIMIT` (varsayılan 30) satırı geçerse satırlar yerine `find_skills({ query })` aracı verilir; katalog yerine "find_skills ile ara" talimatı girer. Arama: ad + açıklama üzerinde basit, aksan duyarsız kelime eşleşmesi ve puanlama.

## Asistan tipleri

`server.js`'deki `ASSISTANT_PROMPTS` (tiger, coder, lawyer, health, deep_research) `autoload: true` skill'lere taşınır. Sistem prompt'u şöyle kurulur:

1. Kullanıcının özel prompt'u (`custom_prompt`) varsa o; yoksa asistanın autoload skill'leri; hiçbiri yoksa eski `ASSISTANT_PROMPTS` metni (geri dönüş).
2. Skill kataloğu (araç destekleniyorsa ve katalog boş değilse).
3. `liveDataRules` (değişmedi).

Araç desteklemeyen modelde (`supportsTools === false`) yalnızca autoload metni girer; katalog girmez (yükleyemeyeceği şeyi göstermemek için).

## Güvenlik

- Skill'ler yalnızca repodan gelir; güvenilir içeriktir, `untrustedContent` işaretlenmez.
- `file` parametresi: yalnızca `[a-z0-9._-]+\.md`, `..` ve yol ayırıcı yasak; çözümlenen yol skill klasörünün içinde kalmalı. Skill adı da kayıtlı adlarla eşleşmeli (dosya sistemine serbest erişim yok).
- Yüklenen metin `MAX_SKILL_CHARS` (20.000) ile sınırlı.
- Skill'ler başlangıçta bir kez okunur ve bellekte tutulur (serverless soğuk başlangıçta ~ms).

## Bileşenler

- `backend/skills/skillStore.js` — klasörü okur, frontmatter'ı ayrıştırır (bağımlılıksız, basit YAML alt kümesi), doğrular; `list({ assistant })`, `get(name)`, `readFile(name, file)`, `search(query)`, `autoloadFor(assistant)`, `catalogFor(assistant)`.
- `agent/tools.js` — `load_skill` ve `find_skills` araçları `createDefaultToolRegistry({ skillStore })` ile kaydedilir.
- `backend/skills/prompt.js` — `buildSystemPrompt({ assistantType, customPrompt, skillStore, toolsEnabled, legacyPrompts })`.
- `routes/chat.js` — sistem prompt'u bu yardımcıyla kurulur.

## Test

- Frontmatter ayrıştırma, doğrulama, bozuk skill'in atlanması.
- Yol traversal denemeleri (`../`, mutlak yol, `.md` dışı) reddedilir.
- Katalog asistan tipine göre süzülür; limit aşınca `find_skills` moduna geçer.
- `load_skill` ve `find_skills` araçları registry üzerinden çalışır.
- Chat route: autoload metni prompt'ta, katalog satırı prompt'ta, araç kapalı modelde katalog yok.
- Repo'daki bütün skill'ler geçerli.
