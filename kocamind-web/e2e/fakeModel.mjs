// Uçtan uca testler için sahte, OpenAI uyumlu model sunucusu (DeepSeek yerine).
// Akışlı istekte sabit bir cevabı SSE parçaları olarak, akışsızda JSON olarak döndürür.
// Hafıza çıkarma gibi JSON isteyen yardımcı çağrılara boş hafıza döner.
import http from 'node:http'
import process from 'node:process'

export const FAKE_REPLY = 'Merhaba, ben test modeliyim.'
// Mesajında "[düşün]" geçen istekte önce düşünce metni (reasoning_content) yavaşça akar.
export const FAKE_THOUGHT = 'Kullanıcı selam veriyor. Kısa ve sıcak bir cevap vereyim.'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = Number(process.env.FAKE_MODEL_PORT || 4010)

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* boş gövde */ }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      const chunk = delta => res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      const words = FAKE_REPLY.split(' ')
      const think = JSON.stringify(body.messages || '').includes('[düşün]')
      ;(async () => {
        if (think) {
          for (const word of FAKE_THOUGHT.split(' ')) {
            chunk({ reasoning_content: word + ' ' })
            await sleep(250)
          }
        }
        for (const [i, word] of words.entries()) {
          chunk({ content: (i === 0 ? '' : ' ') + word })
          if (think) await sleep(150)
        }
        res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: words.length, total_tokens: words.length + 1 } })}\n\n`)
        res.end('data: [DONE]\n\n')
      })()
      return
    }
    const content = body.response_format?.type === 'json_object' ? '{"memories":[],"forget":[]}' : FAKE_REPLY
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: 'fake', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }))
  })
})

server.listen(port, '127.0.0.1', () => console.log(`Sahte model ${port} portunda`))
