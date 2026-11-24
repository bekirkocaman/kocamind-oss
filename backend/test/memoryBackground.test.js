const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const express = require('express');
const request = require('supertest');
const { runAfterResponse } = require('../memory/background');

test('200 ile biten cevaptan sonra iş çalışır', async () => {
  let ran = false;
  let resolveDone;
  const donePromise = new Promise(resolve => { resolveDone = resolve; });

  const app = express();
  app.get('/ok', (_req, res) => {
    runAfterResponse(res, async () => {
      ran = true;
      resolveDone();
    });
    res.status(200).json({ ok: true });
  });

  const res = await request(app).get('/ok');
  assert.equal(res.status, 200);
  await donePromise;
  assert.equal(ran, true);
});

test('503 ile biten cevapta iş çalışmaz', async () => {
  let ran = false;
  const app = express();
  app.get('/err', (_req, res) => {
    runAfterResponse(res, async () => {
      ran = true;
    });
    res.status(503).json({ ok: false });
  });

  const res = await request(app).get('/err');
  assert.equal(res.status, 503);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ran, false);
});

test('iş hata fırlatırsa istek yine 200 döner ve süreç çökmez', async () => {
  const app = express();
  app.get('/sync-throw', (_req, res) => {
    runAfterResponse(res, () => {
      throw new Error('senkron hata');
    });
    res.status(200).json({ ok: true });
  });

  const res = await request(app).get('/sync-throw');
  assert.equal(res.status, 200);
  await new Promise(resolve => setImmediate(resolve));
});

test('iş reddedilen promise döndürürse yakalanmamış rejection oluşmaz', async () => {
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.once('unhandledRejection', onUnhandled);
  try {
    const app = express();
    app.get('/async-reject', (_req, res) => {
      runAfterResponse(res, async () => {
        throw new Error('asenkron reddedilme');
      });
      res.status(200).json({ ok: true });
    });

    const res = await request(app).get('/async-reject');
    assert.equal(res.status, 200);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(unhandled, false);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('iş en fazla bir kez çalışır ve finish olmadan close olursa çalışmaz', async () => {
  let count = 0;
  const res1 = new EventEmitter();
  res1.statusCode = 200;
  runAfterResponse(res1, async () => {
    count += 1;
  });
  res1.emit('finish');
  res1.emit('finish');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);

  let closedCount = 0;
  const res2 = new EventEmitter();
  res2.statusCode = 200;
  runAfterResponse(res2, async () => {
    closedCount += 1;
  });
  res2.emit('close');
  res2.emit('finish');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closedCount, 0);
});
