import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }))
vi.mock('./api', () => ({
  API: {
    agentRun: 'https://api.test/agent/run',
    agentConfirm: runId => `https://api.test/agent/runs/${runId}/confirm`,
  },
  authFetch,
}))

import { runNativeAgent } from './nativeAgentRunner'

function sseResponse(events) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')))
      controller.close()
    },
  })
  return { ok: true, body }
}

describe('native agent istemcisi', () => {
  beforeEach(() => authFetch.mockReset())

  it('metin parçalarını birleştirir ve araç adımlarını arayüze iletir', async () => {
    authFetch.mockResolvedValueOnce(sseResponse([
      { type: 'tool_completed', name: 'calculate', arguments: { expression: '2+2' }, output: { ok: true, result: { value: 4 } } },
      { type: 'text_delta', delta: 'Sonuç ' },
      { type: 'text_delta', delta: '4.' },
      { type: 'completed', text: 'Sonuç 4.', sources: [] },
    ]))
    const steps = []
    const result = await runNativeAgent({
      history: [{ role: 'user', content: '2+2' }], message: '2+2', instructions: 'test',
      onStepsChange: value => steps.push(value),
      onApprovalRequired: vi.fn(),
    })
    expect(result.finalText).toBe('Sonuç 4.')
    expect(result.steps[0].name).toBe('calculate')
    expect(steps).toHaveLength(1)
  })

  it('riskli işlemde kullanıcı kararını gönderip aynı çalışmaya devam eder', async () => {
    authFetch
      .mockResolvedValueOnce(sseResponse([{ type: 'approval_required', runId: 'r1', confirmationId: '11111111-1111-4111-8111-111111111111', actions: [] }]))
      .mockResolvedValueOnce(sseResponse([{ type: 'completed', text: 'Tamamlandı.', sources: [] }]))
    const result = await runNativeAgent({
      history: [{ role: 'user', content: 'gönder' }], message: 'gönder', instructions: 'test',
      onApprovalRequired: vi.fn().mockResolvedValue(true),
    })
    expect(result.finalText).toBe('Tamamlandı.')
    expect(authFetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(authFetch.mock.calls[1][1].body).approved).toBe(true)
  })

  it('sunucuya yalnızca izin verilen geçmiş alanlarını ve sınırlandırılmış araç listesini gönderir', async () => {
    authFetch.mockResolvedValueOnce(sseResponse([{ type: 'completed', text: 'Selam.', sources: [] }]))
    await runNativeAgent({
      history: [
        { role: 'user', content: 'naber', id: 'fazladan', timestamp: 123 },
        { role: 'ai', content: 'iyi', generatedImage: 'data:image/png;base64,x' },
        { role: 'user', content: 'sen?', mediaJobId: 'fazladan' },
      ],
      message: 'sen?',
      instructions: 'x'.repeat(31000),
      enabledTools: [...Array.from({ length: 35 }, (_, index) => `tool_${index}`), 'tool_0'],
      onApprovalRequired: vi.fn(),
    })
    const body = JSON.parse(authFetch.mock.calls[0][1].body)
    expect(body.history).toEqual([{ role: 'user', content: 'naber' }, { role: 'ai', content: 'iyi' }])
    expect(body.instructions).toHaveLength(30000)
    expect(body.enabledTools).toHaveLength(30)
  })

  const run = () => runNativeAgent({ history: [{ role: 'user', content: 'https://a.com bak' }], message: 'https://a.com bak', instructions: 'x', onApprovalRequired: vi.fn() })

  it('sağlayıcı hatasında (401/402/403/503) hiçbir şey çalışmadan düşen isteği kullanılamaz diye işaretler', async () => {
    for (const status of [401, 402, 403, 503]) {
      authFetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ error: 'OpenAI şu an kullanılamıyor.' }) })
      await expect(run()).rejects.toMatchObject({ agentUnavailable: true, message: 'OpenAI şu an kullanılamıyor.' })
    }
  })

  it('akış başlamadan gelen error olayı da kullanılamaz sayılır', async () => {
    authFetch.mockResolvedValueOnce(sseResponse([{ type: 'status', message: 'başladı' }, { type: 'error', error: 'Agent başlatılamadı.' }]))
    await expect(run()).rejects.toMatchObject({ agentUnavailable: true })
  })

  it('araç çalıştıktan ya da metin aktıktan sonra düşen istek sohbete devredilmez', async () => {
    authFetch.mockResolvedValueOnce(sseResponse([
      { type: 'tool_completed', name: 'web_fetch', arguments: {}, output: { ok: true, result: {} } },
      { type: 'error', error: 'koptu' },
    ]))
    await expect(run()).rejects.toMatchObject({ agentUnavailable: false })
    authFetch.mockResolvedValueOnce(sseResponse([{ type: 'text_delta', delta: 'yarım' }, { type: 'error', error: 'koptu' }]))
    await expect(run()).rejects.toMatchObject({ agentUnavailable: false })
  })

  it('kullanıcı iptali devredilmez', async () => {
    authFetch.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(run()).rejects.toMatchObject({ agentUnavailable: false })
  })
})
