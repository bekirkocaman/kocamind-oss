const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const nodeFetch = require('node-fetch');
const {
  assertSafePublicUrl,
  createSafeAgents,
  createSafeLookup,
  isPrivateIp,
} = require('../agent/security');
const { fetchPublicPage } = require('../agent/tools');

test('isPrivateIp özel, ayrılmış, eşlenmiş ve geçersiz adresleri reddeder', () => {
  for (const ip of [
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::7f00:1',
    '198.18.0.1', '192.0.0.1', '255.255.255.255', 'ff02::1', 'fe80::1', 'fc00::1', 'abc',
  ]) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('IP literal URL adresleri DNS çağrılmadan reddedilir', async () => {
  let dnsCalls = 0;
  const resolver = () => { dnsCalls += 1; };
  for (const url of ['http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/']) {
    await assert.rejects(() => assertSafePublicUrl(url, resolver), /engellendi/);
  }
  assert.equal(dnsCalls, 0);
});

test('safeLookup tüm DNS cevaplarını doğrular ve genel IP döndürür', async () => {
  const lookup = createSafeLookup((hostname, options, callback) => callback(null, [{ address: hostname === 'safe.test' ? '1.1.1.1' : '127.0.0.1', family: 4 }]));
  await assert.rejects(() => new Promise((resolve, reject) => lookup('private.test', {}, (error, address) => error ? reject(error) : resolve(address))), { code: 'EACCES' });
  const address = await new Promise((resolve, reject) => lookup('safe.test', {}, (error, result) => error ? reject(error) : resolve(result)));
  assert.equal(address, '1.1.1.1');
  const all = await new Promise((resolve, reject) => lookup('safe.test', { all: true }, (error, result) => error ? reject(error) : resolve(result)));
  assert.deepEqual(all, [{ address: '1.1.1.1', family: 4 }]);
});

test('bağlantı anındaki DNS rebinding yerel sunucuya ulaşmadan engellenir', async t => {
  let requests = 0;
  const server = http.createServer((request, response) => { requests += 1; response.end('secret'); });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let calls = 0;
  const resolver = (hostname, options, callback) => callback(null, [{ address: calls++ === 0 ? '1.1.1.1' : '127.0.0.1', family: 4 }]);
  const agents = createSafeAgents({ lookup: createSafeLookup(resolver) });
  const port = server.address().port;
  await assert.rejects(() => fetchPublicPage(nodeFetch, `http://rebind.test:${port}/`, {}, { lookup: resolver, ...agents }), /engellendi/);
  assert.equal(requests, 0);
});

test('özel IP hedefine yönlendirme ikinci istekten önce reddedilir', async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return {
      status: 302,
      headers: { get: name => name === 'location' ? 'http://127.0.0.1/secret' : null },
      body: { resume() {} },
    };
  };
  const resolver = (hostname, options, callback) => callback(null, [{ address: '1.1.1.1', family: 4 }]);
  await assert.rejects(() => fetchPublicPage(fakeFetch, 'http://public.test/', {}, { lookup: resolver }), /engellendi/);
  assert.equal(calls, 1);
});
