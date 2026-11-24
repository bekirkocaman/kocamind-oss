const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const ipv4BlockList = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) ipv4BlockList.addSubnet(network, prefix, 'ipv4');

const ipv6BlockList = new net.BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7],
  ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) ipv6BlockList.addSubnet(network, prefix, 'ipv6');

function embeddedIpv4(address) {
  let normalized;
  try {
    normalized = new net.SocketAddress({ address, family: 'ipv6', port: 0 }).address.toLowerCase();
  } catch {
    return null;
  }
  const prefix = normalized.startsWith('::ffff:')
    ? '::ffff:'
    : normalized.startsWith('64:ff9b::') ? '64:ff9b::' : null;
  if (!prefix) return null;
  const suffix = normalized.slice(prefix.length);
  if (net.isIPv4(suffix)) return suffix;
  const parts = suffix.split(':');
  if (parts.length !== 2 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const value = (parseInt(parts[0], 16) * 0x10000) + parseInt(parts[1], 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function isPrivateIp(address) {
  if (typeof address !== 'string') return true;
  if (net.isIPv4(address)) return ipv4BlockList.check(address, 'ipv4');
  if (!net.isIPv6(address)) return true;
  const embedded = embeddedIpv4(address);
  if (embedded) return isPrivateIp(embedded);
  return ipv6BlockList.check(address, 'ipv6');
}

function blockedAddressError() {
  const error = new Error('Özel veya yerel ağ adreslerine erişim engellendi.');
  error.code = 'EACCES';
  return error;
}

function resolveAll(resolveFn, hostname) {
  return new Promise((resolve, reject) => {
    resolveFn(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

function createSafeLookup(resolveFn = dns.lookup) {
  return function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const requested = typeof options === 'number' ? { family: options } : (options || {});
    resolveFn(hostname, { ...requested, all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(item => isPrivateIp(item.address))) {
        return callback(blockedAddressError());
      }
      if (requested.all) return callback(null, addresses);
      const selected = addresses[0];
      return callback(null, selected.address, selected.family);
    });
  };
}

const safeLookup = createSafeLookup();

function createSafeAgents({ lookup = safeLookup } = {}) {
  return {
    httpAgent: new http.Agent({ lookup, keepAlive: false }),
    httpsAgent: new https.Agent({ lookup, keepAlive: false }),
  };
}

const defaultSafeAgents = createSafeAgents();

async function assertSafePublicUrl(rawUrl, resolveFn = dns.lookup) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Geçerli bir URL gerekli.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Yalnızca HTTP(S) adresleri desteklenir.');
  if (url.username || url.password) throw new Error('Kimlik bilgisi içeren URL kullanılamaz.');
  if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) {
    throw new Error('Yerel ağ adreslerine erişim engellendi.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw blockedAddressError();
    return url;
  }
  const addresses = await resolveAll(resolveFn, hostname);
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) throw blockedAddressError();
  return url;
}

function safeError(error) {
  const message = String(error?.message || 'Araç çalıştırılamadı')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 600);
  return { ok: false, error: message };
}

module.exports = {
  assertSafePublicUrl,
  createSafeAgents,
  createSafeLookup,
  defaultSafeAgents,
  isPrivateIp,
  safeLookup,
  safeError,
};
