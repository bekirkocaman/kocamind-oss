function createAbortError(sentToServer = false) {
  const err = new Error(
    sentToServer
      ? 'İptal edildi; belge yine de eklenmiş olabilir.'
      : 'Yükleme iptal edildi.'
  )
  err.name = 'AbortError'
  err.sentToServer = sentToServer
  return err
}

export function applyDocumentAdded(documents, nextCursor, uploadedDoc) {
  const existed = documents.some(d => d.documentId === uploadedDoc.documentId)
  const nextDocs = [uploadedDoc, ...documents.filter(d => d.documentId !== uploadedDoc.documentId)]
  const adjustedCursor = nextCursor === null || nextCursor === undefined
    ? null
    : Math.max(0, nextCursor + (existed ? 0 : 1))
  return { documents: nextDocs, nextCursor: adjustedCursor }
}

export function applyDocumentDeleted(documents, nextCursor, documentId) {
  const existed = documents.some(d => d.documentId === documentId)
  const nextDocs = documents.filter(d => d.documentId !== documentId)
  const adjustedCursor = nextCursor === null || nextCursor === undefined
    ? null
    : Math.max(0, nextCursor - (existed ? 1 : 0))
  return { documents: nextDocs, nextCursor: adjustedCursor }
}

export async function uploadRagDocument({ file, token, baseUrl, onProgress, signal }) {
  if (signal?.aborted) {
    throw createAbortError()
  }

  let fileName = 'Adsız Dosya'
  let content = ''

  if (file && typeof file.text === 'function') {
    fileName = file.name || fileName
    content = await file.text()
  } else if (file && typeof file === 'object') {
    fileName = file.fileName || file.name || fileName
    content = typeof file.content === 'string' ? file.content : ''
  }

  if (signal?.aborted) {
    throw createAbortError()
  }

  const cleanBase = String(baseUrl || '').replace(/\/+$/, '')
  const url = `${cleanBase}/rag/upload`

  return new Promise((resolve, reject) => {
    const xhr = new globalThis.XMLHttpRequest()
    let settled = false
    let requestSent = false

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', handleAbort)
    }

    const finishResolve = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const finishReject = (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const handleAbort = () => {
      try {
        xhr.abort()
      } catch {
        // yoksay
      }
      finishReject(createAbortError(requestSent))
    }

    if (signal) {
      if (signal.aborted) {
        finishReject(createAbortError())
        return
      }
      signal.addEventListener('abort', handleAbort, { once: true })
    }

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event && event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.max(0, Math.round((event.loaded / event.total) * 100)))
          onProgress(percent)
        }
      }
    }

    xhr.onload = () => {
      let data
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {}
      } catch {
        data = {}
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        finishResolve(data)
      } else {
        const message = data?.error?.message || data?.error || `Sunucu hatası (${xhr.status})`
        finishReject(new Error(message))
      }
    }

    xhr.onerror = () => {
      finishReject(new Error('Ağ hatası nedeniyle doküman yüklenemedi.'))
    }

    xhr.onabort = () => {
      finishReject(createAbortError(requestSent))
    }

    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', 'application/json')
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    requestSent = true
    xhr.send(JSON.stringify({ fileName, content }))
  })
}
