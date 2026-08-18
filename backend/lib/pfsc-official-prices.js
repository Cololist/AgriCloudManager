'use strict'

const crypto = require('node:crypto')
const { db, nowIso } = require('./db')
const { mergePriceRow, writeLog } = require('./price-collector')

const PFSC_BASE_URL = 'https://pfsc.agri.cn'
const PFSC_CHART_PATH = '/price_portal/index/getMarketReportPriceChart'
const PFSC_SOURCE_URL = `${PFSC_BASE_URL}/#/priceMarket`
const PFSC_AES_KEY = Buffer.from('7s9K$pG2xQ8zR5mB7vA3sD9fH2jW40cV', 'utf8')

const PRODUCTS = Object.freeze([
  { marketItemName: '苹果', varietyCode: 'apple-red-fuji', pfscVarietyId: '1282', pfscName: '富士苹果' },
  { marketItemName: '大豆', varietyCode: 'soybean-yellow', pfscVarietyId: '20', pfscName: '大豆' },
  { marketItemName: '玉米', varietyCode: 'corn-yellow', pfscVarietyId: '9', pfscName: '玉米' },
])

const median = (numbers) => {
  const values = numbers.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!values.length) return null
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
}

const decryptPayload = (encrypted) => {
  const value = String(encrypted || '')
  if (value.length <= 16) throw new Error('pfsc_encrypted_payload_invalid')
  const iv = Buffer.from(value.slice(0, 16), 'utf8')
  const decipher = crypto.createDecipheriv('aes-256-cbc', PFSC_AES_KEY, iv)
  const plaintext = Buffer.concat([
    decipher.update(value.slice(16), 'base64'),
    decipher.final(),
  ]).toString('utf8')
  return JSON.parse(plaintext)
}

const fetchProductQuotes = async (product, { fetchImpl = fetch } = {}) => {
  const url = `${PFSC_BASE_URL}${PFSC_CHART_PATH}?varietyID=${encodeURIComponent(product.pfscVarietyId)}`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9',
      referer: `${PFSC_BASE_URL}/priceMarket`,
      'user-agent': 'Mozilla/5.0 (compatible; AgriCloudManager/1.0; +https://ysngj.cn)',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`pfsc_http_${response.status}`)
  const envelope = await response.json()
  if (!envelope || ![0, 200].includes(Number(envelope.code)) || !envelope.data) {
    throw new Error(`pfsc_response_${envelope?.code ?? 'invalid'}`)
  }
  const data = decryptPayload(envelope.data)
  const markets = Array.isArray(data.x) ? data.x : []
  const prices = Array.isArray(data.y) ? data.y.map(Number) : []
  const quotes = []
  for (let index = 0; index < Math.min(markets.length, prices.length); index += 1) {
    if (!Number.isFinite(prices[index]) || prices[index] <= 0) continue
    quotes.push({ market: String(markets[index]), price: prices[index] })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.date || '')) || !quotes.length) {
    throw new Error('pfsc_price_data_invalid')
  }
  return { date: data.date, quotes, url }
}

const findSpuId = (varietyCode) => db.prepare(`
  SELECT s.spu_id
  FROM spu_tuples s
  JOIN varieties v ON v.id = s.variety_id
  WHERE s.status = 'active' AND v.status = 'active' AND v.code = ?
  ORDER BY s.created_at ASC
  LIMIT 1
`).get(varietyCode)?.spu_id || null

const updateMarketItem = ({ product, price, quotes, observedDate }) => {
  const prices = quotes.map((quote) => quote.price)
  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length
  const high = Math.max(...prices)
  const low = Math.min(...prices)
  db.prepare(`
    UPDATE market_items
    SET current_price = ?, unit = '公斤', avg_price = ?, high_price = ?, low_price = ?,
        week_volume = 0, month_volume = 0,
        source = '全国农产品批发市场价格信息系统', market_status = ?, updated_at = ?
    WHERE name = ?
  `).run(
    Number(price.toFixed(2)),
    Number(average.toFixed(2)),
    Number(high.toFixed(2)),
    Number(low.toFixed(2)),
    `${observedDate} 全国批发市场报价`,
    nowIso(),
    product.marketItemName,
  )
}

