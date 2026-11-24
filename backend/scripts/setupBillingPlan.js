'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
require('dotenv').config({ path: process.env.BILLING_ENV_FILE || '.env.billing.local', quiet: true });

const apiKey = process.env.IYZICO_API_KEY;
const secretKey = process.env.IYZICO_SECRET_KEY;
const baseUrl = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';

async function request(method, path, body = {}, query = '') {
  if (!apiKey || !secretKey) throw new Error('iyzico anahtarları eksik.');
  const randomKey = `${Date.now()}${Math.random().toString().slice(2)}`;
  const requestBody = method === 'GET' ? '' : JSON.stringify(body);
  const signature = crypto.createHmac('sha256', secretKey)
    .update(randomKey + path + requestBody).digest('hex');
  const params = Buffer.from(`apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`).toString('base64');
  const response = await fetch(`${baseUrl}${path}${query}`, {
    method,
    headers: {
      Authorization: `IYZWSv2 ${params}`,
      'Content-Type': 'application/json',
      'x-iyzi-rnd': randomKey,
      'x-iyzi-client-version': 'kocamind-setup-1.0',
    },
    ...(method === 'GET' ? {} : { body: requestBody }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== 'success') throw new Error(result.errorMessage || `iyzico HTTP ${response.status}`);
  return result;
}

async function main() {
  const productName = 'KocaMind Plus';
  const planName = 'KocaMind Plus Aylık 350 TL';
  const products = await request('GET', '/v2/subscription/products', {}, '?page=1&count=100');
  let product = (products.data?.items || []).find(item => item.name === productName);
  if (!product) {
    const created = await request('POST', '/v2/subscription/products', {
      locale: 'tr', conversationId: crypto.randomUUID(), name: productName,
      description: 'KocaMind yapay zeka asistanı Plus aboneliği',
    });
    product = created.data;
  }
  if (!product?.referenceCode) throw new Error('Ürün referansı alınamadı.');

  const plans = await request('GET', `/v2/subscription/products/${encodeURIComponent(product.referenceCode)}/pricing-plans`, {}, '?page=1&count=100');
  let plan = (plans.data?.items || []).find(item => item.name === planName);
  if (!plan) {
    const created = await request('POST', `/v2/subscription/products/${encodeURIComponent(product.referenceCode)}/pricing-plans`, {
      locale: 'tr', conversationId: crypto.randomUUID(), name: planName,
      price: 350, currencyCode: 'TRY', paymentInterval: 'MONTHLY',
      paymentIntervalCount: 1, planPaymentType: 'RECURRING', trialPeriodDays: 0,
    });
    plan = created.data;
  }
  if (!plan?.referenceCode) throw new Error('Plan referansı alınamadı.');
  process.stdout.write(plan.referenceCode);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
