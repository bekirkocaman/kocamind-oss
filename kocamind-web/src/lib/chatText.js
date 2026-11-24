

export const DEEP_RESEARCH_PROMPT = `Sen KocaMind Derin Araştırma asistanısın. Kullanıcıya yalnızca yüzeysel bir cevap verme.
Kullanılabilir web arama aracını kullan; birden fazla güvenilir kaynağı karşılaştır, çelişkileri belirt ve kanıtlanabilen bilgileri sentezle.
Cevabı şu yapıda hazırla: kısa sonuç, temel bulgular, ayrıntılı analiz, belirsizlikler ve sonuç.
Her önemli iddiayı kaynaklara dayandır. Kaynakta bulunmayan güncel bilgileri uydurma.
Türkçe, açık ve düzenli Markdown kullan.`

export function enhanceArtifactMarkdown(content) {
  if (!content || !/```(?:html?|css|js|javascript)\b/i.test(content)) return content

  const blocks = []
  const fencePattern = /```([^\n]*)\n([\s\S]*?)```/g
  let match
  while ((match = fencePattern.exec(content))) {
    blocks.push({ language: match[1].trim().toLowerCase(), code: match[2] })
  }

  const htmlBlock = blocks.find(block => ['html', 'htm'].includes(block.language))
  if (!htmlBlock) return content

  const css = blocks.filter(block => block.language === 'css').map(block => block.code).join('\n')
  const javascript = blocks.filter(block => ['js', 'javascript'].includes(block.language)).map(block => block.code).join('\n')
  let document = htmlBlock.code

  if (css) {
    const style = `<style>\n${css}\n</style>\n`
    document = /<\/head>/i.test(document) ? document.replace(/<\/head>/i, `${style}</head>`) : `${style}${document}`
  }
  if (javascript) {
    const script = `<script>\n${javascript}\n</script>\n`
    document = /<\/body>/i.test(document) ? document.replace(/<\/body>/i, `${script}</body>`) : `${document}\n${script}`
  }

  return content.replace(fencePattern, (full, language, code) => {
    const normalized = language.trim().toLowerCase()
    return ['html', 'htm'].includes(normalized) && code === htmlBlock.code
      ? `\`\`\`${language}\n${document}\`\`\``
      : full
  })
}

export function visibleAssistantDraft(text) {
  const value = String(text || '')
  const fencedTool = value.search(/```(?:json)?\s*[\r\n]*\s*\{[\s\S]{0,300}?"tool_call"\s*:/i)
  const bareTool = value.search(/\{\s*"tool_call"\s*:/i)
  const starts = [fencedTool, bareTool].filter(index => index >= 0)
  if (starts.length === 0) return value
  // Araç çağrısından önce yazılan "hemen bakıyorum" cümlesini de gösterme.
  return ''
}

export function appendSearchSources(text, steps) {
  const links = []
  for (const step of steps || []) {
    if (step.name !== 'web_search') continue
    const found = String(step.result || '').match(/https?:\/\/[^\s)]+/g) || []
    for (const link of found) {
      const clean = link.replace(/[.,;]+$/, '')
      if (!links.some(item => item.url === clean)) {
        let name = clean
        try {
          name = new URL(clean).hostname.replace(/^www\./, '')
        } catch { /* geçersiz linki yine de göster */ }
        links.push({ url: clean, name })
      }
    }
  }
  const withoutToolResult = String(text || '')
    .replace(/\s*\[web_search\s+Sonucu\]:[\s\S]*$/i, '')
    .replace(/\n+\s*(?:\*{1,3}|_{1,3}|#{1,6}|-{1,3})\s*$/, '')
    .trim()
  if (links.length === 0) return withoutToolResult
  // Model kaynak başlığını kendisi yazmış olsa bile tam iki link göster.
  const withoutSources = withoutToolResult.replace(/\n+📌\s*\**Kaynaklar:\**[\s\S]*$/i, '').trim()
  const sourceList = links.slice(0, 2).map(({ name, url }) => `- [${name}](${url})`).join('\n')
  return `${withoutSources}\n\n📌 **Kaynaklar:**\n${sourceList}`
}

export function cleanToolResultText(text) {
  return String(text || '').replace(/\s*\[web_search\s+Sonucu\]:[\s\S]*$/i, '').trim()
}

export function needsToolLoop(text) {
  return /\b(güncel|guncel|bugün|bugun|şimdi|simdi|kaynak|araştır|arastir|ara|bul|doğrula|dogrula|nüfus|nufus|hava|haber|fiyat|kur|borsa|döviz|doviz|ekonomi|ekonomisi|gsyh|skor|sonuç|sonuc|kaç|ne kadar|kaç yaşında|kaç para)\b/i.test(text)
}

export function detectMediaTool(text) {
  const normalized = String(text || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
  const createVerb = /\b(olustur|uret|yap|hazirla|tasarla|ciz|generate|create)\b/
  if (!createVerb.test(normalized)) return null
  if (/\b(video|klip|reels|animasyon|film|sahne)\b/.test(normalized)) return 'video'
  if (/\b(fotograf|gorsel|resim|logo|afis|poster|kapak|illustrasyon|cizim|duvar kagidi)\b/.test(normalized)) return 'image'
  return null
}

export function inferMediaAspectRatio(text, mediaType) {
  const normalized = String(text || '').toLocaleLowerCase('tr-TR')
  if (/9\s*:\s*16|dikey|story|reels|tiktok|telefon/.test(normalized)) return '9:16'
  if (/16\s*:\s*9|yatay|sinema|youtube|genis ekran/.test(normalized)) return '16:9'
  return mediaType === 'video' ? '16:9' : '1:1'
}

export function needsGmailTool(text) {
  const normalized = String(text || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')

  // Telefonda yazılan "gmaile" ve "maillermie" gibi küçük hataları da tanı.
  const mentionsMail = normalized.includes('mail') || normalized.includes('eposta')
  const asksToRead = /\b(oku|okur|bak|goster|listele|kontrol|incele|gelen|son|ozetle|tara)\b/.test(normalized)
  return mentionsMail && asksToRead
}

export function needsAutomaticTool(text) {
  if (needsToolLoop(text) || needsGmailTool(text) || detectMediaTool(text)) return true
  const normalized = String(text || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
  return /https?:\/\/|\b(hesapla|calistir|test et|donustur|cevir|mail gonder|eposta gonder|siteyi oku|sayfayi oku|incele|hafizaya kaydet|unutma|hatirla|telegram|github|repo|issue)\b/.test(normalized)
}

export function activityLabel(status) {
  const value = String(status || '').toLocaleLowerCase('tr-TR')
  if (/web_search|web.?de ara|internet|araştır/.test(value)) return 'Web’de araştırıyorum'
  if (/scrape|website|web sitesi|sayfa/.test(value)) return 'Web sitesini inceliyorum'
  if (/gmail|e-?posta|mail/.test(value)) return 'Gmail’e bağlanıyorum'
  if (/video/.test(value)) return 'Video oluşturma servisine bağlanıyorum'
  if (/image|görsel|fotoğraf|resim/.test(value)) return 'Görselini oluşturuyorum'
  if (/hafıza|memory/.test(value)) return 'Bilgiyi hafızaya kaydediyorum'
  if (/cevap|yanıt|yaz/.test(value)) return 'Yanıtını oluşturuyorum'
  return status ? String(status).replace(/^[^\p{L}\p{N}]+/u, '').replace(/[.…]+$/u, '') : 'Yanıtını hazırlıyorum'
}
