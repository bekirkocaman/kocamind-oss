// ═══ KocaMind Merkezi API Yapılandırması ═══
import { auth } from './firebase'
import { uploadRagDocument } from './ragUpload'
// Tüm backend endpoint'leri buradan geçer — hardcoded URL YOK.

const BASE = (import.meta.env.VITE_BACKEND_URL || 'https://api.kocamind.com').replace(/\/+$/, '')

export const BACKEND_URL = BASE

export const API = {
  googleAuth: `${BASE}/auth/google`,
  chat: `${BASE}/chat`,
  models: `${BASE}/models`,
  search: `${BASE}/search`,
  generateImage: `${BASE}/generate-image`,
  generateVideo: `${BASE}/generate-video`,
  videoStatus: (jobId) => `${BASE}/generate-video/${encodeURIComponent(jobId)}`,
  mediaCapabilities: `${BASE}/media-capabilities`,
  audio: `${BASE}/audio`,
  upload: `${BASE}/upload`,
  ragUpload: `${BASE}/rag/upload`,
  ragQuery: `${BASE}/rag/query`,
  ragDocuments: (userId) => `${BASE}/rag/documents/${encodeURIComponent(userId)}`,
  ragDeleteDocument: (docId) => `${BASE}/rag/document/${encodeURIComponent(docId)}`,
  memoryList: (userId) => `${BASE}/memory/list/${encodeURIComponent(userId)}`,
  memorySave: `${BASE}/memory/save`,
  memoryDelete: `${BASE}/memory/delete`,
  memoryExtract: `${BASE}/memory/extract`,
  memorySummarize: `${BASE}/memory/summarize`,
  memoryImport: `${BASE}/memory/import`,
  memoryInsight: `${BASE}/memory/insight`,
  telemetryError: `${BASE}/telemetry/error`,
  telemetryEvent: `${BASE}/telemetry/event`,
  usage: `${BASE}/usage/me`,
  accountExport: `${BASE}/account/export`,
  account: `${BASE}/account`,
  accountDeletion: `${BASE}/account/deletion`,
  accountRestore: `${BASE}/account/restore`,
  accountDeleteNow: `${BASE}/account/now`,
  billingStatus: `${BASE}/billing/status`,
  billingCheckout: `${BASE}/billing/checkout`,
  billingCancel: `${BASE}/billing/cancel`,
  capabilities: `${BASE}/capabilities`,
  agentRun: `${BASE}/agent/run`,
  agentConfirm: (runId) => `${BASE}/agent/runs/${encodeURIComponent(runId)}/confirm`,
  agentTools: `${BASE}/agent/tools`,
  toolEmailRead: `${BASE}/tools/email/read`,
  connectors: `${BASE}/connectors`,
  connectorConnect: (id) => `${BASE}/connectors/${encodeURIComponent(id)}/connect`,
  connector: (id) => `${BASE}/connectors/${encodeURIComponent(id)}`,
  skills: `${BASE}/skills`,
  skill: (name) => `${BASE}/skills/${encodeURIComponent(name)}`,
  feedback: `${BASE}/feedback`,
  feedbackBug: `${BASE}/feedback/bug`,
  learningStyle: `${BASE}/learning/style`,
}

export async function authHeaders(headers = {}) {
  const user = auth?.currentUser
  if (!user) throw new Error('Bu işlem için oturum açman gerekiyor.')
  const token = await user.getIdToken()
  return { ...headers, Authorization: `Bearer ${token}` }
}

export async function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: await authHeaders(options.headers || {}),
  })
}

// ─── Yardımcılar ───

export async function postJSON(url, body, signal) {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || `Sunucu hatası (${res.status})`)
    err.status = res.status
    if (data.code) err.code = data.code
    throw err
  }
  return data
}

// Ses kaydını yazıya çevirir (Whisper)
export async function transcribeAudio(audioBlob) {
  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  const res = await authFetch(API.audio, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Ses tanıma başarısız')
  return data.transcription || ''
}

// Dosya yükler: görsel → AI açıklaması, metin/PDF → içerik çıkarımı
export async function uploadFileForAnalysis(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await authFetch(API.upload, { method: 'POST', body: formData })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Dosya işlenemedi')
  return data // { content, type, filename }
}

// ─── RAG ───

export async function ragUploadDocument(userId, fileName, content, { onProgress, signal } = {}) {
  const user = auth?.currentUser
  if (!user) throw new Error('Bu işlem için oturum açman gerekiyor.')
  const token = await user.getIdToken()
  return uploadRagDocument({
    file: { fileName, content },
    token,
    baseUrl: BASE,
    onProgress,
    signal,
  })
}

export async function ragQuery(userId, query, topK = 4) {
  return postJSON(API.ragQuery, { userId, query, topK })
}

export async function ragListDocuments(userId, { limit, cursor } = {}) {
  const params = new URLSearchParams()
  if (limit !== undefined && limit !== null) params.set('limit', String(limit))
  if (cursor !== undefined && cursor !== null) params.set('cursor', String(cursor))
  const qs = params.toString()
  const url = qs ? `${API.ragDocuments(userId)}?${qs}` : API.ragDocuments(userId)
  const res = await authFetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Dokümanlar alınamadı')
  const documents = Array.isArray(data.documents) ? data.documents : []
  return {
    documents,
    nextCursor: data.nextCursor ?? null,
    total: typeof data.total === 'number' ? data.total : documents.length,
    truncated: Boolean(data.truncated),
  }
}

export async function ragDeleteDocument(documentId) {
  const res = await authFetch(API.ragDeleteDocument(documentId), { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Doküman silinemedi')
  return data
}

// ─── Hafıza ───

export async function memoryList(userId) {
  const res = await authFetch(API.memoryList(userId))
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Hafıza alınamadı')
  return data.memories || []
}

export async function memorySave(userId, key, value, category) {
  return postJSON(API.memorySave, { userId, key, value, category })
}

export async function memoryImport(text) {
  return postJSON(API.memoryImport, { text })
}

export async function memoryInsight(refresh = false) {
  return postJSON(API.memoryInsight, refresh ? { refresh: true } : {})
}

export async function memoryExtract(message) {
  return postJSON(API.memoryExtract, { message })
}

export async function memorySummarize(previousSummary, messages, signal) {
  const data = await postJSON(API.memorySummarize, { previous_summary: previousSummary || undefined, messages }, signal)
  return data.summary || ''
}

export async function memoryDelete(userId, key) {
  const res = await authFetch(API.memoryDelete, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(key ? { userId, key } : { userId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Hafıza silinemedi')
  return data
}

// ─── Geri bildirim (kendini geliştiren döngü) ───

export async function sendFeedback(feedback) {
  return postJSON(API.feedback, feedback)
}

export async function sendBugReport({ text, chatId, messageId, context }) {
  return postJSON(API.feedbackBug, {
    text,
    ...(chatId ? { chatId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(context ? { context } : {}),
  })
}

export async function getLearningStyle() {
  const res = await authFetch(API.learningStyle)
  if (!res.ok) throw new Error('Yanıt tarzı ayarı alınamadı.')
  return res.json()
}

export async function setLearningStyleEnabled(enabled) {
  return postJSON(API.learningStyle, { enabled })
}
