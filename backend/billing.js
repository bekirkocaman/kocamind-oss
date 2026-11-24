'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');

const PLAN_ID = 'pro';

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function configuredValue(value) {
  const normalized = clean(value, 500);
  return Boolean(normalized && normalized !== '[SENSITIVE]' && !/^<.+>$/.test(normalized));
}

function publicUrl(value, fallback) {
  try {
    if (!configuredValue(value)) return fallback;
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return fallback;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

// T.C. kimlik numarası resmi kontrol hanesi algoritması.
function isValidTckn(value) {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = ((odd * 7 - even) % 10 + 10) % 10;
  if (tenth !== d[9]) return false;
  return d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10 === d[10];
}

function validateCustomer(input = {}, fallbackEmail = '') {
  const customer = {
    name: clean(input.name, 60), surname: clean(input.surname, 60),
    identityNumber: clean(input.identityNumber, 20).replace(/\s/g, ''),
    email: clean(fallbackEmail || input.email, 160).toLowerCase(),
    gsmNumber: clean(input.gsmNumber, 24).replace(/[\s()-]/g, ''),
    city: clean(input.city, 60), district: clean(input.district, 80),
    address: clean(input.address, 300), zipCode: clean(input.zipCode, 12),
  };
  if (!customer.name || !customer.surname) throw new Error('Ad ve soyad gerekli.');
  if (!isValidTckn(customer.identityNumber)) throw new Error('Geçerli bir T.C. kimlik numarası gir.');
  if (!/^\+?\d{10,15}$/.test(customer.gsmNumber)) throw new Error('Geçerli bir telefon numarası gir.');
  if (!customer.email.includes('@')) throw new Error('Geçerli bir e-posta adresi gerekli.');
  if (!customer.city || !customer.district || customer.address.length < 10) throw new Error('Fatura adresini eksiksiz gir.');
  return customer;
}

function getBillingConfig(env) {
  const live = env.IYZICO_MODE === 'live';
  const apiKeyReady = configuredValue(env.IYZICO_API_KEY);
  const secretKeyReady = configuredValue(env.IYZICO_SECRET_KEY);
  const planReady = configuredValue(env.IYZICO_PRICING_PLAN_REFERENCE_CODE);
  const defaultApiUrl = live ? 'https://api.iyzipay.com' : 'https://sandbox-api.iyzipay.com';
  return {
    credentialsConfigured: apiKeyReady && secretKeyReady,
    configured: apiKeyReady && secretKeyReady && planReady,
    live, apiKey: env.IYZICO_API_KEY, secretKey: env.IYZICO_SECRET_KEY,
    merchantId: configuredValue(env.IYZICO_MERCHANT_ID) ? clean(env.IYZICO_MERCHANT_ID, 40) : '',
    pricingPlanReferenceCode: env.IYZICO_PRICING_PLAN_REFERENCE_CODE,
    setupToken: env.BILLING_SETUP_TOKEN,
    uri: publicUrl(env.IYZICO_BASE_URL, defaultApiUrl),
    backendUrl: publicUrl(env.PUBLIC_BACKEND_URL, 'https://api.kocamind.com'),
    frontendUrl: publicUrl(env.PUBLIC_FRONTEND_URL, 'https://kocamind.com'),
  };
}

async function iyzicoRequest(config, method, path, body = {}) {
  if (!config.credentialsConfigured) throw new Error('Ödeme sistemi henüz yapılandırılmadı.');
  const signaturePath = path.split('?')[0];
  // iyzico'nun resmî Node istemcisi sayısal zaman + rastgele sayı kullanır.
  const randomKey = `${Date.now()}${Math.random().toString().slice(2)}`;
  const requestBody = method === 'GET' ? '' : JSON.stringify(body);
  const signature = crypto.createHmac('sha256', config.secretKey)
    .update(randomKey + signaturePath + requestBody).digest('hex');
  const authorization = Buffer.from(`apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`).toString('base64');
  const response = await fetch(`${config.uri}${path}`, {
    method,
    headers: {
      Authorization: `IYZWSv2 ${authorization}`,
      'Content-Type': 'application/json',
      'x-iyzi-rnd': randomKey,
      'x-iyzi-client-version': 'kocamind-1.0',
    },
    ...(method === 'GET' ? {} : { body: requestBody }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== 'success') throw new Error(result.errorMessage || `iyzico hatası (${response.status})`);
  return result;
}

async function ensureSandboxPlan(config) {
  const productName = 'KocaMind Plus';
  const planName = 'KocaMind Plus Aylık 350 TL';
  const product = (await iyzicoRequest(config, 'POST', '/v2/subscription/products', {
    locale: 'tr', conversationId: crypto.randomUUID(), name: productName,
    description: 'KocaMind yapay zeka asistanı Plus aboneliği',
  })).data;
  if (!product?.referenceCode) throw new Error('Ürün referansı alınamadı.');
  const plansPath = `/v2/subscription/products/${encodeURIComponent(product.referenceCode)}/pricing-plans`;
  const plan = (await iyzicoRequest(config, 'POST', plansPath, {
    locale: 'tr', conversationId: crypto.randomUUID(), name: planName,
    price: 350, currencyCode: 'TRY', paymentInterval: 'MONTHLY',
    paymentIntervalCount: 1, planPaymentType: 'RECURRING', trialPeriodDays: 0,
  })).data;
  if (!plan?.referenceCode) throw new Error('Plan referansı alınamadı.');
  return plan.referenceCode;
}

function subscriptionReference(result) {
  return result?.data?.subscriptionReferenceCode || result?.subscriptionReferenceCode || result?.data?.referenceCode || null;
}

function subscriptionStatus(result) {
  const providerStatus = clean(result?.data?.subscriptionStatus || result?.subscriptionStatus, 30).toUpperCase();
  if (providerStatus === 'ACTIVE') return 'active';
  if (providerStatus === 'PENDING') return 'pending';
  if (providerStatus === 'UNPAID') return 'past_due';
  if (providerStatus === 'CANCELED' || providerStatus === 'EXPIRED' || providerStatus === 'UPGRADED') return 'canceled';
  return 'pending';
}

function trustedPaymentPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'iyzipay.com' || url.hostname.endsWith('.iyzipay.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function checkoutDocument(checkoutFormContent) {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KocaMind Güvenli Ödeme</title><style>html,body{margin:0;min-height:100%;background:#f5f6f8;font-family:system-ui,sans-serif}.shell{max-width:760px;margin:0 auto;padding:24px 12px}.brand{text-align:center;margin:0 0 16px;color:#1f2937;font-weight:700}.note{text-align:center;color:#6b7280;font-size:13px;margin:0 0 16px}</style></head>
<body><main class="shell"><p class="brand">KocaMind Plus</p><p class="note">Kart bilgilerin doğrudan iyzico tarafından işlenir.</p><div id="iyzipay-checkout-form" class="responsive"></div>${checkoutFormContent}</main></body></html>`;
}

function verifySubscriptionWebhook(payload, signature, config) {
  if (!signature || !config.secretKey || !config.merchantId) return false;
  const message = config.secretKey + config.merchantId
    + clean(payload.iyziEventType || payload.eventType, 80)
    + clean(payload.subscriptionReferenceCode, 100)
    + clean(payload.orderReferenceCode, 100)
    + clean(payload.customerReferenceCode, 100);
  const expected = crypto.createHmac('sha256', config.secretKey).update(message).digest('hex');
  const actual = String(signature).trim().toLowerCase();
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function registerPublicBillingRoutes(app, { firestoreDb, FieldValue, env, notify = async () => {} }) {
  const config = getBillingConfig(env);
  const tell = (kind, uid, data) => Promise.resolve(notify(kind, uid, data)).catch(error => console.error('Ödeme maili gönderilemedi:', kind, error.message));

  app.get('/billing/checkout/:token', async (req, res) => {
    const token = clean(req.params?.token, 160);
    if (!/^[a-z0-9-]{20,160}$/i.test(token)) return res.status(404).send('Ödeme oturumu bulunamadı.');
    try {
      const session = await firestoreDb.collection('billing_sessions').doc(token).get();
      const data = session.data();
      const expiresAt = data?.expiresAt?.toDate?.() || data?.expiresAt;
      if (!session.exists || data?.status !== 'pending' || !data?.checkoutFormContent
        || !expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
        // Süresi dolan oturumdaki ödeme formu (ad, telefon, e-posta içerir) saklanmaz.
        if (session.exists && data?.checkoutFormContent) {
          await session.ref.set({ status: 'expired', checkoutFormContent: null }, { merge: true }).catch(() => {});
        }
        return res.status(410).send('Ödeme oturumunun süresi doldu. KocaMind üzerinden yeniden başlat.');
      }
      res.set({
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        // iyzico'nun ödeme formu satır içi betik ve eval kullandığı için bu iki izin
        // yalnızca bu sayfada, yalnızca iyzico kaynaklarıyla birlikte verilir.
        'Content-Security-Policy': "default-src 'self' data: blob: https://*.iyzipay.com; script-src 'unsafe-inline' 'unsafe-eval' https://*.iyzipay.com; style-src 'unsafe-inline' https://*.iyzipay.com; connect-src https://*.iyzipay.com; frame-src https://*.iyzipay.com; form-action https://*.iyzipay.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
      });
      return res.type('html').send(checkoutDocument(data.checkoutFormContent));
    } catch (error) {
      console.error('Ödeme formu açılamadı:', error.message);
      return res.status(500).send('Ödeme formu açılamadı. Lütfen tekrar dene.');
    }
  });

  app.post('/billing/setup', async (req, res) => {
    const supplied = clean(req.get('x-billing-setup-token'), 200);
    const expected = clean(config.setupToken, 200);
    if (!supplied || !expected || supplied.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(404).json({ error: 'Bulunamadı.' });
    }
    try {
      const pricingPlanReferenceCode = await ensureSandboxPlan(config);
      return res.json({ pricingPlanReferenceCode });
    } catch (error) {
      console.error('Ödeme planı hazırlama hatası:', error.message);
      return res.status(400).json({ error: error.message });
    }
  });
  app.post('/billing/iyzico/callback', async (req, res) => {
    const token = clean(req.body?.token || req.query?.token, 160);
    if (!token) return res.redirect(303, `${config.frontendUrl}/?billing=failed`);
    try {
      const sessionRef = firestoreDb.collection('billing_sessions').doc(token);
      const session = await sessionRef.get();
      if (!session.exists) throw new Error('Ödeme oturumu bulunamadı.');
      const result = await iyzicoRequest(config, 'GET', `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
      const referenceCode = subscriptionReference(result);
      if (!referenceCode) throw new Error('Abonelik referansı alınamadı.');
      const uid = session.data().uid;
      const firstCompletion = session.data().status !== 'completed';
      const status = subscriptionStatus(result);
      const billing = { plan: PLAN_ID, status, provider: 'iyzico', subscriptionReferenceCode: referenceCode, testMode: !config.live, updatedAt: FieldValue.serverTimestamp() };
      const batch = firestoreDb.batch();
      batch.set(firestoreDb.collection('users').doc(uid), { billing }, { merge: true });
      batch.set(firestoreDb.collection('billing_subscriptions').doc(referenceCode), { uid, ...billing, customerReferenceCode: result?.data?.customerReferenceCode || null, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      batch.set(sessionRef, { status: 'completed', checkoutFormContent: null, subscriptionReferenceCode: referenceCode, completedAt: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
      if (firstCompletion && status === 'active') await tell('billingActivated', uid, { appUrl: config.frontendUrl });
      return res.redirect(303, `${config.frontendUrl}/?billing=${status === 'active' ? 'success' : 'pending'}`);
    } catch (error) {
      console.error('iyzico callback hatası:', error.message);
      await firestoreDb.collection('billing_sessions').doc(token).set({ status: 'failed', error: clean(error.message, 300) }, { merge: true }).catch(() => {});
      return res.redirect(303, `${config.frontendUrl}/?billing=failed`);
    }
  });

  app.post('/billing/iyzico/webhook', async (req, res) => {
    const signature = req.get('x-iyz-signature-v3');
    if (!verifySubscriptionWebhook(req.body || {}, signature, config)) return res.status(401).json({ error: 'Geçersiz webhook imzası.' });
    try {
      const payload = req.body || {};
      const referenceCode = clean(payload.subscriptionReferenceCode, 100);
      const subscriptionRef = firestoreDb.collection('billing_subscriptions').doc(referenceCode);
      const subscription = await subscriptionRef.get();
      if (!subscription.exists) return res.status(202).json({ accepted: true });
      const uid = subscription.data().uid;
      const success = payload.iyziEventType === 'subscription.order.success';
      const status = success ? 'active' : 'past_due';
      const orderReference = clean(payload.orderReferenceCode, 120);
      const invoiceRef = orderReference ? firestoreDb.collection('users').doc(uid).collection('invoices').doc(orderReference) : null;
      const previousInvoice = invoiceRef ? await invoiceRef.get() : null;
      const invoiceStatus = success ? 'paid' : 'failed';
      const statusChanged = invoiceRef && previousInvoice?.data()?.status !== invoiceStatus;
      const batch = firestoreDb.batch();
      batch.set(subscriptionRef, { status, lastEvent: payload.iyziEventType, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      batch.set(firestoreDb.collection('users').doc(uid), { billing: { plan: PLAN_ID, status, provider: 'iyzico', subscriptionReferenceCode: referenceCode, testMode: !config.live, updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
      if (payload.orderReferenceCode) batch.set(firestoreDb.collection('users').doc(uid).collection('invoices').doc(clean(payload.orderReferenceCode, 120)), { provider: 'iyzico', status: success ? 'paid' : 'failed', orderReferenceCode: clean(payload.orderReferenceCode, 120), iyziReferenceCode: clean(payload.iyziReferenceCode, 120), createdAt: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
      if (statusChanged) {
        await tell(success ? 'billingPaid' : 'billingFailed', uid, success ? { orderReference } : { appUrl: config.frontendUrl });
      }
      return res.json({ received: true });
    } catch (error) {
      console.error('iyzico webhook hatası:', error.message);
      return res.status(500).json({ error: 'Webhook işlenemedi.' });
    }
  });
}

function registerProtectedBillingRoutes(app, { firestoreDb, FieldValue, env, notify = async () => {} }) {
  const config = getBillingConfig(env);
  app.get('/billing/status', async (req, res) => {
    const userRef = firestoreDb.collection('users').doc(req.user.uid);
    const [user, invoices] = await Promise.all([userRef.get(), userRef.collection('invoices').orderBy('createdAt', 'desc').limit(20).get().catch(() => null)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ configured: config.configured, testMode: !config.live, billing: user.data()?.billing || { plan: 'free', status: 'active' }, invoices: invoices ? invoices.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [] });
  });

  app.post('/billing/checkout', async (req, res) => {
    try {
      if (req.body?.planId !== PLAN_ID) return res.status(400).json({ error: 'Geçersiz plan.' });
      if (req.body?.acceptedTerms !== true) return res.status(400).json({ error: 'Abonelik koşullarını kabul etmelisin.' });
      if (!config.configured) return res.status(503).json({ error: 'Ödeme sistemi henüz yapılandırılmadı.' });
      const userRef = firestoreDb.collection('users').doc(req.user.uid);
      const user = await userRef.get();
      if (user.data()?.billing?.plan === PLAN_ID && user.data()?.billing?.status === 'active') {
        return res.status(409).json({ error: 'Plus aboneliğin zaten aktif.' });
      }
      const customer = validateCustomer(req.body?.customer, req.user.email);
      const conversationId = crypto.randomUUID();
      const address = { contactName: `${customer.name} ${customer.surname}`, city: customer.city, district: customer.district, country: 'Türkiye', address: customer.address, zipCode: customer.zipCode || '00000' };
      const result = await iyzicoRequest(config, 'POST', '/v2/subscription/checkoutform/initialize', {
        locale: 'tr', conversationId,
        callbackUrl: `${config.backendUrl}/billing/iyzico/callback`,
        pricingPlanReferenceCode: config.pricingPlanReferenceCode,
        subscriptionInitialStatus: 'ACTIVE',
        customer: { name: customer.name, surname: customer.surname, identityNumber: customer.identityNumber, email: customer.email, gsmNumber: customer.gsmNumber, billingAddress: address, shippingAddress: address },
      });
      const token = clean(result.token, 160);
      const paymentPageUrl = trustedPaymentPageUrl(result.paymentPageUrl);
      const checkoutFormContent = typeof result.checkoutFormContent === 'string' ? result.checkoutFormContent : '';
      if (!token || (!paymentPageUrl && !checkoutFormContent)) throw new Error('Güvenli ödeme sayfası oluşturulamadı.');
      // Kullanıcının yarım kalmış eski ödeme oturumlarındaki kişisel bilgileri temizle.
      const stale = await firestoreDb.collection('billing_sessions')
        .where('uid', '==', req.user.uid).where('status', '==', 'pending').get().catch(() => null);
      if (stale && !stale.empty) {
        const cleanup = firestoreDb.batch();
        stale.docs.forEach(doc => cleanup.set(doc.ref, { status: 'expired', checkoutFormContent: null }, { merge: true }));
        await cleanup.commit().catch(error => console.warn('Eski ödeme oturumları temizlenemedi:', error.message));
      }
      await firestoreDb.collection('billing_sessions').doc(token).set({
        uid: req.user.uid,
        planId: PLAN_ID,
        conversationId,
        status: 'pending',
        testMode: !config.live,
        checkoutFormContent: paymentPageUrl ? null : checkoutFormContent,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.json({ checkoutUrl: paymentPageUrl || `${config.backendUrl}/billing/checkout/${encodeURIComponent(token)}`, testMode: !config.live });
    } catch (error) {
      console.error('Ödeme başlatılamadı:', error.message);
      return res.status(config.configured ? 400 : 503).json({ error: error.message });
    }
  });

  app.post('/billing/cancel', async (req, res) => {
    try {
      const userRef = firestoreDb.collection('users').doc(req.user.uid);
      const user = await userRef.get();
      const referenceCode = user.data()?.billing?.subscriptionReferenceCode;
      if (!referenceCode) return res.status(400).json({ error: 'Aktif abonelik bulunamadı.' });
      await iyzicoRequest(config, 'POST', `/v2/subscription/subscriptions/${encodeURIComponent(referenceCode)}/cancel`);
      await Promise.all([
        userRef.set({ billing: { plan: 'free', status: 'canceled', provider: 'iyzico', subscriptionReferenceCode: referenceCode, testMode: !config.live, updatedAt: FieldValue.serverTimestamp() } }, { merge: true }),
        firestoreDb.collection('billing_subscriptions').doc(referenceCode).set({ status: 'canceled', updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
      ]);
      await Promise.resolve(notify('billingCanceled', req.user.uid, {})).catch(error => console.error('İptal maili gönderilemedi:', error.message));
      return res.json({ success: true });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Abonelik iptal edilemedi.' });
    }
  });
}

module.exports = { checkoutDocument, getBillingConfig, isValidTckn, registerProtectedBillingRoutes, registerPublicBillingRoutes, subscriptionStatus, trustedPaymentPageUrl, validateCustomer, verifySubscriptionWebhook };
