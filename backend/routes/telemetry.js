const { createHash } = require('node:crypto');

function clientErrorFingerprint(message, release) {
  const normalized = message
    .replace(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi, '*')
    .replace(/\b(?:0x[\da-f]+|(?=[\da-f]*[a-f])[\da-f]{12,})\b/gi, '*')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return createHash('sha1').update(JSON.stringify([normalized, release])).digest('hex').slice(0, 16);
}

function registerTelemetryRoutes(app, { firestoreDb, FieldValue, quotasForUser }) {
  function cleanTelemetryValue(value, maxLength = 1000) {
    return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/[<>]/g, '').slice(0, maxLength);
  }

  app.post('/telemetry/error', async (req, res) => {
    try {
      const { message, stack, componentStack, url, userAgent, release, reportId } = req.body || {};
      if (reportId !== undefined && (
        typeof reportId !== 'string' || reportId.length < 8 || reportId.length > 64 || /[^A-Za-z0-9_-]/.test(reportId)
      )) {
        return res.status(400).json({ error: 'Geçersiz reportId' });
      }
      const cleanMessage = cleanTelemetryValue(message, 500);
      const cleanRelease = cleanTelemetryValue(release, 100);
      const { uid } = req.user;
      const data = {
        uid,
        message: cleanMessage,
        stack: cleanTelemetryValue(stack, 5000),
        componentStack: cleanTelemetryValue(componentStack, 3000),
        url: cleanTelemetryValue(url, 500),
        userAgent: cleanTelemetryValue(userAgent, 500),
        release: cleanRelease,
        day: new Date().toISOString().slice(0, 10),
        fingerprint: clientErrorFingerprint(cleanMessage, cleanRelease),
        createdAt: FieldValue.serverTimestamp(),
      };
      const collection = firestoreDb.collection('client_errors');
      if (reportId === undefined) {
        await collection.add(data);
      } else {
        try {
          await collection.doc(`${uid}_${reportId}`).create(data);
        } catch (error) {
          if (error?.code !== 6) throw error; // Firestore ALREADY_EXISTS
        }
      }
      res.status(202).json({ accepted: true });
    } catch {
      console.warn('Hata telemetrisi kaydedilemedi.');
      res.status(202).json({ accepted: false });
    }
  });

  app.post('/telemetry/event', async (req, res) => {
    try {
      const event = cleanTelemetryValue(req.body?.event, 80).replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (!event) return res.status(400).json({ error: 'event gerekli' });
      // Yalnızca düz (iç içe olmayan) ve temizlenmiş değerler saklanır.
      const input = req.body?.properties && typeof req.body.properties === 'object' && !Array.isArray(req.body.properties)
        ? req.body.properties
        : {};
      const properties = {};
      for (const [rawKey, value] of Object.entries(input).slice(0, 20)) {
        const key = String(rawKey).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
        if (!key) continue;
        if (typeof value === 'number' && Number.isFinite(value)) properties[key] = value;
        else if (typeof value === 'boolean') properties[key] = value;
        else if (typeof value === 'string') properties[key] = cleanTelemetryValue(value, 200);
      }
      await firestoreDb.collection('product_events').add({
        uid: req.user.uid,
        event,
        properties,
        createdAt: FieldValue.serverTimestamp(),
      });
      res.status(202).json({ accepted: true });
    } catch (error) {
      console.warn('Ürün olayı kaydedilemedi:', error.message);
      res.status(202).json({ accepted: false });
    }
  });

  app.get('/usage/me', async (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    const [snapshot, limits] = await Promise.all([
      firestoreDb.collection('usage_daily').doc(`${req.user.uid}_${day}`).get(),
      quotasForUser(req.user.uid),
    ]);
    res.json({ day, usage: snapshot.data() || {}, limits });
  });
}

module.exports = { registerTelemetryRoutes, clientErrorFingerprint };
