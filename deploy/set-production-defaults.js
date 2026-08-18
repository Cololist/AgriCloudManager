#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const envPath = path.resolve(process.argv[2] || path.join(__dirname, '../backend/.env'))
const desired = new Map([
  ['SCHEDULER_ENABLED', 'true'],
  ['OSS_UPLOAD_PREFIX', 'agricloud/uploads/'],
])
const removed = new Set(['DEMO_PHONE', 'DEMO_PASSWORD', 'DEMO_NICKNAME'])
const source = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
const seen = new Set()
const lines = source.split(/\r?\n/).filter((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line)
  return !match || !removed.has(match[1])
}).map((line) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line)
  if (!match || !desired.has(match[1])) return line
  seen.add(match[1])
  return `${match[1]}=${desired.get(match[1])}`
})
for (const [key, value] of desired) {
  if (!seen.has(key)) lines.push(`${key}=${value}`)
}
fs.writeFileSync(envPath, `${lines.filter((line, index, all) => line || index < all.length - 1).join('\n').replace(/\n+$/, '')}\n`, 'utf8')
process.stdout.write(`Updated non-secret production defaults in ${envPath}; account credentials were preserved\n`)
