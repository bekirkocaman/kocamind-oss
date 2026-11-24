// Ortak web araması. Hem /search ucu hem de modellerin `web_search` aracı
// bunu kullanır: Tavily → Gemini Google grounding → Bing → DuckDuckGo → Wikipedia.
const SEARCH_CACHE_TTL = 2 * 60 * 1000;

function createWebSearch({ fetch, env = process.env }) {
  const searchCache = new Map();

  async function resolveSearchSourceUrl(uri) {
    if (!uri) return '';
    try {
      const parsed = new URL(uri);
      const isGroundingRedirect = parsed.hostname === 'vertexaisearch.cloud.google.com'
        || parsed.hostname.endsWith('.googleusercontent.com');
      if (!isGroundingRedirect) return uri;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(uri, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KocaMind/1.0)' },
      });
      clearTimeout(timeout);
      response.body?.destroy?.();
      const resolved = response.url || '';
      if (!resolved) return '';
      const resolvedHost = new URL(resolved).hostname;
      return resolvedHost === parsed.hostname ? '' : resolved;
    } catch {
      return '';
    }
  }

  return async function webSearch(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) throw new Error('query gerekli');

    const cacheKey = query.toLocaleLowerCase('tr-TR');
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      console.info(`[timing] search cache -> ${cached.data.source || 'none'}`);
      return cached.data;
    }
    if (cached) searchCache.delete(cacheKey);

    // Sağlayıcılar sırayla denenir; her birinin süresi ve sonucu tek satırda loglanır.
    const startedAt = Date.now();
    let stageStartedAt = startedAt;
    const steps = [];
    const lap = (name, outcome) => {
      steps.push(`${name} ${outcome} ${Date.now() - stageStartedAt}ms`);
      stageStartedAt = Date.now();
    };

    const remember = (data) => {
      lap(data.source || 'none', data.items?.length ? `${data.items.length} results` : 'empty');
      console.info(`[timing] search ${Date.now() - startedAt}ms -> ${steps.join(' | ')}`);
      searchCache.set(cacheKey, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL });
      // Cache'i sınırsız büyütme.
      if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
      return data;
    };

    let groundedSummary = '';

    // Yapılandırılmış arama sağlayıcısı. Anahtar varsa ilk tercih edilir;
    // gerçek hedef URL, başlık ve özet aynı yanıtta döner.
    if (env.TAVILY_API_KEY) {
      let outcome = 'empty';
      try {
        const tavilyController = new AbortController();
        const tavilyTimeout = setTimeout(() => tavilyController.abort(), 6500);
        const tavilyResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: tavilyController.signal,
          body: JSON.stringify({
            api_key: env.TAVILY_API_KEY,
            query: String(query),
            // basic: ölçümde ~1 sn daha hızlı ve arama başına 1 kredi (advanced 2).
            search_depth: env.TAVILY_SEARCH_DEPTH === 'advanced' ? 'advanced' : 'basic',
            max_results: 8,
            include_answer: true,
          }),
        });
        clearTimeout(tavilyTimeout);
        const tavily = await tavilyResponse.json();
        if (tavilyResponse.ok) {
          const items = (tavily.results || []).flatMap(result => {
            try {
              const link = new URL(result.url).href;
              return [{
                title: result.title || new URL(link).hostname,
                link,
                displayLink: new URL(link).hostname,
                snippet: result.content || '',
              }];
            } catch { return []; }
          });
          if (items.length > 0) {
            return remember({ items, aiSummary: tavily.answer || '', source: 'tavily' });
          }
        }
      } catch (error) {
        outcome = error.name === 'AbortError' ? 'timeout' : 'error';
        console.warn('Tavily araması başarısız:', error.message);
      }
      lap('tavily', outcome);
    }

    // Gemini API ile Google Search grounding
    if (env.GEMINI_API_KEY) {
      let outcome = 'empty';
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
        const searchController = new AbortController();
        const searchTimeout = setTimeout(() => searchController.abort(), 5000);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: searchController.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${query}` }] }],
            tools: [{ google_search: {} }],
          }),
        });
        clearTimeout(searchTimeout);
        const data = await response.json();

        if (response.ok) {
          const items = [];
          // Grounding metadata'dan arama sonuçlarını çıkar
          const groundingMeta = data.candidates?.[0]?.groundingMetadata;
          const chunks = groundingMeta?.groundingChunks || [];
          const supports = groundingMeta?.groundingSupports || [];

          // groundingChunks'tan sonuçları al
          for (const chunk of chunks) {
            if (chunk.web) {
              const existingItem = items.find(item => item.link === chunk.web.uri);
              if (!existingItem) {
                items.push({
                  title: chunk.web.title || '',
                  link: chunk.web.uri || '',
                  displayLink: chunk.web.uri ? new URL(chunk.web.uri).hostname : '',
                  snippet: '',
                });
              }
            }
          }

          // groundingSupports'tan snippet'leri al
          for (const support of supports) {
            if (support.segment?.text && support.groundingChunkIndices?.length > 0) {
              const idx = support.groundingChunkIndices[0];
              if (items[idx] && !items[idx].snippet) {
                items[idx].snippet = support.segment.text;
              } else if (items[idx]) {
                items[idx].snippet += ' ' + support.segment.text;
              }
            }
          }

          // AI'ın ürettiği cevabı da ekle (searchEntries'e fallback)
          const aiText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
          groundedSummary = aiText.trim();
        
          // Snippet'i olmayanlara AI cevabından parça ver
          for (const item of items) {
            if (!item.snippet && aiText) {
              item.snippet = aiText.substring(0, 200);
            }
          }

          if (items.length > 0) {
            const resolvedItems = await Promise.all(items.map(async item => {
              const directLink = await resolveSearchSourceUrl(item.link);
              return {
                ...item,
                link: directLink,
                displayLink: directLink ? new URL(directLink).hostname : '',
              };
            }));
            const usableItems = resolvedItems.filter(item => item.link);
            if (usableItems.length > 0) {
              return remember({ items: usableItems, aiSummary: groundedSummary, source: 'google' });
            }
          }
          // Google yönlendirme linkleri gerçek hedefe çözülemezse yanlış link verme;
          // özeti koruyup aşağıdaki Bing/DDG kaynak aramasına devam et.
        }
      } catch (e) {
        outcome = e.name === 'AbortError' ? 'timeout' : 'error';
        console.warn('Gemini Search grounding başarısız:', e.message);
      }
      lap('google', outcome);
    }

    // Fallback: Bing HTML scraping
    try {
      const cheerio = require('cheerio');
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=tr`;
      const bingResp = await fetch(bingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept-Language': 'tr-TR,tr;q=0.9',
          'Accept': 'text/html,application/xhtml+xml',
        }
      });
      const html = await bingResp.text();
      const $ = cheerio.load(html);

      const items = [];
      $('li.b_algo').each((i, el) => {
        if (items.length >= 8) return false;
        const titleEl = $(el).find('h2 a').first();
        const snippetEl = $(el).find('.b_caption p, .b_lineclamp2').first();
        const title = titleEl.text().trim();
        const link = titleEl.attr('href');
        const snippet = snippetEl.text().trim();
        if (title && link) {
          try {
            items.push({ title, link, displayLink: new URL(link).hostname, snippet });
          } catch {
            items.push({ title, link, displayLink: link, snippet });
          }
        }
      });

      if (items.length > 0) {
        return remember({ items, aiSummary: groundedSummary, source: 'bing' });
      }

      lap('bing', `empty (HTTP ${bingResp.status})`);

      // Bing boş dönerse DuckDuckGo'nun sonuç sayfasından gerçek site linklerini al.
      const ddgHtmlResponse = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KocaMind/1.0)' } }
      );
      const ddgHtml = await ddgHtmlResponse.text();
      const ddgPage = cheerio.load(ddgHtml);
      const ddgItems = [];
      ddgPage('.result').each((i, el) => {
        if (ddgItems.length >= 5) return false;
        const titleEl = ddgPage(el).find('.result__a').first();
        const snippetEl = ddgPage(el).find('.result__snippet').first();
        let link = titleEl.attr('href');
        if (!link) return;
        try {
          if (link.startsWith('//')) link = `https:${link}`;
          const parsed = new URL(link);
          const redirected = parsed.searchParams.get('uddg');
          link = redirected ? decodeURIComponent(redirected) : link;
          const sourceUrl = new URL(link);
          ddgItems.push({
            title: titleEl.text().trim(),
            link,
            displayLink: sourceUrl.hostname,
            snippet: snippetEl.text().trim(),
          });
        } catch { /* geçersiz sonuç */ }
      });
      // DDG bazen sonuç kapsayıcısının class adını değiştiriyor; linkleri
      // doğrudan HTML'den almak bu durumda da gerçek hedef URL'yi korur.
      if (ddgItems.length === 0) {
        const directLinks = [...ddgHtml.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)];
        for (const match of directLinks) {
          if (ddgItems.length >= 5) break;
          try {
            let redirect = match[1].replace(/&amp;/g, '&');
            if (redirect.startsWith('//')) redirect = `https:${redirect}`;
            const parsed = new URL(redirect);
            const link = parsed.searchParams.get('uddg') || redirect;
            const sourceUrl = new URL(decodeURIComponent(link));
            ddgItems.push({
              title: sourceUrl.hostname.replace(/^www\./, ''),
              link: sourceUrl.href,
              displayLink: sourceUrl.hostname,
              snippet: '',
            });
          } catch { /* geçersiz sonuç */ }
        }
      }
      if (ddgItems.length > 0) return remember({ items: ddgItems, aiSummary: groundedSummary, source: 'duckduckgo' });
      lap('duckduckgo-html', `empty (HTTP ${ddgHtmlResponse.status})`);

      // Son bir hafif alternatif dene.
      const ddgResponse = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&t=kocamind`,
        { headers: { 'User-Agent': 'KocaMind/1.0' } }
      );
      const ddg = await ddgResponse.json();
      const fallbackItems = [];
      if (ddg.AbstractText && ddg.AbstractURL) {
        fallbackItems.push({
          title: ddg.Heading || query,
          link: ddg.AbstractURL,
          displayLink: new URL(ddg.AbstractURL).hostname,
          snippet: ddg.AbstractText,
        });
      }
      for (const topic of ddg.RelatedTopics || []) {
        if (fallbackItems.length >= 5) break;
        if (topic.Text && topic.FirstURL) {
          fallbackItems.push({
            title: topic.Text.slice(0, 100),
            link: topic.FirstURL,
            displayLink: new URL(topic.FirstURL).hostname,
            snippet: topic.Text,
          });
        }
      }
      if (fallbackItems.length > 0) return remember({ items: fallbackItems, aiSummary: groundedSummary, source: 'duckduckgo' });
      lap('duckduckgo-api', 'empty');
      if (groundedSummary) return remember({ items: [], aiSummary: groundedSummary, source: 'google' });
      return remember({ items: [], source: 'bing' });
    } catch (scrapeErr) {
      lap('bing/duckduckgo', 'error');
      console.warn('Bing scrape başarısız:', scrapeErr.message);
    }

    // Arama motorları engellendiğinde gerçek Wikipedia makale bağlantılarını kullan.
    try {
      const wikiResponse = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&utf8=1`,
        { headers: { 'User-Agent': 'KocaMind/1.0 (https://kocamind.com)' } }
      );
      const wikiData = await wikiResponse.json();
      const wikiItems = (wikiData.query?.search || []).map(result => ({
        title: result.title,
        link: `https://en.wikipedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`,
        displayLink: 'en.wikipedia.org',
        snippet: String(result.snippet || '').replace(/<[^>]+>/g, ''),
      }));
      if (wikiItems.length > 0) return remember({ items: wikiItems, aiSummary: groundedSummary, source: 'wikipedia' });
      lap('wikipedia', 'empty');
    } catch (wikiError) {
      lap('wikipedia', 'error');
      console.warn('Wikipedia araması başarısız:', wikiError.message);
    }

    if (groundedSummary) return remember({ items: [], aiSummary: groundedSummary, source: 'google' });
    return remember({ items: [], error: 'Güvenilir arama sonucu bulunamadı' });
  };
}

module.exports = { createWebSearch };
