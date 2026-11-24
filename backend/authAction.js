const { escapeHtml } = require('./mailer');

// E-postadaki bağlantının açtığı sayfa: Firebase'in düz sayfası yerine KocaMind tasarımı.
// İşlemler Identity Toolkit REST ile sunucuda yapılır; sayfada betik yoktur.
const TOOLKIT = 'https://identitytoolkit.googleapis.com/v1';
// Firebase web API anahtarı gizli değildir (istemci uygulamalarında da gömülüdür).
const DEFAULT_WEB_API_KEY = 'AIzaSyCKS1NSkE0GjU8_4-hAaUCk0ORZLiR7lY0';
const MIN_PASSWORD = 6;

/** Firebase'in ürettiği bağlantıdaki kod ve türü bizim sayfamıza taşır. */
function actionLink(firebaseLink, base) {
  const url = new URL(firebaseLink);
  const target = new URL('/auth/action', base);
  target.searchParams.set('mode', url.searchParams.get('mode') || '');
  target.searchParams.set('oobCode', url.searchParams.get('oobCode') || '');
  return target.toString();
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function page({ title, body }) {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · KocaMind</title>
<style>
:root { --bg:#f4f5f7; --card:#ffffff; --text:#0f1115; --text2:#4a4f5a; --muted:#62687a; --line:#e2e4e9; --brand:#2d4fd6; --btn:#0f1115; --btnText:#ffffff; --danger:#c93d3d; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1012; --card:#1a1c20; --text:#eceef1; --text2:#b3b8c1; --muted:#8a909b; --line:#2c2f35; --brand:#8ea4ff; --btn:#eceef1; --btnText:#0f1012; --danger:#f07a7a; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text); font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; padding:24px 16px; }
.card { width:100%; max-width:440px; background:var(--card); border-radius:20px; padding:32px; }
.mark { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:600; letter-spacing:-0.3px; }
.dots { position:relative; width:26px; height:26px; }
.dots i { position:absolute; width:8px; height:8px; border-radius:50%; background:var(--text); }
.dots i:nth-child(1){ left:9px; top:0; background:var(--brand); } .dots i:nth-child(2){ left:0; top:9px; } .dots i:nth-child(3){ left:18px; top:9px; } .dots i:nth-child(4){ left:9px; top:18px; }
h1 { font-family:Georgia,'Times New Roman',serif; font-weight:400; font-size:28px; line-height:1.2; margin:24px 0 10px; }
p { color:var(--text2); font-size:15px; line-height:1.6; margin:0 0 12px; }
.note { color:var(--muted); font-size:13px; }
.error { color:var(--danger); font-size:14px; margin:0 0 12px; }
label { display:block; font-size:13px; font-weight:600; color:var(--text2); margin:14px 0 6px; }
input[type=password] { width:100%; height:48px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--text); font-size:16px; padding:0 14px; }
input[type=password]:focus { outline:none; border-color:var(--brand); }
button { margin-top:20px; width:100%; height:50px; border:0; border-radius:12px; background:var(--btn); color:var(--btnText); font-size:15px; font-weight:600; cursor:pointer; }
strong { color:var(--text); font-weight:600; }
</style>
</head>
<body><main class="card"><div class="mark"><span class="dots"><i></i><i></i><i></i><i></i></span>KocaMind</div>${body}</main></body>
</html>`;
}

function send(res, status, title, body) {
  res.set({ 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  return res.status(status).type('html').send(page({ title, body }));
}

const INVALID = (res) => send(res, 400, 'Bağlantı geçersiz', `<h1>Bağlantı geçersiz</h1>
<p>Bu bağlantının süresi dolmuş ya da daha önce kullanılmış.</p>
<p class="note">Uygulamadan yeni bir bağlantı isteyebilirsin: şifre için "Şifremi unuttum", doğrulama için tekrar giriş yapmayı dene.</p>`);

function resetForm(res, { oobCode, email, error, status = 200 }) {
  return send(res, status, 'Yeni şifre belirle', `<h1>Yeni şifre belirle</h1>
<p>${email ? `<strong>${escapeHtml(email)}</strong> hesabı için yeni şifreni yaz.` : 'Yeni şifreni yaz.'}</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/auth/action/reset">
<input type="hidden" name="oobCode" value="${escapeHtml(oobCode)}">
<label for="newPassword">Yeni şifre</label>
<input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
<label for="confirm">Yeni şifre (tekrar)</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
<button type="submit">Şifremi kaydet</button>
</form>`);
}

function registerAuthActionRoutes(app, { fetch, mailer, env = process.env }) {
  const key = env.FIREBASE_WEB_API_KEY || DEFAULT_WEB_API_KEY;

  async function toolkit(method, body) {
    const response = await fetch(`${TOOLKIT}/accounts:${method}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data, error: data?.error?.message || '' };
  }

  app.get('/auth/action', async (req, res) => {
    const mode = String(req.query.mode || '');
    const oobCode = String(req.query.oobCode || '').slice(0, 500);
    if (!oobCode) return INVALID(res);
    try {
      if (mode === 'verifyEmail') {
        const result = await toolkit('update', { oobCode });
        if (!result.ok) return INVALID(res);
        return send(res, 200, 'E-postan doğrulandı', `<h1>E-postan doğrulandı</h1>
<p>${result.data.email ? `<strong>${escapeHtml(result.data.email)}</strong> adresi doğrulandı.` : 'Adresin doğrulandı.'} Artık uygulamaya dönüp giriş yapabilirsin.</p>
<p class="note">Bu sayfayı kapatabilirsin.</p>`);
      }
      if (mode === 'resetPassword') {
        const result = await toolkit('resetPassword', { oobCode });
        if (!result.ok) return INVALID(res);
        return resetForm(res, { oobCode, email: result.data.email });
      }
      return INVALID(res);
    } catch (error) {
      console.error('Hesap işlemi sayfası hatası:', error.message);
      return send(res, 502, 'Bir sorun oluştu', '<h1>Bir sorun oluştu</h1><p>İşlem şu an tamamlanamadı. Birkaç dakika sonra bağlantıyı yeniden aç.</p>');
    }
  });

  app.post('/auth/action/reset', async (req, res) => {
    const oobCode = String(req.body?.oobCode || '').slice(0, 500);
    const newPassword = String(req.body?.newPassword || '');
    const confirm = String(req.body?.confirm || '');
    if (!oobCode) return INVALID(res);
    if (newPassword.length < MIN_PASSWORD) return resetForm(res, { oobCode, status: 400, error: `Şifre en az ${MIN_PASSWORD} karakter olmalı.` });
    if (newPassword !== confirm) return resetForm(res, { oobCode, status: 400, error: 'İki şifre eşleşmiyor.' });
    try {
      const result = await toolkit('resetPassword', { oobCode, newPassword });
      if (!result.ok) {
        if (result.error.startsWith('WEAK_PASSWORD')) return resetForm(res, { oobCode, status: 400, error: 'Bu şifre çok zayıf, daha güçlü bir şifre seç.' });
        return INVALID(res);
      }
      const email = result.data.email;
      if (email) await mailer.send('passwordChanged', email, { email });
      return send(res, 200, 'Şifren değiştirildi', `<h1>Şifren değiştirildi</h1>
<p>Yeni şifrenle uygulamaya giriş yapabilirsin.</p>
<p class="note">Bu sayfayı kapatabilirsin.</p>`);
    } catch (error) {
      console.error('Şifre sıfırlama hatası:', error.message);
      return send(res, 502, 'Bir sorun oluştu', '<h1>Bir sorun oluştu</h1><p>Şifren kaydedilemedi. Birkaç dakika sonra tekrar dene.</p>');
    }
  });
}

module.exports = { actionLink, registerAuthActionRoutes };
