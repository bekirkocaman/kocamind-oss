import { describe, expect, it, vi, beforeEach } from 'vitest'

const authFetchMock = vi.fn()
const memoryExtractMock = vi.fn(() => Promise.resolve({ saved: [], forgotten: [] }))

vi.mock('./api', () => ({
  API: {
    search: 'https://api.kocamind.com/search',
    chat: 'https://api.kocamind.com/chat',
    generateImage: 'https://api.kocamind.com/generate-image',
    generateVideo: 'https://api.kocamind.com/generate-video',
    videoStatus: (id) => `https://api.kocamind.com/generate-video/${id}`,
  },
  authFetch: (...args) => authFetchMock(...args),
  postJSON: vi.fn(),
  ragQuery: vi.fn(),
  memoryExtract: (...args) => memoryExtractMock(...args),
  memorySummarize: vi.fn(),
  memoryDelete: vi.fn(),
}))

vi.mock('./chatStream', () => ({
  waitWithSignal: vi.fn(() => Promise.resolve()),
  createSmoothTextStream: (onText) => ({
    push: (text) => onText(text),
    finish: (text) => {
      onText(text)
      return Promise.resolve()
    },
  }),
}))

import { createChatSubmission } from './chatSubmission'

function createSseStream(chunks) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    getReader: () => ({
      read: async () => {
        if (index >= chunks.length) return { done: true, value: undefined }
        const value = encoder.encode(chunks[index])
        index += 1
        return { done: false, value }
      },
    }),
  }
}

describe('createChatSubmission web search flow', () => {
  beforeEach(() => {
    authFetchMock.mockReset()
    memoryExtractMock.mockClear()
  })

  it('calls /search then /chat with webSearchContext in custom_prompt instead of short-circuiting with snippet', async () => {
    const irrelevantSnippet = '1 (one, unit, unity) is a number, numeral, and glyph.'
    const modelReply = '1 ABD doları bugün yaklaşık 34,50 Türk lirasıdır.'

    authFetchMock.mockImplementation(async (url) => {
      if (url === 'https://api.kocamind.com/search') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            aiSummary: irrelevantSnippet,
            items: [
              {
                title: 'Döviz Kuru',
                snippet: irrelevantSnippet,
                link: 'https://example.com/kur',
              },
            ],
          }),
        }
      }
      if (url === 'https://api.kocamind.com/chat') {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'X-KocaMind-Provider': 'anthropic',
            'X-KocaMind-Model': 'claude-sonnet-4-6',
          }),
          body: createSseStream([
            `data: ${JSON.stringify({ choices: [{ delta: { content: modelReply } }] })}\n\n`,
            'data: [DONE]\n\n',
          ]),
        }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    let messagesState = []
    let persistedMessages = null
    const setMessages = vi.fn((updater) => {
      messagesState = typeof updater === 'function' ? updater(messagesState) : updater
    })
    const persistCurrentChat = vi.fn((msgs) => {
      persistedMessages = msgs
    })

    const userText = '1 dolar bugün kaç Türk lirası?'
    const initialHistory = [{ role: 'user', content: userText }]
    messagesState = initialHistory

    const { sendMessage } = createChatSubmission({
      setIsLoading: vi.fn(),
      setIsStreaming: vi.fn(),
      abortControllerRef: { current: null },
      setAgentStatus: vi.fn(),
      isDeepResearchMode: false,
      hasPlusAccess: false,
      setMessages,
      persistCurrentChat,
      getCurrentUid: () => 'user-1',
      gmailConnection: null,
      setSettingsInitialTab: vi.fn(),
      setIsSettingsOpen: vi.fn(),
      currentUser: { uid: 'user-1' },
      setGmailConnection: vi.fn(),
      assistantType: 'default',
      customAssistants: [],
      setIsDeepResearchMode: vi.fn(),
      useRag: false,
      selectedModel: { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet' },
      modelSafePlugins: [],
      userMemories: [],
      approvalWaitersRef: { current: new Map() },
      refreshMemories: vi.fn(),
      showToast: vi.fn(),
      onQuota: vi.fn(),
    })

    await sendMessage(userText, initialHistory)

    expect(authFetchMock).toHaveBeenCalledTimes(2)
    expect(authFetchMock.mock.calls[0][0]).toBe('https://api.kocamind.com/search')
    expect(authFetchMock.mock.calls[1][0]).toBe('https://api.kocamind.com/chat')

    const chatRequestBody = JSON.parse(authFetchMock.mock.calls[1][1].body)
    expect(chatRequestBody.web_search).toBe(true)
    expect(chatRequestBody.custom_prompt).toContain('TAMAMLANMIŞ WEB ARAMASI:')
    expect(chatRequestBody.custom_prompt).toContain('Döviz Kuru')
    expect(chatRequestBody.custom_prompt).toContain('https://example.com/kur')
    expect(chatRequestBody.custom_prompt).toContain('WEB SONUCU İÇİN KESİN CEVAP KURALLARI:')

    expect(persistedMessages).toHaveLength(2)
    const aiMessage = persistedMessages[1]
    expect(aiMessage.role).toBe('ai')
    expect(aiMessage.content).toContain(modelReply)
    expect(aiMessage.content).not.toContain(irrelevantSnippet)
    expect(aiMessage.content).toContain('https://example.com/kur')
  })

  it('forwards failed search explanation in custom_prompt to /chat when /search fails', async () => {
    const modelFallbackReply = 'Doğrulanabilir güncel bir sonuç alınamadı.'

    authFetchMock.mockImplementation(async (url) => {
      if (url === 'https://api.kocamind.com/search') {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'service unavailable' }),
        }
      }
      if (url === 'https://api.kocamind.com/chat') {
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          body: createSseStream([
            `data: ${JSON.stringify({ choices: [{ delta: { content: modelFallbackReply } }] })}\n\n`,
            'data: [DONE]\n\n',
          ]),
        }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    let persistedMessages = null
    const userText = 'Bugün hava nasıl?'
    const initialHistory = [{ role: 'user', content: userText }]

    const { sendMessage } = createChatSubmission({
      setIsLoading: vi.fn(),
      setIsStreaming: vi.fn(),
      abortControllerRef: { current: null },
      setAgentStatus: vi.fn(),
      isDeepResearchMode: false,
      hasPlusAccess: false,
      setMessages: vi.fn(),
      persistCurrentChat: (msgs) => { persistedMessages = msgs },
      getCurrentUid: () => 'user-1',
      gmailConnection: null,
      setSettingsInitialTab: vi.fn(),
      setIsSettingsOpen: vi.fn(),
      currentUser: { uid: 'user-1' },
      setGmailConnection: vi.fn(),
      assistantType: 'default',
      customAssistants: [],
      setIsDeepResearchMode: vi.fn(),
      useRag: false,
      selectedModel: { id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet' },
      modelSafePlugins: [],
      userMemories: [],
      approvalWaitersRef: { current: new Map() },
      refreshMemories: vi.fn(),
      showToast: vi.fn(),
      onQuota: vi.fn(),
    })

    await sendMessage(userText, initialHistory)

    expect(authFetchMock).toHaveBeenCalledTimes(2)
    const chatRequestBody = JSON.parse(authFetchMock.mock.calls[1][1].body)
    expect(chatRequestBody.custom_prompt).toContain('web araması denendi ancak doğrulanabilir sonuç alınamadı')
    expect(persistedMessages[1].content).toBe(modelFallbackReply)
  })
})
