// Eski istemci tarafı agent'ın araç uçları kaldırıldı; araçlar artık yalnızca
// onay/risk sistemiyle çalışan /agent üzerinden çağrılır. Burada kalan tek uç,
// kullanıcının kendi kısa ömürlü OAuth jetonuyla Gmail gelen kutusunu okur.
function registerToolsRoutes(app, { fetch }) {
  app.post('/tools/email/read', async (req, res) => {
    try {
      const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 5, 1), 15);
      const gmailAccessToken = String(req.body?.gmailAccessToken || '');

      // Kişisel Gmail yalnızca kullanıcının kısa ömürlü OAuth jetonuyla okunur.
      // Sunucu hesabı/IMAP yedeği özellikle kullanılmaz; kullanıcılar arası veri
      // karışmasını ve AI araç yollarından dolaylı erişimi engeller.
      if (gmailAccessToken) {
        const headers = { Authorization: `Bearer ${gmailAccessToken}` };
        const listResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${count}&q=${encodeURIComponent('in:inbox')}`,
          { headers }
        );
        const listData = await listResponse.json().catch(() => ({}));
        if (listResponse.status === 401 || listResponse.status === 403) {
          return res.status(401).json({ error: 'Gmail izninin süresi doldu. Ayarlar > Bağlantılar bölümünden yeniden bağlan.' });
        }
        if (!listResponse.ok) return res.status(listResponse.status).json({ error: 'Gmail gelen kutusu okunamadı.' });

        const mails = await Promise.all((listData.messages || []).slice(0, count).map(async ({ id }) => {
          const params = new URLSearchParams({ format: 'metadata' });
          params.append('metadataHeaders', 'From');
          params.append('metadataHeaders', 'Subject');
          params.append('metadataHeaders', 'Date');
          const messageResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${params}`,
            { headers }
          );
          const message = await messageResponse.json().catch(() => ({}));
          const metadata = Object.fromEntries(
            (message.payload?.headers || []).map(header => [String(header.name).toLowerCase(), header.value])
          );
          return {
            id,
            from: metadata.from || 'bilinmiyor',
            subject: metadata.subject || '(konu yok)',
            date: metadata.date || null,
            snippet: String(message.snippet || '').slice(0, 240),
          };
        }));
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ success: true, count: mails.length, mails });
      }
      return res.status(400).json({ error: 'Gmail hesabını Ayarlar > Bağlantılar bölümünden bağlamalısın.' });
    } catch (e) {
      res.status(500).json({ error: 'Mailler okunamadı: ' + e.message });
    }
  });
}

module.exports = { registerToolsRoutes };
