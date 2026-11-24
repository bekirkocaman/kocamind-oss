require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const nodeFetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const multer = require('multer');
const FormData = require('form-data');
const { QdrantClient } = require('@qdrant/js-client-rest');
const { randomUUID: uuidv4 } = require('crypto');
const {
  buildOpenAIResponsesPayload,
  pipeResponsesAsChatCompletions,
  toChatCompletion,
} = require('./openaiResponses');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { createAgentRouter } = require('./agent/routes');
const { createDefaultToolRegistry } = require('./agent/tools');
const { createWebSearch } = require('./search/webSearch');
const { createSkillStore } = require('./skills/skillStore');
const { createPackStore } = require('./memory/packStore');
const { createLearner } = require('./memory/learn');
const { registerPublicBillingRoutes, registerProtectedBillingRoutes } = require('./billing');
const { createMetrics } = require('./metrics');
const { createQuota } = require('./quota');
const { disabledProviders } = require('./learning/providerAvailability');

// Sağlayıcılara giden bağlantılar açık tutulur; her istekte yeniden TCP+TLS el sıkışması yapılmaz.
const keepAliveAgents = {
  http: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  https: new https.Agent({ keepAlive: true, maxSockets: 64 }),
};
const fetch = (url, options = {}) => nodeFetch(url, {
  agent: parsed => (parsed.protocol === 'http:' ? keepAliveAgents.http : keepAliveAgents.https),
  ...options,
});

function initializeFirebaseAdmin() {
  if (getApps().length) return getApps()[0];
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    return initializeApp({ credential: cert(serviceAccount) });
  }
  return initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'kocamind' });
}

const firebaseApp = initializeFirebaseAdmin();
const firebaseAuth = getAuth(firebaseApp);
const firestoreDb = getFirestore(firebaseApp);
const metrics = createMetrics({ firestoreDb, FieldValue, env: process.env });
const storageBucket = getStorage(firebaseApp).bucket(process.env.FIREBASE_STORAGE_BUCKET || 'kocamind.firebasestorage.app');

// Dosya yüklemeleri RAM'de tutulur (max 25MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const app = express();
// Sohbet zamanlama logu isteğin sunucuya ulaştığı andan ölçer (auth ve kota dahil).
app.use((req, _res, next) => { req.receivedAt = Date.now(); next(); });
app.disable('x-powered-by');
app.set('trust proxy', 1);
// API yalnızca JSON döndürür; hiçbir kaynak yüklenmesine ve çerçeveye izin verilmez.
// Ödeme sayfası (/billing/checkout/:token) kendi CSP başlığını ayrıca ayarlar.
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
  frameguard: { action: 'deny' },
  strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://kocamind.com,https://www.kocamind.com,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
