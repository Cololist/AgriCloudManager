'use strict'

const { signRequest, generateRequestId } = require('../backend/lib/forecast-signer')

const main = async () => {
  const secret = String(process.env.MODEL_SERVICE_SHARED_SECRET || '')
  if (!secret) throw new Error('MODEL_SERVICE_SHARED_SECRET is missing')

  const dates = []
  const values = []
  const start = Date.UTC(2026, 4, 1)
  for (let index = 0; index < 70; index += 1) {
    dates.push(new Date(start + index * 86400000).toISOString().slice(0, 10))
    values.push(Number((8 + index * 0.01 + Math.sin(index / 7) * 0.12).toFixed(4)))
  }

  const requestId = generateRequestId()
  const body = JSON.stringify({
    request_id: requestId,
    spu_id: 'integration_check_only',
    horizon_days: 7,
    families: ['dlinear', 'nbeats'],
    history: {
      dates,
      values,
      missing_mask: values.map(() => 0),
      forward_filled_values: values,
    },
  })
  const { headers } = signRequest({
    method: 'POST',
    path: '/forecast',
    body,
    secret,
    requestId,
  })
  const response = await fetch('http://127.0.0.1:8000/forecast', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(120000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`model service returned ${response.status}: ${JSON.stringify(payload)}`)
  const models = Array.isArray(payload.models) ? payload.models : []
  if (models.length !== 2 || models.some((item) => item.status !== 'success')) {
    throw new Error(`model inference incomplete: ${JSON.stringify(payload)}`)
  }
  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    models: models.map((item) => ({
      family: item.family,
      version: item.version,
      status: item.status,
      inferenceMs: item.inference_ms,
      horizon: item.point_estimates?.length || 0,
    })),
    totalInferenceMs: payload.total_inference_ms,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exitCode = 1
})
