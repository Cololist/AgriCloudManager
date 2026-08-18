#!/usr/bin/env node
'use strict'

require('./_bootstrap-env')

const { db, initDb, initForecastDb, nowIso } = require('../lib/db')
const { PRODUCTS, median, PFSC_BASE_URL } = require('../lib/pfsc-official-prices')

const REPORT_API = `${PFSC_BASE_URL}/price_portal/web/portal-price-information/selectListByPage`
const REPORT_PAGE_URL = `${PFSC_BASE_URL}/#/newsInformation`

const TARGETS = Object.freeze([
  { varietyCode: 'apple-red-fuji', name: '苹果', query: '苹果', aliases: ['富士苹果', '红富士苹果', '红富士', '苹果'], min: 1, max: 30 },
  { varietyCode: 'soybean-yellow', name: '大豆', query: '大豆', aliases: ['黄大豆', '大豆', '黄豆'], min: 2, max: 20 },
  { varietyCode: 'corn-yellow', name: '玉米', query: '玉米', aliases: ['鲜食玉米', '甜玉米', '糯玉米', '玉米'], min: 1, max: 12 },
])

const parseArgs = (argv) => ({
  dryRun: argv.includes('--dry-run'),
  pages: Math.max(1, Math.min(10, Number(argv.find((item) => item.startsWith('--pages='))?.split('=')[1] || 5))),
})

const normalizeText = (value) => String(value || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')

const normalizePrice = (value, unit) => {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) return null
  return /斤/.test(unit) ? price * 2 : price
}

const extractCandidatePrices = (record, target) => {
  const text = normalizeText(`${record.title || ''} ${record.contentstr || ''}`)
  const aliasPattern = target.aliases.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const unitPattern = '(元\\s*[\\/／每]?\\s*(?:公斤|千克|kg|KG|斤))'
  const patterns = [
    new RegExp(`(?:${aliasPattern})[^。；;]{0,48}?(\\d+(?:\\.\\d+)?)\\s*(?:-|–|—|~|～|至)\\s*(\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, 'g'),
    new RegExp(`(?:${aliasPattern})[^。；;]{0,38}?(?:均价|平均价|批发价|价格|报价)[^。；;]{0,12}?(\\d+(?:\\.\\d+)?)\\s*${unitPattern}`, 'g'),
  ]
  const values = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const unit = match[match.length - 1]
      const low = normalizePrice(match[1], unit)
      const high = match[2] && !/元/.test(match[2]) ? normalizePrice(match[2], unit) : null
      const price = high ? (low + high) / 2 : low
      if (Number.isFinite(price) && price >= target.min && price <= target.max) values.push(price)
    }
  }
  return values
}

const fetchReportPage = async (query, currentPage) => {
  const response = await fetch(REPORT_API, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json;charset=UTF-8',
      referer: `${PFSC_BASE_URL}/`,
      'user-agent': 'Mozilla/5.0 (compatible; AgriCloudManager/1.0; +https://ysngj.cn)',
    },
    body: JSON.stringify({ currentPage, pageSize: 100, queryKey: query, stateCode: '3' }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`pfsc_report_http_${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !Array.isArray(payload?.data?.records)) {
    throw new Error(`pfsc_report_response_${payload?.code ?? 'invalid'}`)
  }
  return payload.data.records
}

const findSpuId = (varietyCode) => db.prepare(`
  SELECT s.spu_id
  FROM spu_tuples s JOIN varieties v ON v.id = s.variety_id
  WHERE s.status = 'active' AND v.status = 'active' AND v.code = ?
  ORDER BY s.created_at ASC LIMIT 1
`).get(varietyCode)?.spu_id || ''

const main = async () => {
  initDb()
  initForecastDb()
  const args = parseArgs(process.argv)
  const summary = []

  for (const target of TARGETS) {
    const spuId = findSpuId(target.varietyCode)
    if (!spuId && !args.dryRun) continue
    const byDate = new Map()
    for (let page = 1; page <= args.pages; page += 1) {
      const records = await fetchReportPage(target.query, page)
      if (!records.length) break
      for (const record of records) {
        const date = String(record.publishDate || '').slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        const prices = extractCandidatePrices(record, target)
        if (!prices.length) continue
        if (!byDate.has(date)) byDate.set(date, [])
        byDate.get(date).push(...prices.map((price) => ({ price, record })))
      }
    }

    let inserted = 0
    let existing = 0
    const rows = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
    for (const [date, candidates] of rows) {
      const value = median(candidates.map((item) => item.price))
      if (!value) continue
      const found = db.prepare('SELECT 1 FROM price_history WHERE spu_id = ? AND observed_date = ? AND price IS NOT NULL').get(spuId, date)
      if (found) {
        existing += 1
        continue
      }
      if (!args.dryRun) {
        const evidence = candidates.slice(0, 5).map((item) => ({
          id: item.record.id,
          title: item.record.title,
          source: item.record.source,
          publishDate: date,
          extractedPriceCnyPerKg: Number(item.price.toFixed(4)),
        }))
        db.prepare(`
          INSERT INTO price_history (
            spu_id, observed_date, price, raw_text, source_name, source_url,
            source_priority, collected_at, request_id
          ) VALUES (?, ?, ?, ?, 'pfsc-report', ?, 2, ?, ?)
        `).run(
          spuId,
          date,
          Number(value.toFixed(4)),
          JSON.stringify({ aggregation: 'median', evidence }),
          REPORT_PAGE_URL,
          nowIso(),
          `pfsc_report_backfill_${Date.now()}`,
        )
      }
      inserted += 1
    }
    summary.push({ product: target.name, candidates: rows.length, inserted, existing })
  }

  process.stdout.write(`${JSON.stringify({ dryRun: args.dryRun, pages: args.pages, summary }, null, 2)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}

module.exports = { normalizeText, normalizePrice, extractCandidatePrices, fetchReportPage }