// 同步已收录批发市场的当日官方报价。buyer_offers 在移动端以“元/斤”展示，
// PFSC 返回“元/公斤”，因此这里统一除以 2；没有官方同名报价时保留最近缓存值。
const updateBuyerMarketOffers = ({ product, quotes, observedDate }) => {
  const findMerchant = db.prepare(`
    SELECT id FROM buyer_merchants
    WHERE name = ? AND status = 'active'
      AND source_platform = '全国农产品批发市场价格信息系统'
    LIMIT 1
  `)
  const updateOffer = db.prepare(`
    UPDATE buyer_offers
    SET price = ?, updated_at = ?
    WHERE merchant_id = ? AND crop_name = ?
  `)
  const updateSourceNote = db.prepare(`
    UPDATE buyer_merchants
    SET source_note = ?, updated_at = ?
    WHERE id = ?
  `)
  let updated = 0
  const timestamp = nowIso()
  for (const quote of quotes) {
    const merchantId = Number(findMerchant.get(quote.market)?.id || 0)
    if (!merchantId) continue
    const result = updateOffer.run(
      Number((Number(quote.price) / 2).toFixed(2)),
      timestamp,
      merchantId,
      product.marketItemName,
    )
    if (Number(result.changes || 0) > 0) {
      updateSourceNote.run(
        `${observedDate} 全国农产品批发市场价格信息系统参考报价，实际成交前请联系市场确认。`,
        timestamp,
        merchantId,
      )
      updated += 1
    }
  }
  return updated
}

const collectPfscOfficialDaily = async ({ fetchImpl = fetch, triggeredBy = 'scheduler' } = {}) => {
  const requestId = `pfsc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
  const summary = { requestId, success: 0, failed: 0, items: [] }

  for (const product of PRODUCTS) {
    const spuId = findSpuId(product.varietyCode)
    if (!spuId) {
      summary.failed += 1
      summary.items.push({ product: product.marketItemName, status: 'failed', reason: 'spu_not_found' })
      continue
    }
    const startedAt = Date.now()
    try {
      const result = await fetchProductQuotes(product, { fetchImpl })
      const referencePrice = median(result.quotes.map((quote) => quote.price))
      if (!referencePrice) throw new Error('pfsc_reference_price_invalid')
      const previousSnapshot = db.prepare(`
        SELECT price, source_name AS sourceName
        FROM price_history
        WHERE spu_id = ? AND observed_date = ?
      `).get(spuId, result.date)
      const changed = !previousSnapshot
        || previousSnapshot.sourceName !== 'pfsc'
        || Math.abs(Number(previousSnapshot.price) - Number(referencePrice)) > 0.0001
      const rawText = JSON.stringify({
        product: product.pfscName,
        observedDate: result.date,
        unit: '元/公斤',
        aggregation: 'median',
        quoteCount: result.quotes.length,
        quotes: result.quotes,
      })
      let merge = mergePriceRow({
        spuId,
        observedDate: result.date,
        price: Number(referencePrice.toFixed(4)),
        sourceName: 'pfsc',
        sourceUrl: PFSC_SOURCE_URL,
        rawText,
        requestId,
      })
      // 通用合并器会保护同优先级记录不被覆盖；但 PFSC 的当日榜单会在日内更新，
      // 同一官方来源的同日快照应刷新，否则页面会一直停留在首次采集值。
      if (merge.action === 'skip') {
        const existing = db.prepare(`
          SELECT source_name FROM price_history
          WHERE spu_id = ? AND observed_date = ?
        `).get(spuId, result.date)
        if (existing?.source_name === 'pfsc') {
          db.prepare(`
            UPDATE price_history
            SET price = ?, source_url = ?, raw_text = ?, collected_at = ?, request_id = ?
            WHERE spu_id = ? AND observed_date = ? AND source_name = 'pfsc'
          `).run(
            Number(referencePrice.toFixed(4)),
            PFSC_SOURCE_URL,
            rawText,
            nowIso(),
            requestId,
            spuId,
            result.date,
          )
          merge = { action: 'refresh' }
        }
      }
      updateMarketItem({ product, price: referencePrice, quotes: result.quotes, observedDate: result.date })
      const marketOffersUpdated = updateBuyerMarketOffers({
        product,
        quotes: result.quotes,
        observedDate: result.date,
      })
      writeLog({
        requestId,
        spuId,
        sourceName: 'pfsc',
        sourceUrl: PFSC_SOURCE_URL,
        status: 'success',
        httpStatus: 200,
        durationMs: Date.now() - startedAt,
        reason: merge.action,
        rawText,
        triggeredBy,
      })
      summary.success += 1
      summary.items.push({
        product: product.marketItemName,
        status: 'success',
        observedDate: result.date,
        price: Number(referencePrice.toFixed(2)),
        quoteCount: result.quotes.length,
        marketOffersUpdated,
        merge: merge.action,
        changed,
        spuId,
      })
    } catch (error) {
      writeLog({
        requestId,
        spuId,
        sourceName: 'pfsc',
        sourceUrl: PFSC_SOURCE_URL,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        reason: error?.message || 'unknown_error',
        triggeredBy,
      })
      summary.failed += 1
      summary.items.push({ product: product.marketItemName, status: 'failed', reason: error?.message || 'unknown_error' })
    }
  }
  return summary
}

module.exports = {
  PFSC_BASE_URL,
  PFSC_CHART_PATH,
  PFSC_SOURCE_URL,
  PRODUCTS,
  median,
  decryptPayload,
  fetchProductQuotes,
  updateBuyerMarketOffers,
  collectPfscOfficialDaily,
}