for (const productionOrigin of ['https://kocamind.com', 'https://www.kocamind.com']) {
  if (!allowedOrigins.includes(productionOrigin)) allowedOrigins.push(productionOrigin);
}
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  // Web istemcisi geri bildirimi cevabı veren gerçek modele bağlar (Otomatik seçimde önemli).
  exposedHeaders: ['X-KocaMind-Model', 'X-KocaMind-Provider', 'X-KocaMind-Model-Label', 'X-KocaMind-Fallback-From', 'X-KocaMind-Fallback-From-Label'],
}));
// Hız sınırı gövde ayrıştırmadan ÖNCE uygulanır: kimliği doğrulanmamış veya
// aşırı istekler, büyük gövde belleğe alınmadan 429 ile reddedilir.
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 30),
  message: { error: 'Çok fazla istek gönderdin, biraz bekle.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Genel JSON gövde limiti küçük tutulur (1 MB). Yalnızca RAG doküman yüklemesi
// büyük gövdeye ihtiyaç duyar; o uç kendi 25 MB parser'ını kullanır ve bu parser
// global parser'dan önce çalıştığı için global 1 MB limiti onu etkilemez.
app.use('/rag/upload', express.json({ limit: '25mb' }));
app.use('/ide/complete', express.json({ limit: '4mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Oturum açman gerekiyor.' });
  try {
    req.user = await firebaseAuth.verifyIdToken(token, true);
    if (req.body && typeof req.body === 'object' && 'userId' in req.body) {
      req.body.userId = req.user.uid;
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Oturum süresi dolmuş veya geçersiz.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.admin === true) return next();
  return res.status(403).json({ error: 'Bu işlem için yönetici yetkisi gerekiyor.' });
}

const { quotasForUser, enforceDailyQuota, consumeDailyQuota } = createQuota({ firestoreDb, FieldValue, env: process.env });

async function hasActivePlus(uid) {
  if (!uid) return false;
  const user = await firestoreDb.collection('users').doc(uid).get();
  const billing = user.data()?.billing;
  return billing?.plan === 'pro' && billing?.status === 'active';
}

// ─── Qdrant Client ───────────────────────────────────────────
const QDRANT_URL = process.env.QDRANT_URL;
const ragEnabled = Boolean(QDRANT_URL);
const QDRANT_COLLECTION = 'kocamind_documents';
let qdrantClient;
try {
  if (ragEnabled) qdrantClient = new QdrantClient({ url: QDRANT_URL, checkCompatibility: false });
} catch (e) {
  console.warn('⚠️ Qdrant bağlantısı kurulamadı:', e.message);
}

// Hız sınırı yukarıda, gövde ayrıştırmadan önce uygulandı.

// ─── Health Check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Zeka Backend çalışıyor 🚀' });
});

// Uptime izleyicileri için bağımlılık kontrolü. Yalnızca evet/hayır döner;
// anahtar, adres veya hata ayrıntısı paylaşılmaz.
function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function collectHealth() {
  const [firestore, qdrant] = await Promise.all([
    withTimeout(firestoreDb.collection('health').doc('ping').get(), 3000).then(() => true, () => false),
    qdrantClient ? withTimeout(qdrantClient.getCollections(), 3000).then(() => true, () => false) : Promise.resolve(false),
  ]);
  const checks = {
    firestore,
    qdrant,
    openaiKey: Boolean(process.env.OPENAI_API_KEY),
    deepseekKey: Boolean(process.env.DEEPSEEK_API_KEY),
    geminiKey: Boolean(process.env.GEMINI_API_KEY),
  };
  const healthy = checks.firestore && Boolean(DEFAULT_MODEL);
  return { healthy, checks };
}

// Herkese açık sağlık kontrolü yalnızca genel durumu döner; bileşen ayrıntıları
// (hangi servis kapalı, hangi anahtar tanımlı) yöneticiye özel /admin/health'tedir.
app.get('/health', async (req, res) => {
  const { healthy } = await collectHealth();
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded' });
});

// Bütün e-postalar tek göndericiden; kullanıcıya uid ile bildirim gönderilebilir.
const mailer = require('./mailer').createMailer({ fetch });
async function notifyUser(kind, uid, data = {}) {
  try {
    const user = await firebaseAuth.getUser(uid);
    if (user.email) await mailer.send(kind, user.email, data);
  } catch (error) {
    console.error('Kullanıcı bildirimi gönderilemedi:', kind, error.message);
  }
}
require('./routes/auth').registerAuthRoutes(app, { fetch, firebaseAuth, registerPublicBillingRoutes, firestoreDb, FieldValue, notify: notifyUser });
// E-postadaki bağlantıların açtığı sayfa (doğrulama, yeni şifre).
require('./authAction').registerAuthActionRoutes(app, { fetch, mailer });
// Kimlik e-postaları (şifre sıfırlama, doğrulama): başkasının kutusuna mail yağdırılmasın diye sıkı sınır.
app.use('/auth/email', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_EMAIL_LIMIT || 5),
  message: { error: 'Çok fazla e-posta isteği gönderdin, biraz sonra tekrar dene.' },
  standardHeaders: true,
  legacyHeaders: false,
}));
require('./authEmails').registerAuthEmailRoutes(app, { firebaseAuth, fetch, firestoreDb });

