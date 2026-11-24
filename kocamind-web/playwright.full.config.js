// Giriş yapmış kullanıcıyla uçtan uca testler: Firebase Auth/Firestore emülatörü, sahte model
// sunucusu, gerçek backend ve web. Gerçek hesaplara ve servislere hiç dokunmaz.
// Java gerekir (Firestore emülatörü). Çalıştırma: npm run test:e2e:full
import { defineConfig, devices } from '@playwright/test'
import process from 'node:process'

const PROJECT = 'demo-kocamind'
const FAKE_MODEL = 'http://127.0.0.1:4010/v1/chat/completions'

export default defineConfig({
  testDir: './e2e/full',
  // Testler aynı emülatörü paylaşır; her test kendi kullanıcısını açar ama sırayla koşar.
  workers: 1,
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node e2e/fakeModel.mjs',
      url: 'http://127.0.0.1:4010',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node e2e/startEmulators.mjs',
      url: 'http://127.0.0.1:4401',
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
    {
      command: 'node server.js',
      cwd: '../backend',
      url: 'http://127.0.0.1:3101/health',
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: '3101',
        ALLOWED_ORIGINS: 'http://127.0.0.1:4174',
        FIREBASE_PROJECT_ID: PROJECT,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        DEEPSEEK_API_KEY: 'e2e',
        DEEPSEEK_BASE_URL: FAKE_MODEL,
        MEMORY_ASSIST_URL: FAKE_MODEL,
        // Testler aynı IP'den art arda gelir; genel istek sınırı (dakikada 30) testi bozmasın.
        RATE_LIMIT_MAX: '10000',
        // Yerel .env'deki gerçek anahtarlar testte kullanılmasın (dotenv tanımlı değişkeni ezmez).
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        GROQ_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        XAI_API_KEY: '',
        EVREN_LLM_API_KEY: '',
        RESEND_API_KEY: '',
        QDRANT_URL: '',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_BACKEND_URL: 'http://127.0.0.1:3101',
        VITE_FIREBASE_PROJECT_ID: PROJECT,
        VITE_FIREBASE_API_KEY: 'demo-key',
        VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
        VITE_USE_FIREBASE_EMULATOR: '1',
      },
    },
  ],
})
