'use strict'

const { db } = require('../lib/db')
const { PRODUCTS, fetchProductQuotes, median } = require('../lib/pfsc-official-prices')

const run = async () => {
  const live = []
  for (const product of PRODUCTS) {
    const result = await fetchProductQuotes(product)
    live.push({
      product: product.marketItemName,
      date: result.date,
      price: median(result.quotes.map((quote) => quote.price)),
      quoteCount: result.quotes.length,
    })
  }

  const history = db.prepare(`
    SELECT m.name, h.spu_id AS spuId, h.observed_date AS observedDate,
           h.price, h.source_name AS sourceName, h.collected_at AS collectedAt
    FROM price_history h
    JOIN market_items m ON m.spu_id = h.spu_id
    WHERE m.name IN ('苹果', '大豆', '玉米')
    ORDER BY m.name, h.observed_date DESC
  `).all()

  const recentHistory = []
  for (const name of ['苹果', '大豆', '玉米']) {
    recentHistory.push(...history.filter((row) => row.name === name).slice(0, 8))
  }

  const ads = db.prepare(`
    SELECT id, platform, provider, created_at AS createdAt
    FROM ad_history
    ORDER BY created_at DESC
    LIMIT 10
  `).all()

  process.stdout.write(`${JSON.stringify({ live, recentHistory, ads }, null, 2)}\n`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
