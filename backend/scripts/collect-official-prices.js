#!/usr/bin/env node
'use strict'

require('./_bootstrap-env')

const { initDb, initForecastDb } = require('../lib/db')
const { collectPfscOfficialDaily } = require('../lib/pfsc-official-prices')
const { forecastDailyAll } = require('../lib/forecast-engine')

const main = async () => {
  initDb()
  initForecastDb()
  const collection = await collectPfscOfficialDaily({ triggeredBy: 'manual' })
  const forecasts = await forecastDailyAll({ horizons: [7, 30] })
  process.stdout.write(`${JSON.stringify({ collection, forecasts }, null, 2)}\n`)
  if (!collection.success) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`[collect-official-prices] ${error?.stack || error}\n`)
  process.exitCode = 1
})
