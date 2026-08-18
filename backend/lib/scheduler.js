// backend/lib/scheduler.js
// market-price-forecast Phase 1, Task 4.2
// 关联：design.md §14, tasks.md §4.2
//
// 注册 node-cron 任务并通过 scheduler-lock 提供进程间互斥。
// 官方市场通常在白天滚动上报，因此采集任务在白天按小时重试；拿到新快照后
// 立即重算预测，避免页面在当天长时间停留于上一日数据。
// 其余任务（LLM 报告、预警、回测）属于后续 Phase。
//
// 重要约束：
//   - 调用方需要传入 urlBuilder（见 price-collector.collectDaily）；
//     调度器自身不内置 URL 列表，避免与 market-rag.js 重复硬编码。
//   - 通过 SCHEDULER_ENABLED 环境变量可在测试 / 维护期一键关闭。

'use strict'

const cron = require('node-cron')
const lock = require('./scheduler-lock')

const TIMEZONE = 'Asia/Shanghai'
const TASK_LOCK_TTL_SECONDS = 60 * 30 // 30 分钟，保护并发 PM2 worker

const TASKS = {
  collect: {
    name: 'forecast.collect.daily',
    cronExpr: '10 3,8-21 * * *',
    description: 'Official price refresh at 03:10 and hourly 08:10-21:10 Asia/Shanghai',
  },
  forecast: {
    name: 'forecast.predict.daily',
    cronExpr: '0 4 * * *',
    description: 'Daily forecast generation at 04:00 Asia/Shanghai for horizons 7 + 30',
  },
}

const handles = new Map()
let startupTimer = null

const log = (msg, payload) => {
  const line = `[scheduler] ${new Date().toISOString()} ${msg}` + (payload ? ` ${JSON.stringify(payload)}` : '')
  process.stdout.write(line + '\n')
}

// 包装一次任务执行：先抢锁；释放锁；记录耗时与异常
const runWithLock = async (task, work) => {
  const acquired = lock.acquireLock(task.name, TASK_LOCK_TTL_SECONDS)
  if (!acquired) {
    log(`skip ${task.name} (lock held by another worker)`)
    return { skipped: true }
  }
  const started = Date.now()
  try {
    const result = await work()
    log(`done ${task.name}`, { durationMs: Date.now() - started, result })
    return { skipped: false, result }
  } catch (err) {
    log(`failed ${task.name}`, { durationMs: Date.now() - started, error: err?.message })
    throw err
  } finally {
    lock.releaseLock(task.name)
  }
}

// 注册并启动两条 cron。
//
// options:
//   urlBuilder?: (spu, sourceName) => string|null
//     传给 collectDaily；为空时实际采集会全部 skipped（这是符合预期的，因为
//     运营层应当配置 URL 模板，否则不应该真去抓公网）。
//   horizons?: number[]   默认 [7, 30]
//   logger?: function     注入测试 logger
const start = (options = {}) => {
  if (handles.size) {
    log('start ignored — already running', { tasks: [...handles.keys()] })
    return { started: false }
  }
  if (process.env.SCHEDULER_ENABLED === 'false') {
    log('start skipped — SCHEDULER_ENABLED=false')
    return { started: false, reason: 'disabled' }
  }

  const horizons = Array.isArray(options.horizons) && options.horizons.length ? options.horizons : [7, 30]

  // 延迟 require 避免单元测试在导入时连带初始化下游模块
  const { collectDaily } = require('./price-collector')
  const { collectPfscOfficialDaily } = require('./pfsc-official-prices')
  const { forecastDailyAll } = require('./forecast-engine')

  const collectAndRefreshForecast = async (triggeredBy = 'scheduler') => {
    const official = await collectPfscOfficialDaily({ triggeredBy })
    const changedSpuIds = official.items
      .filter((item) => item.status === 'success' && item.changed && item.spuId)
      .map((item) => item.spuId)
    const forecast = changedSpuIds.length
      ? await forecastDailyAll({ horizons, spuIds: changedSpuIds })
      : null
    const additional = typeof options.urlBuilder === 'function'
      ? await collectDaily({ urlBuilder: options.urlBuilder })
      : null
    return { official, forecast, additional }
  }

  const collectHandle = cron.schedule(
    TASKS.collect.cronExpr,
    () =>
      runWithLock(TASKS.collect, async () => {
        return collectAndRefreshForecast('scheduler')
      }).catch(() => {}),
    { timezone: TIMEZONE },
  )
  handles.set(TASKS.collect.name, collectHandle)

  const forecastHandle = cron.schedule(
    TASKS.forecast.cronExpr,
    () =>
      runWithLock(TASKS.forecast, () => forecastDailyAll({ horizons })).catch(() => {}),
    { timezone: TIMEZONE },
  )
  handles.set(TASKS.forecast.name, forecastHandle)

  startupTimer = setTimeout(() => {
    startupTimer = null
    runWithLock(TASKS.collect, () => collectAndRefreshForecast('startup')).catch(() => {})
  }, Number(process.env.SCHEDULER_STARTUP_DELAY_MS || 5_000))

  log('started', {
    tasks: Object.values(TASKS).map((t) => ({ name: t.name, cron: t.cronExpr })),
    horizons,
  })
  return { started: true, tasks: [...handles.keys()] }
}

const stop = () => {
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  for (const [name, h] of handles) {
    try {
      if (typeof h.stop === 'function') h.stop()
    } catch (_e) {
      // ignore
    }
    log(`stopped ${name}`)
  }
  handles.clear()
  return { stopped: true }
}

const listHandles = () => [...handles.keys()]

// 暴露给运营 / e2e 用的"立即触发"入口。绕过 cron 表达式但仍走锁。
const triggerCollectDaily = async (urlBuilder) => {
  const { collectDaily } = require('./price-collector')
  const { collectPfscOfficialDaily } = require('./pfsc-official-prices')
  const { forecastDailyAll } = require('./forecast-engine')
  return runWithLock(TASKS.collect, async () => {
    const official = await collectPfscOfficialDaily({ triggeredBy: 'manual' })
    const changedSpuIds = official.items
      .filter((item) => item.status === 'success' && item.changed && item.spuId)
      .map((item) => item.spuId)
    return {
      official,
      forecast: changedSpuIds.length ? await forecastDailyAll({ horizons: [7, 30], spuIds: changedSpuIds }) : null,
      additional: typeof urlBuilder === 'function' ? await collectDaily({ urlBuilder }) : null,
    }
  })
}

const triggerForecastDailyAll = async ({ horizons = [7, 30] } = {}) => {
  const { forecastDailyAll } = require('./forecast-engine')
  return runWithLock(TASKS.forecast, () => forecastDailyAll({ horizons }))
}

module.exports = {
  TASKS,
  TIMEZONE,
  TASK_LOCK_TTL_SECONDS,
  start,
  stop,
  listHandles,
  triggerCollectDaily,
  triggerForecastDailyAll,
}
