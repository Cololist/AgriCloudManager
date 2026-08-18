'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { regularizeDailyHistory } = require('../../lib/forecast-engine')

test('不定期官方报价被转换为连续日序列，且插值点有缺失标记', () => {
  const history = regularizeDailyHistory([
    { observed_date: '2026-08-01', price: 6 },
    { observed_date: '2026-08-04', price: 9 },
  ], 365)

  assert.deepEqual(history.dates, ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
  assert.deepEqual(history.values, [6, 7, 8, 9])
  assert.deepEqual(history.missingMask, [0, 1, 1, 0])
  assert.deepEqual(history.forwardFilledValues, history.values)
})

test('历史日序列受 lookbackDays 限制且不向末条报价之后外推', () => {
  const history = regularizeDailyHistory([
    { observed_date: '2026-07-01', price: 6 },
    { observed_date: '2026-08-04', price: 9.4 },
  ], 4)

  assert.deepEqual(history.dates, ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'])
  assert.equal(history.dates.at(-1), '2026-08-04')
  assert.equal(history.values.at(-1), 9.4)
})
