const crypto = require('crypto');

function registerAuthRoutes(app, { fetch, firebaseAuth, registerPublicBillingRoutes, firestoreDb, FieldValue, notify }) {
  const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
    || '956051927831-jmel0ke1knjvenfemc1bmd0o1dg15k9l.apps.googleusercontent.com';

  app.post('/auth/google', async (req, res) => {
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!accessToken) return res.status(400).json({ error: 'Google erişim belirteci eksik.' });

    try {
      const tokenInfoResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
      );
      const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));
      const audience = tokenInfo.aud || tokenInfo.audience;
      if (!tokenInfoResponse.ok || audience !== GOOGLE_OAUTH_CLIENT_ID || !tokenInfo.sub) {
        return res.status(401).json({ error: 'Google oturumu doğrulanamadı.' });
      }

      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || profile.sub !== tokenInfo.sub || !profile.email || profile.email_verified !== true) {
        return res.status(401).json({ error: 'Doğrulanmış Google hesabı bulunamadı.' });
      }

      let userRecord;
      try {
        userRecord = await firebaseAuth.getUserByEmail(profile.email);
        // Hesap ele geçirme önlemi: saldırgan kurbanın adresiyle şifreli bir hesap
        // açıp doğrulamadan bırakabilir. Gerçek sahip Google ile girince o hesaba
        // bağlanırdı ve saldırgan şifresiyle girmeye devam ederdi. Adres doğrulanmamışsa
        // Firebase'in kendi davranışı gibi eski şifre geçersiz kılınır, açık oturumlar kapatılır.
        if (!userRecord.emailVerified) {
          userRecord = await firebaseAuth.updateUser(userRecord.uid, {
            emailVerified: true,
            password: crypto.randomBytes(32).toString('base64url'),
          });
          await firebaseAuth.revokeRefreshTokens(userRecord.uid);
        }
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        userRecord = await firebaseAuth.createUser({
          uid: `google:${profile.sub}`,
          email: profile.email,
          emailVerified: true,
          displayName: profile.name || profile.email.split('@')[0],
          photoURL: profile.picture || undefined,
        });
      }

      const customToken = await firebaseAuth.createCustomToken(userRecord.uid, {
        googleSub: profile.sub,
      });
      return res.json({ customToken });
    } catch (error) {
      console.error('Google mobil giriş yedeği başarısız:', error.message);
      return res.status(500).json({ error: 'Google girişi tamamlanamadı.' });
    }
  });

  registerPublicBillingRoutes(app, { firestoreDb, FieldValue, env: process.env, notify });
}

module.exports = { registerAuthRoutes };
