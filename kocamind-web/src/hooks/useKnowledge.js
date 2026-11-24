import { useCallback, useRef, useState } from 'react'
import { memoryList, memoryDelete, memoryImport, ragListDocuments, ragUploadDocument, ragDeleteDocument } from '../lib/api'
import { applyDocumentAdded, applyDocumentDeleted } from '../lib/ragUpload'

// Hafızanın cihazdaki kopyası (Android MemoryRepository): açılışta ve çevrimdışıyken buradan gelir.
const memoryCacheKey = uid => `kocamind_memories_${uid}`

export function loadCachedMemories(uid) {
  try {
    const list = JSON.parse(localStorage.getItem(memoryCacheKey(uid)))
    return Array.isArray(list) ? list : null
  } catch { return null }
}

function saveCachedMemories(uid, list) {
  try { localStorage.setItem(memoryCacheKey(uid), JSON.stringify(list)) } catch { /* depolama dolu */ }
}

export function useKnowledge({ currentUserRef, showToast }) {
  const [userMemories, setUserMemories] = useState([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const [memoriesFailed, setMemoriesFailed] = useState(false)
  const [docState, setDocState] = useState({ items: [], nextCursor: null, truncated: false })
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsLoadingMore, setDocumentsLoadingMore] = useState(false)
  const [documentsError, setDocumentsError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(null)
  const uploadAbortRef = useRef(null)
  const { items: documents, nextCursor: documentsNextCursor, truncated: documentsTruncated } = docState

  const refreshMemories = useCallback(async (uid) => {
    const userId = uid || currentUserRef.current?.uid
    if (!userId) return
    const cached = loadCachedMemories(userId)
    if (cached) setUserMemories(cached)
    setMemoriesLoading(!cached)
    setMemoriesFailed(false)
    try {
      const list = await memoryList(userId)
      if (currentUserRef.current?.uid !== userId) return
      setUserMemories(list)
      saveCachedMemories(userId, list)
    } catch {
      if (!cached) setMemoriesFailed(true)
    } finally { setMemoriesLoading(false) }
  }, [currentUserRef])

  const refreshDocuments = useCallback(async (uid) => {
    const userId = uid || currentUserRef.current?.uid
    if (!userId) return
    setDocumentsLoading(true)
    setDocumentsError(null)
    try {
      const result = await ragListDocuments(userId, { cursor: 0 })
      if (currentUserRef.current?.uid !== userId) return
      setDocState({
        items: result.documents,
        nextCursor: result.nextCursor,
        truncated: Boolean(result.truncated),
      })
    } catch (e) {
      if (currentUserRef.current?.uid !== userId) return
      setDocumentsError(e?.message || 'Dokümanlar alınamadı')
    } finally {
      setDocumentsLoading(false)
    }
  }, [currentUserRef])

  const loadMoreDocuments = useCallback(async () => {
    const userId = currentUserRef.current?.uid
    if (!userId || documentsNextCursor == null || documentsLoadingMore) return
    setDocumentsLoadingMore(true)
    setDocumentsError(null)
    try {
      const result = await ragListDocuments(userId, { cursor: documentsNextCursor })
      if (currentUserRef.current?.uid !== userId) return
      setDocState(prev => {
        const seen = new Set(prev.items.map(d => d.documentId))
        const appended = result.documents.filter(d => !seen.has(d.documentId))
        return {
          items: [...prev.items, ...appended],
          nextCursor: result.nextCursor,
          truncated: prev.truncated || Boolean(result.truncated),
        }
      })
    } catch (e) {
      if (currentUserRef.current?.uid !== userId) return
      setDocumentsError(e?.message || 'Daha fazla doküman alınamadı')
    } finally {
      setDocumentsLoadingMore(false)
    }
  }, [currentUserRef, documentsNextCursor, documentsLoadingMore])

  const resetKnowledge = useCallback(() => {
    uploadAbortRef.current?.abort()
    uploadAbortRef.current = null
    setUserMemories([])
    setDocState({ items: [], nextCursor: null, truncated: false })
    setDocumentsError(null)
    setDocumentsLoadingMore(false)
    setUploadProgress(null)
  }, [])

  const handleDeleteMemory = async (key) => {
    const user = currentUserRef.current
    if (!user) return
    try {
      await memoryDelete(user.uid, key)
      setUserMemories(prev => {
        const next = prev.filter(m => m.key !== key)
        saveCachedMemories(user.uid, next)
        return next
      })
      showToast('Anı silindi', 'info')
    } catch (e) { showToast('Anı silinemedi: ' + e.message, 'error') }
  }

  const handleClearMemories = async () => {
    const user = currentUserRef.current
    if (!user) return
    try {
      await memoryDelete(user.uid)
      setUserMemories([])
      saveCachedMemories(user.uid, [])
      showToast('Tüm hafıza temizlendi', 'success')
    } catch (e) { showToast('Hafıza temizlenemedi: ' + e.message, 'error') }
  }

  const handleCancelUploadDocument = useCallback(() => {
    uploadAbortRef.current?.abort()
  }, [])

  const handleUploadDocument = async (fileName, content) => {
    const user = currentUserRef.current
    if (!user) return
    uploadAbortRef.current?.abort()
    const controller = new AbortController()
    uploadAbortRef.current = controller
    setDocumentsError(null)
    setUploadProgress({ fileName, percent: 0 })
    try {
      const data = await ragUploadDocument(user.uid, fileName, content, {
        onProgress: (percent) => setUploadProgress({ fileName, percent }),
        signal: controller.signal,
      })
      if (data?.documentId) {
        const uploadedDoc = {
          documentId: data.documentId,
          fileName: data.fileName || fileName,
          chunksCount: data.chunksCount ?? 0,
          uploadedAt: data.uploadedAt || new Date().toISOString(),
        }
        setDocState(prev => {
          const updated = applyDocumentAdded(prev.items, prev.nextCursor, uploadedDoc)
          return { ...prev, items: updated.documents, nextCursor: updated.nextCursor }
        })
      } else {
        await refreshDocuments()
      }
      showToast(`"${fileName}" indekslendi. Artık bu dokümanı sorabilirsin!`, 'success')
    } catch (e) {
      if (e?.name === 'AbortError') {
        if (e.sentToServer) {
          showToast('İptal edildi; belge yine de eklenmiş olabilir, liste yenileniyor', 'info')
          refreshDocuments()
        } else {
          showToast('Doküman yükleme iptal edildi.', 'info')
        }
      } else {
        showToast('Doküman yüklenemedi: ' + e.message, 'error')
      }
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null
        setUploadProgress(null)
      }
    }
  }

  const handleImportMemories = async (text) => {
    const result = await memoryImport(text)
    await refreshMemories()
    return result
  }

  const handleDeleteDocument = async (documentId) => {
    try {
      await ragDeleteDocument(documentId)
      setDocState(prev => {
        const updated = applyDocumentDeleted(prev.items, prev.nextCursor, documentId)
        return { ...prev, items: updated.documents, nextCursor: updated.nextCursor }
      })
      showToast('Doküman silindi', 'info')
    } catch (e) { showToast('Doküman silinemedi: ' + e.message, 'error') }
  }

  return {
    userMemories,
    memoriesLoading,
    memoriesFailed,
    documents,
    documentsLoading,
    documentsLoadingMore,
    documentsError,
    documentsNextCursor,
    documentsTruncated,
    uploadProgress,
    refreshMemories,
    refreshDocuments,
    loadMoreDocuments,
    resetKnowledge,
    handleDeleteMemory,
    handleClearMemories,
    handleImportMemories,
    handleUploadDocument,
    handleCancelUploadDocument,
    handleDeleteDocument,
  }
}
