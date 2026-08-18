#!/usr/bin/env node
'use strict'

const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const baseUrl = String(process.env.VERIFY_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const verifyPhone = String(process.env.VERIFY_PHONE || '').trim()
const verifyPassword = String(process.env.VERIFY_PASSWORD || '')
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'agricloud.sqlite')

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
  const token = login?.token
  if (!token) throw new Error('login_token_missing')

  const before = await request('/api/ads/overview', { token })
  const beforeIds = new Set((before.historyList || []).map((item) => Number(item.id)))
  const selectedSellingPoints = ['支持同城配送', '可提前预订']
  const materialPackage = await request('/api/ads/generate', {
    token,
    method: 'POST',
    body: {
      productId: 1,
      productName: '苹果',
      expectedYield: 1800,
      yieldUnit: '斤',
      expectedMarketTime: '2026-08-23',
      location: '山东烟台',
      marketPrice: 8.5,
      marketUnit: '公斤',
      goal: 'group',
      channel: 'group',
      tone: '真实可信、自然亲切',
      sellingPoints: selectedSellingPoints,
      targetAudience: '社区家庭',
      extraRequirements: '围绕社群团购和接龙预订生成。',
    },
  })

  const coreCopy = [
    materialPackage.productTitle,
    materialPackage.wechatCopy,
    materialPackage.shortVideoScript,
    materialPackage.inquiryScript,
  ].join('\n')
  for (const point of selectedSellingPoints) {
    if (!coreCopy.includes(point)) throw new Error(`selling_point_missing:${point}`)
  }
  if (!/社群|团购|接龙|配送/.test(materialPackage.wechatCopy || '')) {
    throw new Error('marketing_goal_not_reflected')
  }
  if (materialPackage.goal !== 'group' || materialPackage.contentTitle !== '社群团购文案') {
    throw new Error(`generic_content_metadata_invalid:${materialPackage.goal}:${materialPackage.contentTitle}`)
  }
  if (!materialPackage.content || materialPackage.content !== materialPackage.wechatCopy) {
    throw new Error('generic_content_not_unified')
  }
  if (materialPackage.shortVideoScript || materialPackage.inquiryScript) {
    throw new Error('unselected_channel_copy_returned')
  }

  const after = await request('/api/ads/overview', { token })
  const created = (after.historyList || []).find((item) => !beforeIds.has(Number(item.id)))
  if (!created) throw new Error('generated_history_missing')
  if (/智能生成|模型|provider|vivo|doubao/i.test(String(created.meta || ''))) {
    throw new Error(`history_meta_leak:${created.meta}`)
  }
  if (Object.prototype.hasOwnProperty.call(created, 'provider')) throw new Error('history_provider_exposed')
  const expectedCalendarDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(created.createdAt))
  if (created.meta !== expectedCalendarDate) {
    throw new Error(`history_date_shifted:${created.meta}:${expectedCalendarDate}`)
  }

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const stored = db.prepare('SELECT provider FROM ad_history WHERE id = ?').get(created.id)
  db.close()
  if (!stored?.provider || stored.provider === 'rule-template') {
    throw new Error(`model_not_used:${stored?.provider || 'missing'}`)
  }

  await request(`/api/ads/history/${created.id}`, { token, method: 'DELETE' })
  const finalOverview = await request('/api/ads/overview', { token })
  if ((finalOverview.historyList || []).some((item) => Number(item.id) === Number(created.id))) {
    throw new Error('history_delete_failed')
  }

  process.stdout.write(`${JSON.stringify({
    login: true,
    modelUsed: true,
    provider: stored.provider,
    goalAligned: true,
    onlySelectedChannelReturned: true,
    unifiedContentComponent: true,
    sellingPointsIncluded: selectedSellingPoints,
    historyCalendarDate: created.meta,
    historyMetaClean: true,
    historyDeleteVerified: true,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`[verify-marketing-production] ${error?.stack || error}\n`)
  process.exitCode = 1
})
