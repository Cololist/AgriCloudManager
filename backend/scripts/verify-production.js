#!/usr/bin/env node
'use strict'

const baseUrl = String(process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const verifyPhone = String(process.env.VERIFY_PHONE || '').trim()
const verifyPassword = String(process.env.VERIFY_PASSWORD || '')
const forbidden = /(演示|demo|测试|mock|假数据|示例数据)/i

const request = async (pathname, { token, method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${method} ${pathname} failed: ${response.status} ${payload?.message || ''}`)
  return payload?.data ?? payload
}

const main = async () => {
  if (!verifyPhone || !verifyPassword) throw new Error('VERIFY_PHONE and VERIFY_PASSWORD are required')
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { phone: verifyPhone, password: verifyPassword },
  })
  if (!login?.token) throw new Error('login_token_missing')
  const token = login.token
  const profile = await request('/api/auth/profile', { token })
  if (profile?.role !== 'user') throw new Error(`unexpected_account_role:${profile?.role}`)

  const market = await request('/api/market/overview', { token })
  const crops = Array.isArray(market?.crops) ? market.crops : []
  if (crops.length < 3) throw new Error('market_crops_missing')
  const nearbyMarkets = Array.isArray(market?.nearbyMarkets) ? market.nearbyMarkets : []
  if (nearbyMarkets.length < 3) throw new Error('nearby_markets_missing')
  const verifiedCrops = []
  for (const crop of crops.filter((item) => ['苹果', '大豆', '玉米'].includes(item.name))) {
    if (!(Number(crop.currentPrice) > 0)) throw new Error(`invalid_price:${crop.name}`)
    if (crop.unit !== '公斤') throw new Error(`invalid_unit:${crop.name}:${crop.unit}`)
    if (forbidden.test(JSON.stringify(crop))) throw new Error(`forbidden_label:${crop.name}`)
    const forecast = await request(`/api/market/forecast/${encodeURIComponent(crop.spuId)}?horizon=7`, { token })
    if (!Array.isArray(forecast?.forecast) || forecast.forecast.length !== 7) {
      throw new Error(`forecast_missing:${crop.name}`)
    }
    const points = forecast.forecast.map((item) => Number(item.point))
    if (points.some((point) => !Number.isFinite(point) || point <= 0)) {
      throw new Error(`forecast_point_invalid:${crop.name}`)
    }
    if (new Set(points.map((point) => point.toFixed(4))).size < 2) {
      throw new Error(`forecast_flat:${crop.name}`)
    }
    const expectedDates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${forecast.originDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + index + 1)
      return date.toISOString().slice(0, 10)
    })
    if (forecast.forecast.some((item, index) => item.date !== expectedDates[index])) {
      throw new Error(`forecast_dates_invalid:${crop.name}`)
    }
    verifiedCrops.push({
      name: crop.name,
      currentPrice: crop.currentPrice,
      unit: crop.unit,
      marketStatus: crop.marketStatus,
      forecastStatus: forecast.status,
      modelFamilies: forecast.modelFamilies,
      horizon: forecast.forecast.length,
      dates: forecast.forecast.map((item) => item.date),
      points: points.map((point) => Number(point.toFixed(2))),
    })
  }
  if (verifiedCrops.length !== 3) throw new Error('required_crops_incomplete')
  const buyer = await request('/api/buyer/overview', { token })
  const buyers = Array.isArray(buyer?.buyers) ? buyer.buyers : []
  if (!buyers.length) throw new Error('buyer_matches_missing')
  if (forbidden.test(JSON.stringify({ nearbyMarkets, buyers }))) throw new Error('forbidden_market_label')
  process.stdout.write(`${JSON.stringify({
    login: true,
    account: { phone: profile.phone, nickname: profile.nickname, role: profile.role },
    crops: verifiedCrops,
    nearbyMarkets: nearbyMarkets.map((item) => item.name),
    buyerMatches: buyers.map((item) => item.name),
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`[verify-production] ${error?.stack || error}\n`)
  process.exitCode = 1
})
