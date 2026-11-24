const { createWebSearch } = require('../search/webSearch');

function registerSearchRoutes(app, { fetch, enforceDailyQuota = () => (req, res, next) => next(), webSearch = createWebSearch({ fetch }) }) {
  app.post('/search', enforceDailyQuota('search'), async (req, res) => {
    try {
      const { query } = req.body;
      if (!query) return res.status(400).json({ error: 'query gerekli' });
      res.json(await webSearch(query));
    } catch (e) {
      console.error('Search proxy hatası:', e.message);
      res.status(500).json({ error: 'Arama hatası' });
    }
  });
}

module.exports = { registerSearchRoutes };
