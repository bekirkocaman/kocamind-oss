'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { getBillingConfig, subscriptionStatus, trustedPaymentPageUrl, validateCustomer, verifySubscriptionWebhook } = require('../billing');

test('billing defaults to sandbox unless live mode is explicit', () => {
  const config = getBillingConfig({
    IYZICO_API_KEY: 'key', IYZICO_SECRET_KEY: 'secret',
    IYZICO_PRICING_PLAN_REFERENCE_CODE: 'plan',
  });
  assert.equal(config.configured, true);
  assert.equal(config.live, false);
  assert.equal(config.uri, 'https://sandbox-api.iyzipay.com');
});

test('redacted placeholders never enable billing', () => {
  const config = getBillingConfig({
    IYZICO_API_KEY: '[SENSITIVE]', IYZICO_SECRET_KEY: '[SENSITIVE]',
    IYZICO_PRICING_PLAN_REFERENCE_CODE: '[SENSITIVE]',
    IYZICO_BASE_URL: '[SENSITIVE]', PUBLIC_FRONTEND_URL: '[SENSITIVE]',
  });
  assert.equal(config.credentialsConfigured, false);
  assert.equal(config.configured, false);
  assert.equal(config.uri, 'https://sandbox-api.iyzipay.com');
  assert.equal(config.frontendUrl, 'https://kocamind.com');
});

test('customer validation normalizes phone and rejects incomplete identity', () => {
  const customer = validateCustomer({
    name: 'Ada', surname: 'Lovelace', identityNumber: '10000000146',
    gsmNumber: '+90 (555) 111 22 33', city: 'İstanbul', district: 'Kadıköy',
    address: 'Örnek Mahallesi No: 1', zipCode: '34710',
  }, 'ada@example.com');
  assert.equal(customer.gsmNumber, '+905551112233');
  assert.throws(() => validateCustomer({ ...customer, identityNumber: '123' }), /Geçerli bir T.C./);
});

test('subscription webhook signature uses iyzico v3 order', () => {
  const config = { merchantId: '3404590', secretKey: 'secret' };
  const payload = {
    iyziEventType: 'subscription.order.success',
    subscriptionReferenceCode: 'sub', orderReferenceCode: 'order', customerReferenceCode: 'customer',
  };
  const message = config.secretKey + config.merchantId + payload.iyziEventType
    + payload.subscriptionReferenceCode + payload.orderReferenceCode + payload.customerReferenceCode;
  const signature = crypto.createHmac('sha256', config.secretKey).update(message).digest('hex');
  assert.equal(verifySubscriptionWebhook(payload, signature, config), true);
  assert.equal(verifySubscriptionWebhook(payload, '0'.repeat(64), config), false);
});

test('subscription response is activated only when iyzico reports ACTIVE', () => {
  assert.equal(subscriptionStatus({ data: { subscriptionStatus: 'ACTIVE' } }), 'active');
  assert.equal(subscriptionStatus({ data: { subscriptionStatus: 'PENDING' } }), 'pending');
  assert.equal(subscriptionStatus({ data: { subscriptionStatus: 'UNPAID' } }), 'past_due');
  assert.equal(subscriptionStatus({ data: {} }), 'pending');
});

test('hosted checkout redirects only to iyzico HTTPS hosts', () => {
  assert.equal(trustedPaymentPageUrl('https://sandbox-api.iyzipay.com/checkoutform/token'), 'https://sandbox-api.iyzipay.com/checkoutform/token');
  assert.equal(trustedPaymentPageUrl('http://sandbox-api.iyzipay.com/checkoutform/token'), null);
  assert.equal(trustedPaymentPageUrl('https://iyzipay.com.evil.example/checkoutform/token'), null);
});

test('T.C. kimlik numarası kontrol haneleriyle doğrulanır', () => {
  const { isValidTckn } = require('../billing');
  assert.equal(isValidTckn('10000000146'), true);
  assert.equal(isValidTckn('12345678901'), false);
  assert.equal(isValidTckn('00000000000'), false);
  assert.equal(isValidTckn('1000000014'), false);
});

// --- ödeme mailleri ---
const express = require('express');
const request = require('supertest');
const { registerPublicBillingRoutes } = require('../billing');

function billingDb() {
  const docs = new Map();
  const ref = path => ({
    path,
    collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (data, opts) => { docs.set(path, opts?.merge ? { ...(docs.get(path) || {}), ...data } : { ...data }); },
  });
  return {
    docs,
    collection: name => ({ doc: id => ref(`${name}/${id}`) }),
    batch: () => {
      const ops = [];
      return { set: (r, d, o) => ops.push([r, d, o]), commit: async () => { for (const [r, d, o] of ops) await r.set(d, o); } };
    },
  };
}

function webhookApp() {
  const env = { IYZICO_API_KEY: 'api', IYZICO_SECRET_KEY: 'secret', IYZICO_MERCHANT_ID: '3404590' };
  const db = billingDb();
  db.docs.set('billing_subscriptions/sub', { uid: 'u1' });
  const notes = [];
  const a = express();
  a.use(express.json());
  registerPublicBillingRoutes(a, { firestoreDb: db, FieldValue: { serverTimestamp: () => 'now' }, env, notify: async (kind, uid, data) => notes.push({ kind, uid, data }) });
  const sign = p => crypto.createHmac('sha256', 'secret')
    .update('secret3404590' + p.iyziEventType + p.subscriptionReferenceCode + p.orderReferenceCode + (p.customerReferenceCode || '')).digest('hex');
  const post = p => request(a).post('/billing/iyzico/webhook').set('x-iyz-signature-v3', sign(p)).send(p);
  return { post, notes };
}

test('webhook: başarılı ödeme makbuz maili, aynı sipariş tekrar gelirse ikinci mail yok', async () => {
  const { post, notes } = webhookApp();
  const paid = { iyziEventType: 'subscription.order.success', subscriptionReferenceCode: 'sub', orderReferenceCode: 'ORD-1' };
  assert.equal((await post(paid)).status, 200);
  assert.equal((await post(paid)).status, 200);
  assert.deepEqual(notes, [{ kind: 'billingPaid', uid: 'u1', data: { orderReference: 'ORD-1' } }]);
});

test('webhook: başarısız ödeme uyarı maili gider', async () => {
  const { post, notes } = webhookApp();
  const failed = { iyziEventType: 'subscription.order.failure', subscriptionReferenceCode: 'sub', orderReferenceCode: 'ORD-2' };
  assert.equal((await post(failed)).status, 200);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, 'billingFailed');
  assert.equal(notes[0].uid, 'u1');
});