const ASSISTANT_PROMPTS = {
    "tiger": "Sen KocaMind'in güçlü genel amaçlı asistanısın. Kullanıcının dilinde doğal ve doğrudan konuş. Basit soruları kısa; karmaşık soruları gerekli kanıt, açıklama ve uygulanabilir adımlarla eksiksiz yanıtla. Doğruluğu hoşa gitmekten ve gereksiz kısalıktan üstün tut. Güncel bilgi gerektiğinde sunulan web arama aracını kullan ve kaynakları belirt.",
    "deep_research": "Sen Derin Araştırma (Deep Research) asistanısın. Arama sonuçlarını analiz et ve detaylı bir rapor yaz."
};

// ─── Multi-Model Gateway ─────────────────────────────────────
// Tüm sağlayıcılar OpenAI-uyumlu /chat/completions endpoint'i sunar.
// Yeni sağlayıcı eklemek = tabloya 1 satır + Vercel'e API key eklemek.
const PROVIDERS = {
  groq: {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
  },
  openai: {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1/responses',
    nativeResponses: true,
  },
  gemini: {
    name: 'Google',
    envKey: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  },
  anthropic: {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1/chat/completions',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    defaultMaxTokens: 4096, // Anthropic max_tokens zorunlu kılar
  },
  xai: {
    name: 'xAI',
    envKey: 'XAI_API_KEY',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
  },
  deepseek: {
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    // Uçtan uca testlerde sahte model sunucusuna yönlendirilir (kocamind-web/e2e/fakeModel.mjs).
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1/chat/completions',
    // Varsayılan 1.0 yan ayrıntı uydurmayı artırıyordu; 0.3 ölçümde daha isabetli.
    defaultTemperature: 0.3,
  },
  // EVREN: SSB SAYZEK'in OpenAI uyumlu model servisi. Bütün sohbet modelleri araç çağırabiliyor.
  evren: {
    name: 'EVREN',
    envKey: 'EVREN_LLM_API_KEY',
    baseUrl: 'https://evren-llmapi.ssyz.org.tr/v1/chat/completions',
  },
};

