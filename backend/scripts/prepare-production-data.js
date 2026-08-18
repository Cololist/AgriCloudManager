#!/usr/bin/env node
'use strict'

require('./_bootstrap-env')

const { db, initDb, initForecastDb, nowIso } = require('../lib/db')
const { importMarketJsonl } = require('../lib/market-rag')
const { main: seedMasterData } = require('./seed-master-data')

const main = () => {
  initDb()
  initForecastDb()
  seedMasterData()

  const summary = {}
  db.exec('BEGIN')
  try {
    summary.forecastModelsRemoved = db.prepare('DELETE FROM forecast_run_models').run().changes
    summary.forecastsRemoved = db.prepare('DELETE FROM forecast_runs').run().changes
    summary.syntheticPricesRemoved = db.prepare(`
      DELETE FROM price_history
      WHERE lower(source_name) IN ('mock', 'demo-market')
         OR lower(source_url) IN ('mock', 'http://mock', 'local://demo-market-data')
         OR lower(request_id) LIKE 'demo_market_%'
         OR lower(request_id) = 'mock-init'
    `).run().changes
    summary.syntheticLogsRemoved = db.prepare(`
      DELETE FROM collection_logs
      WHERE lower(source_name) IN ('mock', 'demo-market')
         OR lower(COALESCE(source_url, '')) IN ('mock', 'http://mock', 'local://demo-market-data')
    `).run().changes
    const accountPhone = String(process.env.DEFAULT_ACCOUNT_PHONE || '').trim()
    const accountNickname = String(process.env.DEFAULT_ACCOUNT_NICKNAME || '种植户').trim()
    summary.accountsNormalized = db.prepare(`
      UPDATE users
      SET nickname = CASE WHEN phone = ? THEN ? ELSE nickname END,
          role = CASE WHEN role = 'demo' THEN 'user' ELSE role END
      WHERE phone = ? OR role = 'demo'
    `).run(accountPhone, accountNickname, accountPhone).changes
    summary.legacySpusDeactivated = db.prepare(`
      UPDATE spu_tuples
      SET status = 'inactive', updated_at = ?
      WHERE variety_id IN (
        SELECT id FROM varieties WHERE code IN ('apple', 'soybean', 'corn')
      )
    `).run(nowIso()).changes
    db.prepare(`
      UPDATE market_items
      SET prediction = '', advice = '建议结合当地询价、运输成本和库存情况安排交易',
          market_status = '等待最新行情', updated_at = ?
      WHERE name IN ('苹果', '大豆', '玉米')
    `).run(nowIso())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  summary.knowledgeBase = importMarketJsonl()
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`[prepare-production-data] ${error?.stack || error}\n`)
    process.exitCode = 1
  }
}

module.exports = { main }
