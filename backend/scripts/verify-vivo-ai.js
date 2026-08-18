#!/usr/bin/env node
'use strict'

const baseUrl = String(process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const verifyPhone = String(process.env.VERIFY_PHONE || '').trim()
const verifyPassword = String(process.env.VERIFY_PASSWORD || '')

const request = async (pathname, { token, method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || Number(payload?.code || 0) !== 0) {
    const detail = payload?.data?.reason ? `:${payload.data.reason}` : ''
    throw new Error(`${method} ${pathname} failed:${response.status}:${payload?.message || 'invalid_response'}${detail}`)
  }
  return payload.data
}

const main = async () => {
  if (!verifyPhone || !verifyPassword) throw new Error('VERIFY_PHONE and VERIFY_PASSWORD are required')
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { phone: verifyPhone, password: verifyPassword },
  })
  const token = login?.token
  if (!token) throw new Error('login_token_missing')

  const diagnosis = await request('/api/ai/diagnose', {
    token,
    method: 'POST',
    body: { content: '苹果叶片边缘发黄，但叶脉仍较绿，请给出简短排查步骤。' },
  })
  if (!String(diagnosis?.provider || '').startsWith('vivo-xuanji:')) {
    throw new Error(`unexpected_ai_provider:${diagnosis?.provider || 'empty'}`)
  }
  if (String(diagnosis?.reply || '').trim().length < 20) throw new Error('ai_reply_too_short')

  const vision = await request('/api/ai/diagnose', {
    token,
    method: 'POST',
    body: {
      content: '请识别图片中的作物场景，并给出一句观察建议。',
      image: new URL('/static/images/ai-consult/leaf-disease-closeup.jpg', `${baseUrl}/`).toString(),
    },
  })
  if (!String(vision?.provider || '').startsWith('vivo-xuanji:')) {
    throw new Error(`unexpected_vision_provider:${vision?.provider || 'empty'}`)
  }

  const speechText = '苹果行情预测服务连接正常'
  const tts = await request('/api/speech/tts', {
    token,
    method: 'POST',
    body: { text: speechText },
  })
  const audioResponse = await fetch(tts.audioUrl, { signal: AbortSignal.timeout(30_000) })
  if (!audioResponse.ok) throw new Error(`tts_audio_download_failed:${audioResponse.status}`)
  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer())
  if (audioBuffer.length < 1000 || audioBuffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`tts_audio_invalid:${audioBuffer.length}`)
  }

  const asr = await request('/api/speech/asr', {
    token,
    method: 'POST',
    body: { audioBase64: audioBuffer.toString('base64'), format: 'wav' },
  })
  if (!String(asr?.text || '').trim()) throw new Error('asr_text_empty')

  process.stdout.write(`${JSON.stringify({
    textModel: {
      provider: diagnosis.provider,
      replyLength: String(diagnosis.reply).length,
      replyPreview: String(diagnosis.reply).slice(0, 80),
    },
    visionModel: {
      provider: vision.provider,
      replyLength: String(vision.reply || '').length,
      replyPreview: String(vision.reply || '').slice(0, 80),
    },
    tts: { mimeType: tts.mimeType, audioBytes: audioBuffer.length },
    asr: { text: asr.text },
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`[verify-vivo-ai] ${error?.stack || error}\n`)
  process.exitCode = 1
})