// Model kataloğu — frontend bunu /models üzerinden çeker
const MODEL_CATALOG = [
  // Groq
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT-OSS 120B', badge: 'hizli' },
  { id: 'qwen/qwen3.8-27b', provider: 'groq', label: 'Qwen 3.8 27B', badge: 'hizli' },
  // OpenAI
  { id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna', badge: 'ucuz', isDefault: true },
  // Google
  { id: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash', badge: 'hizli' },
  { id: 'gemini-3.1-flash-lite', provider: 'gemini', label: 'Gemini 3.1 Flash Lite', badge: 'ucuz' },
  { id: 'gemini-4-hydrogen', provider: 'gemini', label: 'Gemini 4 Hydrogen', badge: 'guclu' },
  // Anthropic
  { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet 4.5', badge: 'guclu' },
  { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5', badge: 'hizli' },
  // xAI
  { id: 'grok-3', provider: 'xai', label: 'Grok 3', badge: 'guclu' },
  { id: 'grok-3-mini', provider: 'xai', label: 'Grok 3 Mini', badge: 'ucuz' },
  // DeepSeek — aktif
  { id: 'deepseek-chat', provider: 'deepseek', label: 'DeepSeek V3', badge: 'guclu' },
  { id: 'deepseek-reasoner', provider: 'deepseek', label: 'DeepSeek R1', badge: 'guclu' },
  // EVREN (anahtar varsa açılır)
  { id: 'deepseek-v4.1-flash', provider: 'evren', label: 'DeepSeek V4.1 Flash', badge: 'yeni' },
  { id: 'glm-5.3', provider: 'evren', label: 'GLM 5.3', badge: 'guclu' },
  { id: 'qwen3.8-flash-next', provider: 'evren', label: 'Qwen 3.8 Flash', badge: 'hizli' },
  { id: 'gemma-4-31b', provider: 'evren', label: 'Gemma 4 31B', badge: 'hizli' },
  // hidden: seçicide gösterilmez ve Otomatik seçmez (31.10.2026: EVREN'de ilk kelime 16-38 sn).
  // Önceden seçmiş kullanıcıların sohbeti bozulmasın diye /chat hâlâ kabul eder.
  { id: 'mimo-v2.6-pro', provider: 'evren', label: 'MiMo V2.6 Pro', badge: 'guclu', hidden: true },
];

// ─── Model Listesi (frontend seçiciyi bununla doldurur) ─────
const DISABLED_PROVIDERS = disabledProviders();
const ACTIVE_PROVIDERS = new Set(['openai', 'deepseek']);
// EVREN yalnızca anahtarı tanımlı ortamda açılır; canlıda Vercel'e EVREN_LLM_API_KEY eklenmeli.
if (process.env.EVREN_LLM_API_KEY) ACTIVE_PROVIDERS.add('evren');
if (process.env.GROQ_API_KEY) ACTIVE_PROVIDERS.add('groq');
// Bedava katman sadece test için, canlıya açma (bedava katmanda Google verileri eğitimde kullanabilir, limit düşük).
if (process.env.GEMINI_CHAT_ENABLED === 'true' && process.env.GEMINI_API_KEY) ACTIVE_PROVIDERS.add('gemini');
for (const id of DISABLED_PROVIDERS) ACTIVE_PROVIDERS.delete(id);

const isModelAvailable = model => ACTIVE_PROVIDERS.has(model.provider) && Boolean(process.env[PROVIDERS[model.provider]?.envKey]);
const visibleAvailableModels = MODEL_CATALOG.filter(model => !model.hidden && isModelAvailable(model));
const defaultModelPreferences = [
  model => model.isDefault,
  model => model.provider === 'groq' && model.id === 'openai/gpt-oss-120b',
  () => true,
];
const DEFAULT_MODEL = defaultModelPreferences.map(match => visibleAvailableModels.find(match)).find(Boolean) || null;

// Kendini geliştiren döngü (backend/learning/): geri bildirim → model skorları → otomatik seçim,
// kullanıcıya göre yanıt tarzı ve gece raporu.
const { createFeedbackStore } = require('./learning/feedbackStore');
const { createAutoRouter } = require('./learning/router');
const { createUserStyle } = require('./learning/userStyle');
const { createNightlyJob } = require('./learning/nightly');
const feedbackStore = createFeedbackStore({ firestoreDb });
const userStyle = createUserStyle({ firestoreDb });
const autoRouter = createAutoRouter({
  feedbackStore,
  catalog: MODEL_CATALOG,
  isAvailable: isModelAvailable,
  defaultModelId: DEFAULT_MODEL?.id,
});
const nightlyJob = createNightlyJob({ firestoreDb, userStyle });

// İstemciler medya düğmelerini göstermeden önce canlı Google anahtarının
// gerçekten gerekli modellere erişebildiğini kontrol edebilir. Anahtar dönmez.
let mediaCapabilitiesCache = null;
app.get('/media-capabilities', async (req, res) => {
  const now = Date.now();
  if (mediaCapabilitiesCache && now - mediaCapabilitiesCache.checkedAt < 10 * 60 * 1000) {
    return res.json(mediaCapabilitiesCache.value);
  }

  const value = { image: false, video: false };
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY },
      });
      if (response.ok) {
        const data = await response.json();
        const modelNames = new Set((data.models || []).map(model => model.name));
        value.image = modelNames.has('models/gemini-3.1-flash-lite-image');
        value.video = modelNames.has('models/veo-3.1-lite-generate-preview');
      }
    } catch (error) {
      console.warn('[media-capabilities]', error.message);
    }
  }

  mediaCapabilitiesCache = { checkedAt: now, value };
  res.set('Cache-Control', 'no-store');
  return res.json(value);
});

// Bağlı hesaplar (Google Takvim, Drive, Notion, GitHub). CONNECTOR_TOKEN_KEY yoksa
// tamamen kapalıdır. OAuth callback'i tarayıcı yönlendirmesi olduğu için girişten önce.
const { createConnectorManager } = require('./connectors/manager');
const connectorRoutes = require('./routes/connectors');
const connectorManager = createConnectorManager({ env: process.env, firestoreDb, hasActivePlus });
connectorRoutes.registerConnectorCallbackRoute(app, { manager: connectorManager, env: process.env });

