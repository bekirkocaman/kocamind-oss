// KocaMind'in bütün e-postaları: tek tasarım, Resend ile gönderim.
// E-posta istemcileri harici CSS ve yazı tipi desteklemediği için stiller satır içinde ve tablo düzeninde.
const FROM = 'KocaMind <noreply@kocamind.com>';
const RESEND_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const strong = value => `<strong style="color:#0f1115;font-weight:600;">${escapeHtml(value)}</strong>`;

const MARK = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:28px;height:28px;" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0" style="width:28px;">
<tr><td></td><td style="width:8px;height:8px;border-radius:50%;background:#2d4fd6;"></td><td></td></tr>
<tr><td style="width:8px;height:8px;border-radius:50%;background:#0f1115;"></td><td style="width:4px;"></td><td style="width:8px;height:8px;border-radius:50%;background:#0f1115;"></td></tr>
<tr><td></td><td style="width:8px;height:8px;border-radius:50%;background:#0f1115;"></td><td></td></tr>
</table></td>
<td style="padding-left:10px;font-size:18px;font-weight:600;color:#0f1115;letter-spacing:-0.3px;" valign="middle">KocaMind</td>
</tr></table>`;

/** Ortak kart: işaret, serif başlık, paragraflar, isteğe bağlı düğme ve alt not. Paragraflar HTML olarak gelir (kaçışlanmış). */
function layout({ title, paragraphs, button, note }) {
  const body = paragraphs.map(html => `<tr><td style="padding:14px 32px 0;font-size:15px;line-height:1.6;color:#4a4f5a;">${html}</td></tr>`).join('');
  const action = button
    ? `<tr><td style="padding:26px 32px 0;"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#0f1115;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 26px;border-radius:12px;">${escapeHtml(button.label)}</a></td></tr>`
    : '';
  const footNote = note ? `<tr><td style="padding:26px 32px 0;font-size:13px;line-height:1.6;color:#62687a;">${note}</td></tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;">
<tr><td style="padding:36px 32px 8px;">${MARK}</td></tr>
<tr><td style="padding:20px 32px 0;"><h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:1.2;color:#0f1115;">${escapeHtml(title)}</h1></td></tr>
${body}${action}${footNote}
<tr><td style="padding:0 0 32px;"></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td align="center" style="padding:18px 12px 0;font-size:12px;color:#8a909b;">KocaMind · Bu e-posta otomatik gönderildi, yanıtlamana gerek yok.</td></tr>
</table>
</td></tr>
</table>`;
}

const SUPPORT = 'Bir sorun olduğunu düşünüyorsan uygulamadaki Ayarlar &gt; İletişim bölümünden bize yaz.';

