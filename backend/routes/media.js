function registerMediaRoutes(app, { enforceDailyQuota, fetch, uuidv4, storageBucket, firestoreDb, FieldValue }) {
  app.post('/generate-image', enforceDailyQuota('image'), async (req, res) => {
    try {
      const { prompt, aspectRatio } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: 'prompt gerekli' });
      }
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY tanımlı değil' });
      }

      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-image:generateContent';
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: aspectRatio || '1:1' },
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const quotaError = response.status === 429 || /quota|billing|plan/i.test(data.error?.message || '');
        return res.status(response.status).json({
          error: quotaError
            ? 'Fotoğraf üretimi için Google medya bütçesi henüz etkin değil. Yönetici faturalandırmayı açmalı.'
            : data.error?.message || 'Görsel modeli hatası',
        });
      }

      // Return base64 image
      const imagePart = (data.candidates?.[0]?.content?.parts || []).find(part => part.inlineData?.data);
      if (!imagePart) {
        return res.status(400).json({ error: 'Görsel üretilemedi. Prompt uygun olmayabilir.' });
      }

      let downloadUrl = null;
      try {
        const mimeType = imagePart.inlineData.mimeType || 'image/png';
        const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const imageId = uuidv4();
        const storagePath = `generated-images/${req.user.uid}/${imageId}.${extension}`;
        const downloadToken = uuidv4();
        await storageBucket.file(storagePath).save(Buffer.from(imagePart.inlineData.data, 'base64'), {
          resumable: false,
          metadata: {
            contentType: mimeType,
            cacheControl: 'private,max-age=3600',
            metadata: { firebaseStorageDownloadTokens: downloadToken },
          },
        });
        downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
      } catch (storageError) {
        console.warn('Generated image storage warning:', storageError.message);
      }

      res.json({
        success: true,
        image: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType || 'image/png',
        url: downloadUrl,
      });
    } catch (e) {
      console.error('Image generation hatası:', e.message);
      res.status(500).json({ error: 'Görsel üretme hatası: ' + e.message });
    }
  });

  const VEO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview';

  app.post('/generate-video', enforceDailyQuota('video'), async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim().slice(0, 4000);
      const aspectRatio = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
      if (!prompt) return res.status(400).json({ error: 'Video açıklaması gerekli.' });
      if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'Video üretimi henüz yapılandırılmadı.' });

      const response = await fetch(`${VEO_BASE_URL}/models/${VEO_MODEL}:predictLongRunning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.name) {
        const quotaError = response.status === 429 || /quota|billing|plan/i.test(data.error?.message || '');
        return res.status(response.status || 500).json({
          error: quotaError
            ? 'Video üretimi için Google medya bütçesi henüz etkin değil. Yönetici faturalandırmayı açmalı.'
            : data.error?.message || 'Video üretimi başlatılamadı.',
        });
      }

      const jobId = uuidv4();
      await firestoreDb.collection('video_jobs').doc(jobId).set({
        uid: req.user.uid,
        operationName: data.name,
        prompt,
        aspectRatio,
        model: VEO_MODEL,
        status: 'processing',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.status(202).json({ success: true, jobId, status: 'processing' });
    } catch (error) {
      console.error('Video generation start error:', error.message);
      return res.status(500).json({ error: 'Video üretimi başlatılamadı: ' + error.message });
    }
  });

  app.get('/generate-video/:jobId', async (req, res) => {
    try {
      const jobRef = firestoreDb.collection('video_jobs').doc(String(req.params.jobId || ''));
      const snapshot = await jobRef.get();
      if (!snapshot.exists || snapshot.data()?.uid !== req.user.uid) return res.status(404).json({ error: 'Video işi bulunamadı.' });
      const job = snapshot.data();
      if (job.status === 'completed' && job.downloadUrl) {
        return res.json({ success: true, status: 'completed', videoUrl: job.downloadUrl });
      }
      if (job.status === 'failed') return res.json({ success: false, status: 'failed', error: job.error || 'Video üretilemedi.' });

      const operationResponse = await fetch(`${VEO_BASE_URL}/${job.operationName}`, {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      });
      const operation = await operationResponse.json().catch(() => ({}));
      if (!operationResponse.ok) return res.status(operationResponse.status).json({ error: operation.error?.message || 'Video durumu alınamadı.' });
      if (!operation.done) return res.json({ success: true, status: 'processing' });
      if (operation.error) {
        const message = operation.error.message || 'Video üretilemedi.';
        await jobRef.set({ status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return res.json({ success: false, status: 'failed', error: message });
      }

      const videoUri = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUri) throw new Error('Veo tamamlandı ancak video dosyası bulunamadı.');
      const videoResponse = await fetch(videoUri, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
      if (!videoResponse.ok) throw new Error('Üretilen video indirilemedi.');
      const videoBuffer = await videoResponse.buffer();
      if (!videoBuffer.length || videoBuffer.length > 150 * 1024 * 1024) throw new Error('Video dosyası geçersiz veya çok büyük.');

      const storagePath = `generated-videos/${req.user.uid}/${req.params.jobId}.mp4`;
      const downloadToken = uuidv4();
      await storageBucket.file(storagePath).save(videoBuffer, {
        resumable: false,
        metadata: {
          contentType: 'video/mp4',
          cacheControl: 'private,max-age=3600',
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
      await jobRef.set({ status: 'completed', downloadUrl, storagePath, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return res.json({ success: true, status: 'completed', videoUrl: downloadUrl });
    } catch (error) {
      console.error('Video generation status error:', error.message);
      return res.status(500).json({ error: 'Video hazırlanamadı: ' + error.message });
    }
  });
}

module.exports = { registerMediaRoutes };