const accountRoutes = require('./routes/account');
const accountDeps = { firestoreDb, qdrantClient, QDRANT_COLLECTION, firebaseAuth, storageBucket, mailer, ragEnabled };
// Silme süresi dolan hesapları temizleyen günlük iş (vercel.json > crons).
accountRoutes.registerAccountCronRoutes(app, accountDeps);
// Gece öğrenme işi: test seti, yanıt tarzı ve rapor (vercel.json > crons).
const learningRoutes = require('./routes/learning');
learningRoutes.registerLearningCronRoute(app, { nightlyJob });
const alerts = require('./alerts').createAlerts({ firestoreDb, metrics, fetch, mailer });
require('./alerts').registerAlertCronRoute(app, alerts);
const ideAuthRoutes = require('./routes/ideAuth');
ideAuthRoutes.registerIdeAuthPublicRoutes(app, { firestoreDb, firebaseAuth });

// Sağlık kontrolü dışındaki tüm servisler (model kataloğu dahil) kimlik doğrulaması ister.
app.use(requireAuth);
// Silinmeyi bekleyen hesap yalnızca geri alma/hemen silme uçlarını kullanabilir.
app.use(accountRoutes.blockPendingDeletion);

// Model kataloğu — hangi sağlayıcı anahtarlarının tanımlı olduğunu gösterdiği için oturum ister.
app.get('/models', (req, res) => {
  const models = MODEL_CATALOG.filter(m => !m.hidden && !DISABLED_PROVIDERS.has(m.provider)).map(m => {
    const p = PROVIDERS[m.provider];
    return {
      id: m.id,
      provider: m.provider,
      providerName: p.name,
      label: m.label,
      badge: m.badge,
      available: isModelAvailable(m),
    };
  });
  // Otomatik: en az iki kullanılabilir model varsa seçicide görünür; seçimi learning/router.js yapar.
  models.unshift({ id: 'auto', provider: 'auto', providerName: 'KocaMind', label: 'Otomatik', badge: 'akilli', available: autoRouter.enabled() });
  res.json({ models });
});

registerProtectedBillingRoutes(app, { firestoreDb, FieldValue, env: process.env, notify: notifyUser });

// Agent yalnızca gerçekten çalışabilecek araçları görür. Burada yalnızca
// evet/hayır bilgisi döner; anahtarların kendisi hiçbir zaman istemciye gitmez.
app.get('/capabilities', (req, res) => {
  // E-posta gönderme sunucunun ortak Gmail hesabını kullandığı için yalnızca
  // yöneticilere açıktır; Gmail okuma kullanıcının kendi OAuth bağlantısıyla yapılır.
  const admin = req.user?.admin === true;
  res.json({
    tools: {
      get_weather: true,
      convert_currency: true,
      search_wikipedia: true,
      calculate: true,
      run_code: true,
      generate_image: Boolean(process.env.GEMINI_API_KEY),
      generate_video: Boolean(process.env.GEMINI_API_KEY),
      save_memory: true,
      scrape_website: true,
      web_search: true,
      send_email: admin && Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
      read_emails: false,
    },
  });
});

// Native OpenAI Responses API tabanlı agent çekirdeği. Araç seçimi, şema
// doğrulama, risk/onay ve kayıt işlemleri tarayıcıda değil burada yapılır.
// Ortak araç kutusu: sohbet (bütün modeller), agent ve /search aynı araçları
// ve aynı arama önbelleğini kullanır. Yeni araç = agent/tools.js'e bir kayıt.
const webSearch = createWebSearch({ fetch });
// Skill'ler: backend/skills/<ad>/SKILL.md talimat paketleri. Yeni skill = yeni klasör.
const skillStore = createSkillStore();
const packStore = createPackStore({ firestoreDb });
const learner = createLearner({ firestoreDb, fetch, packStore, metrics });
const serverLearn = process.env.MEMORY_SERVER_LEARN === 'true';
const toolRegistry = createDefaultToolRegistry({ fetchImpl: fetch, env: process.env, webSearch, skillStore });
app.post('/agent/run', enforceDailyQuota('agent'));
app.use('/agent', createAgentRouter({ firestoreDb, fetchImpl: fetch, env: process.env, hasActivePlus, metrics, registry: toolRegistry, connectorManager, packStore }));

