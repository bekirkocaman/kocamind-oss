// Cevap başarıyla (200) tamamlandıktan sonra arka plan işi çalıştırır.

let waitUntil = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  ({ waitUntil } = require('@vercel/functions'));
} catch {
  waitUntil = null;
}

function runAfterResponse(res, task) {
  if (!res || typeof res.once !== 'function' || typeof task !== 'function') return;

  let done = false;
  let closedBeforeFinish = false;

  const onClose = () => {
    if (!done) closedBeforeFinish = true;
  };

  const onFinish = () => {
    if (done || closedBeforeFinish) return;
    done = true;
    res.removeListener?.('close', onClose);
    if (res.statusCode !== 200) return;

    const promise = Promise.resolve()
      .then(() => task())
      .catch(error => {
        console.warn('Arka plan işi başarısız:', error?.message || error);
      });

    if (typeof waitUntil === 'function') {
      try {
        waitUntil(promise);
      } catch (error) {
        console.warn('waitUntil çağrısı başarısız:', error?.message || error);
      }
    }
  };

  res.once('close', onClose);
  res.once('finish', onFinish);
}

module.exports = { runAfterResponse };
