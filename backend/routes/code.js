function registerCodeRoutes(app, { enforceDailyQuota, fetch }) {
  app.post('/run-code', enforceDailyQuota('code'), async (req, res) => {
    try {
      const { language, code, stdin } = req.body;
      if (!language || !code) {
        return res.status(400).json({ error: 'language ve code gerekli' });
      }

      // Language mapping for Piston API
      const langMap = {
        'python': { language: 'python', version: '3.10.0' },
        'javascript': { language: 'javascript', version: '18.15.0' },
        'typescript': { language: 'typescript', version: '5.0.3' },
        'java': { language: 'java', version: '15.0.2' },
        'c': { language: 'c', version: '10.2.0' },
        'cpp': { language: 'cpp', version: '10.2.0' },
        'c++': { language: 'cpp', version: '10.2.0' },
        'csharp': { language: 'csharp', version: '6.12.0' },
        'go': { language: 'go', version: '1.16.2' },
        'rust': { language: 'rust', version: '1.68.2' },
        'ruby': { language: 'ruby', version: '3.0.1' },
        'php': { language: 'php', version: '8.2.3' },
        'swift': { language: 'swift', version: '5.3.3' },
        'kotlin': { language: 'kotlin', version: '1.8.20' },
        'bash': { language: 'bash', version: '5.2.0' },
        'sql': { language: 'sqlite3', version: '3.36.0' },
      };

      const langConfig = langMap[language.toLowerCase()] || { language: language.toLowerCase(), version: '*' };

      const response = await fetch('https://emkc.org/api/v2/piston/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: langConfig.language,
          version: langConfig.version,
          files: [{ content: code }],
          stdin: stdin || '',
          run_timeout: 10000, // 10 second timeout
          compile_timeout: 10000,
        }),
      });

      const data = await response.json();
      
      res.json({
        success: true,
        language: langConfig.language,
        output: data.run?.output || data.compile?.output || '',
        stderr: data.run?.stderr || data.compile?.stderr || '',
        exitCode: data.run?.code ?? -1,
      });
    } catch (e) {
      console.error('Code execution hatası:', e.message);
      res.status(500).json({ error: 'Kod çalıştırma hatası: ' + e.message });
    }
  });
}

module.exports = { registerCodeRoutes };