connectorRoutes.registerConnectorRoutes(app, { manager: connectorManager });

require('./routes/telemetry').registerTelemetryRoutes(app, { firestoreDb, FieldValue, quotasForUser });

accountRoutes.registerAccountRoutes(app, accountDeps);

require('./routes/skills').registerSkillRoutes(app, { skillStore, firestoreDb });
require('./routes/chat').registerChatRoutes(app, { enforceDailyQuota, hasActivePlus, DEFAULT_MODEL, PROVIDERS, MODEL_CATALOG, ACTIVE_PROVIDERS, ASSISTANT_PROMPTS, buildOpenAIResponsesPayload, fetch, pipeResponsesAsChatCompletions, toChatCompletion, metrics, toolRegistry, skillStore, connectorManager, firestoreDb, autoRouter, userStyle, packStore, learner, serverLearn, consumeDailyQuota });
require('./routes/ide').registerIdeRoutes(app, { enforceDailyQuota, PROVIDERS, MODEL_CATALOG, ACTIVE_PROVIDERS, fetch, metrics, toolRegistry });
ideAuthRoutes.registerIdeAuthPrivateRoutes(app, { firestoreDb, firebaseAuth });
learningRoutes.registerLearningRoutes(app, { feedbackStore, userStyle, requireAdmin, firestoreDb, enforceDailyQuota });

require('./routes/search').registerSearchRoutes(app, { fetch, enforceDailyQuota, webSearch });

require('./routes/documents').registerDocumentsRoutes(app, { fetch, qdrantClient, QDRANT_COLLECTION, enforceDailyQuota, uuidv4, ragEnabled });

require('./routes/code').registerCodeRoutes(app, { enforceDailyQuota, fetch });

require('./routes/media').registerMediaRoutes(app, { enforceDailyQuota, fetch, uuidv4, storageBucket, firestoreDb, FieldValue });

require('./routes/memory').registerMemoryRoutes(app, { firestoreDb, fetch, enforceDailyQuota, metrics, packStore, serverLearn, learner });

require('./routes/uploads').registerUploadsRoutes(app, { upload, FormData, fetch, enforceDailyQuota });

require('./routes/tools').registerToolsRoutes(app, { fetch });

app.get('/admin/health', requireAdmin, async (req, res) => {
  const { healthy, checks } = await collectHealth();
  res.set('Cache-Control', 'no-store');
  res.json({ status: healthy ? 'ok' : 'degraded', checks, time: new Date().toISOString() });
});

require('./routes/admin').registerAdminRoutes(app, { requireAdmin, firestoreDb, fetch, metrics });

// Gövde ayrıştırma hataları (bozuk JSON, çok büyük gövde) Express'in HTML sayfası yerine
// JSON döner. İç hata mesajı/stack sızdırılmaz; diğer hatalar varsayılan işleyiciye gider.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
    return res.status(413).json({ error: 'İstek gövdesi çok büyük.' });
  }
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400))) {
    return res.status(400).json({ error: 'Geçersiz istek gövdesi.' });
  }
  return next(err);
});

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Zeka Backend listening on port ${PORT}`);
    console.log(`📡 OpenAI key: ${process.env.OPENAI_API_KEY ? '✅ tanımlı' : '❌ eksik'}`);
    console.log(`📡 Gemini key: ${process.env.GEMINI_API_KEY ? '✅ tanımlı' : '❌ eksik'}`);
    console.log(`📡 Groq key: ${process.env.GROQ_API_KEY ? '✅ tanımlı' : '❌ eksik'}`);
    console.log(`📡 Qdrant: ${ragEnabled ? 'yapılandırıldı' : 'kapalı'}`);
  });
}

// Vercel gibi serverless ortamlar için uygulamayı dışa aktarıyoruz
module.exports = app;
