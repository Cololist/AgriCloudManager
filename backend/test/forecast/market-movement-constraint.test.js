'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { constrainToMarketMovement, robustRecentMovePct } = require('../../lib/forecast-engine')

const forecastFromPoints = (point) => ({
  point,
  ci80Lower: point.map((value) => value * 0.96),
  ci80Upper: point.map((value) => value * 1.04),
  ci95Lower: point.map((value) => value * 0.92),
  ci95Upper: point.map((value) => value * 1.08),
})

test('robustRecentMovePct 不会被单个历史跳点放大', () => {
  const values = [7, 7.01, 7.02, 9.8, 7.03, 7.04, 7.05]
  const movement = robustRecentMovePct(values)
  assert.ok(movement >= 0.004)
  assert.ok(movement <= 0.012)
})

test('七日预测相对最新官方价的累计波动不超过 5%', () => {
  const history = { forwardFilledValues: [3, 3.02, 3.01, 3.2] }
  const raw = forecastFromPoints([3.5, 3.8, 4.1, 4.4, 4.7, 5, 5.3])
  const result = constrainToMarketMovement({ forecast: raw, history })
  assert.equal(result.forecast.point.length, 7)
  assert.ok(result.clipped)
  assert.ok(result.forecast.point.every((value) => value <= 3.2 * 1.05 + 1e-9))
})