// Her tür: konu, başlık, paragraflar (HTML), düğme, not ve düz metin.
const KINDS = {
  reset: d => ({
    subject: 'KocaMind şifreni sıfırla',
    title: 'Şifreni sıfırla',
    paragraphs: [`${strong(d.email)} hesabı için şifre sıfırlama isteği aldık. Yeni şifreni belirlemek için aşağıdaki düğmeye dokun.`],
    button: { label: 'Yeni şifre belirle', href: d.link },
    note: 'Bu isteği sen yapmadıysan bu e-postayı görmezden gelebilirsin; şifren değişmez.',
    text: `Şifreni sıfırlamak için bu bağlantıyı aç:\n${d.link}\n\nBu isteği sen yapmadıysan bu e-postayı görmezden gelebilirsin.`,
  }),
  verify: d => ({
    subject: 'KocaMind e-postanı doğrula',
    title: 'E-postanı doğrula',
    paragraphs: [`KocaMind'e hoş geldin. Hesabını kullanmaya başlamadan önce ${strong(d.email)} adresinin sana ait olduğunu doğrula.`],
    button: { label: 'E-postamı doğrula', href: d.link },
    note: 'Bu hesabı sen açmadıysan bu e-postayı görmezden gelebilirsin.',
    text: `E-postanı doğrulamak için bu bağlantıyı aç:\n${d.link}\n\nBu hesabı sen açmadıysan bu e-postayı görmezden gelebilirsin.`,
  }),
  welcome: d => ({
    subject: "KocaMind'e hoş geldin",
    title: d.name ? `Aramıza hoş geldin, ${d.name}` : 'Aramıza hoş geldin',
    paragraphs: [
      'Seni burada görmek çok güzel. Hesabın hazır, artık her şey seni bekliyor.',
      'Merak ettiğin, takıldığın ya da sadece konuşmak istediğin her an buradayız.',
    ],
    note: 'Sevgiyle,<br>KocaMind ekibi',
    text: `Aramıza hoş geldin${d.name ? `, ${d.name}` : ''}. Seni burada görmek çok güzel; hesabın hazır.\n\nSevgiyle, KocaMind ekibi`,
  }),
  passwordChanged: d => ({
    subject: 'KocaMind şifren değiştirildi',
    title: 'Şifren değiştirildi',
    paragraphs: [`${strong(d.email)} hesabının şifresi az önce değiştirildi. Bundan sonra yeni şifrenle giriş yapabilirsin.`],
    note: `Bu değişikliği sen yapmadıysan hemen "Şifremi unuttum" ile şifreni yeniden belirle. ${SUPPORT}`,
    text: `${d.email} hesabının şifresi değiştirildi. Bunu sen yapmadıysan "Şifremi unuttum" ile şifreni yeniden belirle.`,
  }),
  accountDeletionScheduled: d => ({
    subject: 'KocaMind hesabın silinmeye planlandı',
    title: 'Hesabın silinmeye planlandı',
    paragraphs: [
      `${strong(d.email)} hesabın için silme talebini aldık. Hesabın şu an kilitli; sohbetlerin, hafızan ve dosyaların ${strong(d.purgeDate)} tarihinde kalıcı olarak silinecek.`,
      'Fikrini değiştirirsen bu tarihe kadar KocaMind\'e giriş yapıp hesabını tek dokunuşla geri alabilirsin.',
    ],
    note: `Bu talebi sen yapmadıysan hemen giriş yapıp hesabını geri al ve şifreni değiştir. ${SUPPORT}`,
    text: `${d.email} hesabın silinmeye planlandı. Verilerin ${d.purgeDate} tarihinde kalıcı olarak silinecek. Bu tarihe kadar giriş yapıp hesabını geri alabilirsin.`,
  }),
  accountDeleted: d => ({
    subject: 'KocaMind hesabın silindi',
    title: 'Hesabın silindi',
    paragraphs: [
      `${strong(d.email)} hesabın ve ona bağlı sohbetlerin, hafızan ve yüklediğin dosyalar kalıcı olarak silindi.`,
      'Yasal saklama yükümlülüğü nedeniyle yalnızca ödeme kayıtların yasal süre boyunca saklanır.',
    ],
    note: `Seni tekrar görmek isteriz. ${SUPPORT}`,
    text: `${d.email} hesabın ve verilerin kalıcı olarak silindi. Ödeme kayıtları yasal süre boyunca saklanır.`,
  }),
  billingActivated: d => ({
    subject: 'KocaMind Plus aboneliğin başladı',
    title: 'Plus aboneliğin başladı',
    paragraphs: ['Ödemen alındı ve Plus aboneliğin aktif. Daha yüksek günlük kullanım ve Derin Araştırma artık senin.'],
    button: d.appUrl ? { label: "KocaMind'i aç", href: d.appUrl } : null,
    note: 'Aboneliğini istediğin zaman Ayarlar &gt; Faturalama bölümünden iptal edebilirsin.',
    text: 'Plus aboneliğin aktif. Aboneliğini istediğin zaman Ayarlar > Faturalama bölümünden iptal edebilirsin.',
  }),
  billingPaid: d => ({
    subject: 'KocaMind ödemen alındı',
    title: 'Ödemen alındı',
    paragraphs: [
      'Plus aboneliğinin ödemesi başarıyla alındı, aboneliğin devam ediyor.',
      d.orderReference ? `Sipariş numarası: ${strong(d.orderReference)}` : null,
    ].filter(Boolean),
    note: 'Faturalarını Ayarlar &gt; Faturalama bölümünde görebilirsin.',
    text: `Plus aboneliğinin ödemesi alındı.${d.orderReference ? ` Sipariş numarası: ${d.orderReference}` : ''}`,
  }),
  billingFailed: d => ({
    subject: 'KocaMind ödemen alınamadı',
    title: 'Ödemen alınamadı',
    paragraphs: ['Plus aboneliğinin bu dönemki ödemesini kartından alamadık. Kartının limitini ve geçerlilik tarihini kontrol eder misin?'],
    button: d.appUrl ? { label: 'Ödeme bilgilerini kontrol et', href: d.appUrl } : null,
    note: 'Ödeme alınamazsa aboneliğin ücretsiz plana döner; sohbetlerin ve hafızan silinmez.',
    text: 'Plus aboneliğinin ödemesi alınamadı. Kartının limitini ve geçerlilik tarihini kontrol et.',
  }),
  billingCanceled: () => ({
    subject: 'KocaMind aboneliğin iptal edildi',
    title: 'Aboneliğin iptal edildi',
    paragraphs: ['Plus aboneliğin iptal edildi ve hesabın ücretsiz plana geçti. Sohbetlerin ve hafızan olduğu gibi duruyor.'],
    note: `Fikrini değiştirirsen Plus'a istediğin zaman yeniden geçebilirsin. ${SUPPORT}`,
    text: 'Plus aboneliğin iptal edildi, hesabın ücretsiz plana geçti. Sohbetlerin ve hafızan silinmedi.',
  }),
};

const EMAIL_KINDS = Object.keys(KINDS);

/** Türün içeriğini ortak tasarıma döker: { subject, html, text }. */
function buildEmail(kind, data = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Bilinmeyen e-posta türü: ${kind}`);
  const content = spec(data);
  return {
    subject: content.subject,
    html: layout(content),
    text: `${content.text}\n\nKocaMind`,
  };
}

/**
 * Gönderici. send() hiçbir zaman hata fırlatmaz: e-posta asıl işi (ödeme, silme) bozmamalı.
 * true: Resend kabul etti. false: anahtar yok, alıcı yok ya da gönderilemedi.
 */
function createMailer({ fetch, env = process.env }) {
  async function send(kind, to, data = {}) {
    const apiKey = env.RESEND_API_KEY;
    if (!apiKey || !to) return false;
    try {
      const mail = buildEmail(kind, data);
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!response.ok) console.error('Resend gönderimi başarısız:', kind, response.status);
      return Boolean(response.ok);
    } catch (error) {
      console.error('E-posta gönderilemedi:', kind, error.message);
      return false;
    }
  }
  return { send, configured: () => Boolean(env.RESEND_API_KEY) };
}

module.exports = { buildEmail, createMailer, escapeHtml, EMAIL_KINDS };
