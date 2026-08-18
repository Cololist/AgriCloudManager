'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { median, decryptPayload, fetchProductQuotes } = require('../../lib/pfsc-official-prices')

const encryptLikePfsc = (payload) => {
  const ivText = '2026081700012345'
  const key = Buffer.from('7s9K$pG2xQ8zR5mB7vA3sD9fH2jW40cV', 'utf8')
  const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.from(ivText, 'utf8'))
  return ivText + Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]).toString('base64')
}

test('median filters invalid values and resists outliers', () => {
  assert.equal(median([2, 2.2, 2.4, 99, null, -1]), 2.3)
})

test('decryptPayload reads the official envelope format', () => {
  const payload = { date: '2026-08-17', x: ['甲市场'], y: [5.2] }
  assert.deepEqual(decryptPayload(encryptLikePfsc(payload)), payload)
})

test('fetchProductQuotes validates and returns market quotes', async () => {
  const payload = { date: '2026-08-17', x: ['甲市场', '乙市场'], y: [5.2, 5.6] }
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ code: 0, data: encryptLikePfsc(payload) }),
  })
  const result = await fetchProductQuotes({ pfscVarietyId: '9' }, { fetchImpl })
  assert.equal(result.date, '2026-08-17')
  assert.deepEqual(result.quotes, [{ market: '甲市场', price: 5.2 }, { market: '乙市场', price: 5.6 }])
})
