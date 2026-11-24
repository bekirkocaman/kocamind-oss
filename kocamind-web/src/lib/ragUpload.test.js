import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { uploadRagDocument, applyDocumentAdded, applyDocumentDeleted } from './ragUpload'

class FakeXMLHttpRequest {
  static instances = []

  constructor() {
    this.method = null
    this.url = null
    this.headers = {}
    this.body = null
    this.status = 0
    this.responseText = ''
    this.aborted = false
    this.upload = { onprogress: null }
    this.onload = null
    this.onerror = null
    this.onabort = null
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method, url) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key, value) {
    this.headers[key] = value
  }

  send(body) {
    this.body = body
  }

  abort() {
    this.aborted = true
    if (typeof this.onabort === 'function') this.onabort()
  }

  emitProgress(loaded, total, lengthComputable = true) {
    if (typeof this.upload.onprogress === 'function') {
      this.upload.onprogress({ loaded, total, lengthComputable })
    }
  }

  emitLoad(status, payload) {
    this.status = status
    this.responseText = typeof payload === 'string' ? payload : JSON.stringify(payload)
    if (typeof this.onload === 'function') this.onload()
  }
}

describe('uploadRagDocument', () => {
  const originalXHR = globalThis.XMLHttpRequest

  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    globalThis.XMLHttpRequest = FakeXMLHttpRequest
  })

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR
  })

  it('ilerleme olaylarını bildirir ve başarılı yanıtı döner', async () => {
    const progressValues = []
    const file = {
      name: 'notlar.txt',
      text: async () => 'Örnek doküman içeriği',
    }

    const promise = uploadRagDocument({
      file,
      token: 'tok-123',
      baseUrl: 'https://api.kocamind.com/',
      onProgress: (p) => progressValues.push(p),
    })

    // file.text() async olduğu için microtask bekle
    await Promise.resolve()

    const xhr = FakeXMLHttpRequest.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('https://api.kocamind.com/rag/upload')
    expect(xhr.headers.Authorization).toBe('Bearer tok-123')
    expect(xhr.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(xhr.body)).toEqual({
      fileName: 'notlar.txt',
      content: 'Örnek doküman içeriği',
    })

    xhr.emitProgress(25, 100)
    xhr.emitProgress(100, 100)
    xhr.emitLoad(200, {
      success: true,
      documentId: 'doc-1',
      fileName: 'notlar.txt',
      chunksCount: 2,
    })

    const result = await promise
    expect(progressValues).toEqual([25, 100])
    expect(result).toEqual({
      success: true,
      documentId: 'doc-1',
      fileName: 'notlar.txt',
      chunksCount: 2,
    })
  })

  it('sunucu hata metnini Error olarak fırlatır', async () => {
    const promise = uploadRagDocument({
      file: { fileName: 'bos.txt', content: 'kısa' },
      token: 'tok-123',
      baseUrl: 'https://api.kocamind.com',
    })

    await Promise.resolve()
    const xhr = FakeXMLHttpRequest.instances[0]
    xhr.emitLoad(422, { error: 'Dokümanda indekslenecek kadar metin bulunamadı.' })

    await expect(promise).rejects.toThrow('Dokümanda indekslenecek kadar metin bulunamadı.')
  })

  it('AbortSignal gönderim sonrasında tetiklendiğinde sentToServer: true ile AbortError döner', async () => {
    const controller = new AbortController()
    const promise = uploadRagDocument({
      file: { fileName: 'buyuk.txt', content: 'içerik' },
      token: 'tok-123',
      baseUrl: 'https://api.kocamind.com',
      signal: controller.signal,
    })

    await Promise.resolve()
    const xhr = FakeXMLHttpRequest.instances[0]
    controller.abort()

    expect(xhr.aborted).toBe(true)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError', sentToServer: true })
  })

  it('AbortSignal istek gönderilmeden önce iptal edildiyse sentToServer: false döner', async () => {
    const controller = new AbortController()
    controller.abort()
    const promise = uploadRagDocument({
      file: { fileName: 'buyuk.txt', content: 'içerik' },
      token: 'tok-123',
      baseUrl: 'https://api.kocamind.com',
      signal: controller.signal,
    })

    expect(FakeXMLHttpRequest.instances.length).toBe(0)
    await expect(promise).rejects.toMatchObject({ name: 'AbortError', sentToServer: false })
  })
})

describe('belge sayfalama cursor yardımcıları', () => {
  const sample = [
    { documentId: 'd1', fileName: 'a.txt' },
    { documentId: 'd2', fileName: 'b.txt' },
  ]

  it('yeni belge eklendiğinde nextCursor 1 artar, mevcut belge güncellenince değişmez', () => {
    const added = applyDocumentAdded(sample, 20, { documentId: 'd3', fileName: 'c.txt' })
    expect(added.documents.map(d => d.documentId)).toEqual(['d3', 'd1', 'd2'])
    expect(added.nextCursor).toBe(21)

    const updated = applyDocumentAdded(sample, 20, { documentId: 'd2', fileName: 'b-yeni.txt' })
    expect(updated.documents.map(d => d.documentId)).toEqual(['d2', 'd1'])
    expect(updated.nextCursor).toBe(20)

    const noMore = applyDocumentAdded(sample, null, { documentId: 'd3', fileName: 'c.txt' })
    expect(noMore.nextCursor).toBeNull()
  })

  it('listedeki belge silindiğinde nextCursor 1 azalır, listede yoksa veya null ise bozulmaz', () => {
    const deleted = applyDocumentDeleted(sample, 20, 'd1')
    expect(deleted.documents.map(d => d.documentId)).toEqual(['d2'])
    expect(deleted.nextCursor).toBe(19)

    const missing = applyDocumentDeleted(sample, 20, 'd-yok')
    expect(missing.documents.map(d => d.documentId)).toEqual(['d1', 'd2'])
    expect(missing.nextCursor).toBe(20)

    const atZero = applyDocumentDeleted(sample, 0, 'd1')
    expect(atZero.nextCursor).toBe(0)

    const noMore = applyDocumentDeleted(sample, null, 'd1')
    expect(noMore.nextCursor).toBeNull()
  })
})
