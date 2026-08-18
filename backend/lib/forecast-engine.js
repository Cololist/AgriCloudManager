// backend/lib/forecast-engine.js
// 价格预测引擎
//
// 两个大脑：
//   高级大脑（≥ 62 天历史）：调 GPU Model_Service，运行 DLinear + N-BEATS
//   备用大脑（< 62 天历史）：Node.js 内直接运行 MA + SES，不需要 GPU

'use strict'

const { db, nowIso } = require('./db')
const { signRequest, generateRequestId } = require('./forecast-signer')
const { validateAndClip } = require('./forecast-validators')
const { fallbackForecast } = require('./fallback-engine')
const { tryBorrowedHistory } = require('./borrowed-history')

// ─── 常量 ────────────────────────────────────────────────────────────────────
const HORIZONS = [7, 30]
const HISTORY_LOOKBACK_DAYS = 365

// 62 天是高级大脑 / 备用大脑的分界线
const DEEP_THRESHOLD = 62

const MS_TIMEOUT_MS = Number(process.env.MODEL_SERVICE_TIMEOUT_MS || 30_000)
const MS_BASE_URL = process.env.MODEL_SERVICE_BASE_URL || 'http://127.0.0.1:8000'
const MS_SHARED_SECRET = process.env.MODEL_SERVICE_SHARED_SECRET || ''

// 高级大脑：DLinear（趋势/季节）+ N-BEATS（短期波动）
const DEEP_FAMILIES = ['dlinear', 'nbeats']

const parseIsoDateUtc = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(timestamp) ? timestamp : null
}

const formatIsoDateUtc = (timestamp) => new Date(timestamp).toISOString().slice(0, 10)

// 官方历史报告通常按周或不定期发布。模型的每一步必须代表“一天”，因此只在
// 两个已核验观测之间做线性插值，生成规则的日序列；真实观测 mask=0，插值 mask=1。
// 不向首条之前或末条之后外推，避免把缺失行情伪装成新的市场报价。
const regularizeDailyHistory = (rows, lookbackDays = HISTORY_LOOKBACK_DAYS) => {
  const observed = rows
    .map((row) => ({ date: String(row.observed_date || ''), ts: parseIsoDateUtc(row.observed_date), price: Number(row.price) }))
    .filter((row) => row.ts != null && Number.isFinite(row.price) && row.price > 0)
    .sort((a, b) => a.ts - b.ts)
  if (!observed.length) return { dates: [], values: [], missingMask: [], forwardFilledValues: [] }

  const deduped = []
  for (const row of observed) {
    if (deduped.length && deduped[deduped.length - 1].ts === row.ts) deduped[deduped.length - 1] = row
    else deduped.push(row)
  }
  if (deduped.length === 1) {
    return { dates: [deduped[0].date], values: [deduped[0].price], missingMask: [0], forwardFilledValues: [deduped[0].price] }
  }

  const dayMs = 86_400_000
  const lastTs = deduped[deduped.length - 1].ts
  const startTs = Math.max(deduped[0].ts, lastTs - (Math.max(1, lookbackDays) - 1) * dayMs)
  const dates = []
  const values = []
  const missingMask = []
  let rightIndex = 1
  for (let ts = startTs; ts <= lastTs; ts += dayMs) {
    while (rightIndex < deduped.length && deduped[rightIndex].ts < ts) rightIndex += 1
    const right = deduped[Math.min(rightIndex, deduped.length - 1)]
    const left = deduped[Math.max(0, rightIndex - 1)]
    const exact = left.ts === ts ? left : (right.ts === ts ? right : null)
    let price
    let derived = 0
    if (exact) price = exact.price
    else {
      const ratio = (ts - left.ts) / (right.ts - left.ts)
      price = left.price + (right.price - left.price) * ratio
      derived = 1
    }
    dates.push(formatIsoDateUtc(ts))
    values.push(Number(price.toFixed(4)))
    missingMask.push(derived)
  }
  return { dates, values, missingMask, forwardFilledValues: values.slice() }
}

// ─── 工具：加载历史价格 ───────────────────────────────────────────────────────
const loadHistory = (spuId, lookbackDays = HISTORY_LOOKBACK_DAYS) => {
  const rows = db
    .prepare(
      `SELECT observed_date, price FROM price_history
       WHERE spu_id = ? ORDER BY observed_date DESC LIMIT ?`,
    )
    .all(spuId, Math.max(lookbackDays * 4, lookbackDays))

  return regularizeDailyHistory(rows, lookbackDays)
}

// ─── 工具：等权融合（DLinear + N-BEATS 各占 50%）────────────────────────────
const fuseForecasts = (modelOutputs) => {
  if (!modelOutputs.length) return null
  const horizon = modelOutputs[0].point.length
  const n = modelOutputs.length
  const weight = 1 / n
  const weightMap = {}
  modelOutputs.forEach((m) => { weightMap[m.family] = weight })

  const avg = (arrays) => {
    return Array.from({ length: horizon }, (_, h) => {
      let acc = 0, cnt = 0
      for (const arr of arrays) {
        const v = arr[h]
        if (v != null && Number.isFinite(v)) { acc += v; cnt++ }
      }
      return cnt > 0 ? acc / cnt : null
    })
  }

  return {
    point:     avg(modelOutputs.map((m) => m.point)),
    ci80Lower: avg(modelOutputs.map((m) => m.ci80L)),
    ci80Upper: avg(modelOutputs.map((m) => m.ci80U)),
    ci95Lower: avg(modelOutputs.map((m) => m.ci95L)),
    ci95Upper: avg(modelOutputs.map((m) => m.ci95U)),
    weights: weightMap,
  }
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value))

const robustRecentMovePct = (values) => {
  const recent = values
    .slice(-30)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  if (recent.length < 2) return 0.006

  const moves = []
  for (let i = 1; i < recent.length; i += 1) {
    moves.push(Math.abs((recent[i] - recent[i - 1]) / recent[i - 1]))
  }
  moves.sort((a, b) => a - b)
  const middle = Math.floor(moves.length / 2)
  const medianMove = moves.length % 2 ? moves[middle] : (moves[middle - 1] + moves[middle]) / 2
  // 稀疏周报经插值后仍可能带有异常跳点。采用中位数而不是均值，避免一个跳点
  // 被放大成连续七天的高增长；农业参考价的单日预测位移限制在 0.4%-1.2%。
  return clampNumber(medianMove * 1.35, 0.004, 0.012)
}

const constrainToMarketMovement = ({ forecast, history }) => {
  if (!forecast || !Array.isArray(forecast.point)) return { forecast, clipped: false }
  const historyValues = (history?.forwardFilledValues || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
  const lastKnownPrice = historyValues[historyValues.length - 1]
  if (!Number.isFinite(lastKnownPrice) || lastKnownPrice <= 0) return { forecast, clipped: false }

  const dailyMovePct = robustRecentMovePct(historyValues)
  const horizonDays = Math.max(1, forecast.point.length)
  const horizonMovePct = clampNumber(dailyMovePct * Math.sqrt(horizonDays) * 1.45, 0.018, 0.05)
  const out = {
    point: [],
    ci80Lower: [],
    ci80Upper: [],
    ci95Lower: [],
    ci95Upper: [],
  }
  let prevPoint = lastKnownPrice
  let clipped = false

  for (let i = 0; i < forecast.point.length; i += 1) {
    const point = Number(forecast.point[i])
    const ci80Lower = Number(forecast.ci80Lower[i])
    const ci80Upper = Number(forecast.ci80Upper[i])
    const ci95Lower = Number(forecast.ci95Lower[i])
    const ci95Upper = Number(forecast.ci95Upper[i])

    if (![point, ci80Lower, ci80Upper, ci95Lower, ci95Upper].every(Number.isFinite)) {
      out.point.push(forecast.point[i])
      out.ci80Lower.push(forecast.ci80Lower[i])
      out.ci80Upper.push(forecast.ci80Upper[i])
      out.ci95Lower.push(forecast.ci95Lower[i])
      out.ci95Upper.push(forecast.ci95Upper[i])
      continue
    }

    const progressCap = horizonMovePct * Math.sqrt((i + 1) / horizonDays)
    const minPoint = Math.max(prevPoint * (1 - dailyMovePct), lastKnownPrice * (1 - progressCap))
    const maxPoint = Math.min(prevPoint * (1 + dailyMovePct), lastKnownPrice * (1 + progressCap))
    const nextPoint = clampNumber(point, minPoint, maxPoint)
    const shift = nextPoint - point
    const minBandWidth = Math.max(lastKnownPrice * 0.012, 0.04)
    const ci80Width = Math.max(ci80Upper - ci80Lower, minBandWidth)
    const ci95Width = Math.max(ci95Upper - ci95Lower, ci80Width * 1.55)

    out.point.push(nextPoint)
    out.ci80Lower.push(Math.max(0, nextPoint - ci80Width / 2))
    out.ci80Upper.push(nextPoint + ci80Width / 2)
    out.ci95Lower.push(Math.max(0, nextPoint - ci95Width / 2))
    out.ci95Upper.push(nextPoint + ci95Width / 2)

    if (Math.abs(shift) > 1e-9) clipped = true
    prevPoint = nextPoint
  }

  return { forecast: out, clipped }
}

// ─── 工具：调用 GPU Model_Service ────────────────────────────────────────────
const callModelService = async ({ requestId, spuId, history, horizonDays }) => {
  if (!MS_SHARED_SECRET) return { ok: false, reason: 'missing_shared_secret' }

  const path = '/forecast'
  const body = JSON.stringify({
    request_id: requestId,
    spu_id: spuId,
    horizon_days: horizonDays,
    families: DEEP_FAMILIES,
    history: {
      dates: history.dates,
      values: history.values,
      missing_mask: history.missingMask,
      forward_filled_values: history.forwardFilledValues,
    },
  })

  const { headers } = signRequest({ method: 'POST', path, body, secret: MS_SHARED_SECRET, requestId })
  const url = `${MS_BASE_URL.replace(/\/$/, '')}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), MS_TIMEOUT_MS)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      signal: ctrl.signal,
    })
    if (!resp.ok) return { ok: false, reason: `http_${resp.status}` }
    const data = await resp.json()
    if (!data || !Array.isArray(data.models)) return { ok: false, reason: 'invalid_response_shape' }
    return {
      ok: true,
      models: data.models.map((m) => ({
        family: m.family,
        version: m.version || 'unknown',
        status: m.status || 'success',
        point: m.point_estimates || [],
        ci80L: m.ci80_lower || [],
        ci80U: m.ci80_upper || [],
        ci95L: m.ci95_lower || [],
        ci95U: m.ci95_upper || [],
        inferenceMs: Number(m.inference_ms || 0),
        errorMessage: m.error_message || null,
      })),
      totalInferenceMs: Number(data.total_inference_ms || 0),
    }
  } catch (e) {
    if (e?.name === 'AbortError') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: `fetch_error:${e?.message || 'unknown'}` }
  } finally {
    clearTimeout(timer)
  }
}

// ─── 工具：持久化预测结果 ─────────────────────────────────────────────────────
const persistForecastRun = ({
  requestId, spuId, originDate, horizonDays, status,
  modelFamilies, weights, fused, perModel,
  borrowedHistoryFlag = 0, borrowedOriginIds = [], inferenceMs = null,
}) => {
  const generatedAt = nowIso()

  // 同键旧记录 → superseded
  if (['active', 'clipped', 'cold_start', 'degraded'].includes(status)) {
    db.prepare(
      `UPDATE forecast_runs SET status = 'superseded'
       WHERE spu_id = ? AND origin_date = ? AND horizon_days = ?
         AND status IN ('active','clipped','cold_start','degraded','qualitative-only')`,
    ).run(spuId, originDate, horizonDays)
  }

  const result = db.prepare(
    `INSERT INTO forecast_runs (
       request_id, spu_id, origin_date, horizon_days, status,
       model_families_json, weights_json, point_estimates_json,
       ci80_lower_json, ci80_upper_json, ci95_lower_json, ci95_upper_json,
       borrowed_history_flag, borrowed_origin_ids_json, generated_at, inference_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    requestId, spuId, originDate, horizonDays, status,
    JSON.stringify(modelFamilies),
    JSON.stringify(weights || {}),
    JSON.stringify(fused?.point || []),
    JSON.stringify(fused?.ci80Lower || []),
    JSON.stringify(fused?.ci80Upper || []),
    JSON.stringify(fused?.ci95Lower || []),
    JSON.stringify(fused?.ci95Upper || []),
    borrowedHistoryFlag ? 1 : 0,
    JSON.stringify(borrowedOriginIds),
    generatedAt,
    inferenceMs == null ? null : Number(inferenceMs),
  )
  const forecastRunId = Number(result.lastInsertRowid)

  if (Array.isArray(perModel)) {
    const stmt = db.prepare(
      `INSERT INTO forecast_run_models (
         forecast_run_id, model_family, model_version, status, weight,
         point_estimates_json, ci80_lower_json, ci80_upper_json,
         ci95_lower_json, ci95_upper_json, inference_ms, error_message, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const m of perModel) {
      stmt.run(
        forecastRunId, m.family, m.version || 'unknown', m.status || 'success',
        Number(weights?.[m.family] ?? 0),
        JSON.stringify(m.point || []),
        JSON.stringify(m.ci80L || []),
        JSON.stringify(m.ci80U || []),
        JSON.stringify(m.ci95L || []),
        JSON.stringify(m.ci95U || []),
        m.inferenceMs == null ? null : Number(m.inferenceMs),
        m.errorMessage || null,
        generatedAt,
      )
    }
  }

  return { forecastRunId, generatedAt, status }
}

// ─── 备用大脑：直接用 Node.js fallback 产出预测 ───────────────────────────────
const runFallback = ({ requestId, spuId, originDate, horizonDays, history, borrowedHistoryFlag, borrowedOriginIds, isColdStart }) => {
  const fb = fallbackForecast({ history: history.forwardFilledValues, horizonDays })
  if (!fb) {
    return persistForecastRun({
      requestId, spuId, originDate, horizonDays,
      status: 'qualitative-only',
      modelFamilies: [], weights: {},
      fused: { point: [], ci80Lower: [], ci80Upper: [], ci95Lower: [], ci95Upper: [] },
      perModel: [], borrowedHistoryFlag, borrowedOriginIds,
    })
  }
  const validated = validateAndClip({
    point: fb.point, ci80Lower: fb.ci80Lower, ci80Upper: fb.ci80Upper,
    ci95Lower: fb.ci95Lower, ci95Upper: fb.ci95Upper,
  })
  const candidate = validated.ok
    ? { point: validated.point, ci80Lower: validated.ci80Lower, ci80Upper: validated.ci80Upper, ci95Lower: validated.ci95Lower, ci95Upper: validated.ci95Upper }
    : { point: fb.point, ci80Lower: fb.ci80Lower, ci80Upper: fb.ci80Upper, ci95Lower: fb.ci95Lower, ci95Upper: fb.ci95Upper }
  const bounded = constrainToMarketMovement({ forecast: candidate, history })
  const boundedValidated = validateAndClip({
    point: bounded.forecast.point,
    ci80Lower: bounded.forecast.ci80Lower,
    ci80Upper: bounded.forecast.ci80Upper,
    ci95Lower: bounded.forecast.ci95Lower,
    ci95Upper: bounded.forecast.ci95Upper,
  })
  const status = isColdStart
    ? 'cold_start'
    : boundedValidated.ok
      ? (bounded.clipped ? 'clipped' : boundedValidated.status)
      : 'degraded'
  return persistForecastRun({
    requestId, spuId, originDate, horizonDays, status,
    modelFamilies: [fb.family],
    weights: { [fb.family]: 1.0 },
    fused: boundedValidated.ok
      ? { point: boundedValidated.point, ci80Lower: boundedValidated.ci80Lower, ci80Upper: boundedValidated.ci80Upper, ci95Lower: boundedValidated.ci95Lower, ci95Upper: boundedValidated.ci95Upper }
      : candidate,
    perModel: [{ family: fb.family, version: 'fallback', status: 'success', point: fb.point, ci80L: fb.ci80Lower, ci80U: fb.ci80Upper, ci95L: fb.ci95Lower, ci95U: fb.ci95Upper }],
    borrowedHistoryFlag, borrowedOriginIds,
  })
}

// ─── 主流程：单 SPU 单 horizon ────────────────────────────────────────────────
const forecastOne = async ({ spuId, horizonDays = 7, originDate }) => {
  const requestId = generateRequestId()
  const today = originDate || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)

  let history = loadHistory(spuId)
  let borrowedHistoryFlag = 0
  let borrowedOriginIds = []

  const countObservedHistory = (series) => {
    const mask = Array.isArray(series?.missingMask) ? series.missingMask : []
    if (mask.length === series?.values?.length) {
      return mask.filter((value, index) => Number(value) === 0 && Number.isFinite(Number(series.values[index]))).length
    }
    return (series?.values || []).filter((value) => Number.isFinite(Number(value))).length
  }

  // 插值点只用于补齐时间步，不能计作真实历史。真实观测不足时才尝试借用
  // 同品种其他产地的实际报价，避免少量周报跨越很长日期后误启用深度模型。
  if (countObservedHistory(history) < DEEP_THRESHOLD) {
    const borrowed = tryBorrowedHistory(spuId, 30)
    if (borrowed && borrowed.values.length) {
      borrowedHistoryFlag = 1
      borrowedOriginIds = borrowed.originIds
      history = {
        dates: borrowed.dates,
        values: borrowed.values,
        missingMask: borrowed.values.map(() => 0),
        forwardFilledValues: borrowed.values.slice(),
      }
    }
  }

  const observedHistoryLen = countObservedHistory(history)

  // ── 备用大脑：< 62 天，用 MA / SES ──────────────────────────────────────────
  if (observedHistoryLen < DEEP_THRESHOLD) {
    return runFallback({
      requestId, spuId, originDate: today, horizonDays,
      history, borrowedHistoryFlag, borrowedOriginIds,
      isColdStart: true,
    })
  }

  // ── 高级大脑：≥ 62 天，调 GPU DLinear + N-BEATS ──────────────────────────────
  const msResult = await callModelService({ requestId, spuId, history, horizonDays })

  if (!msResult.ok) {
    // GPU 不可用时降级到备用大脑
    return runFallback({
      requestId, spuId, originDate: today, horizonDays,
      history, borrowedHistoryFlag, borrowedOriginIds,
      isColdStart: false,
    })
  }

  const succeeded = msResult.models.filter((m) => m.status === 'success')
  if (!succeeded.length) {
    return runFallback({
      requestId, spuId, originDate: today, horizonDays,
      history, borrowedHistoryFlag, borrowedOriginIds,
      isColdStart: false,
    })
  }

  // DLinear + N-BEATS 等权融合
  const fused = fuseForecasts(succeeded)
  const rawValidated = validateAndClip({
    point: fused.point,
    ci80Lower: fused.ci80Lower,
    ci80Upper: fused.ci80Upper,
    ci95Lower: fused.ci95Lower,
    ci95Upper: fused.ci95Upper,
  })

  // Reject structurally invalid model output before applying market movement
  // constraints. Otherwise the constraint step can accidentally turn an
  // invalid interval ordering into an apparently valid clipped forecast.
  if (!rawValidated.ok) {
    return persistForecastRun({
      requestId, spuId, originDate: today, horizonDays,
      status: 'degraded',
      modelFamilies: succeeded.map((m) => m.family),
      weights: fused.weights,
      fused,
      perModel: msResult.models,
      borrowedHistoryFlag, borrowedOriginIds,
      inferenceMs: msResult.totalInferenceMs,
    })
  }

  const bounded = constrainToMarketMovement({ forecast: rawValidated, history })
  const validated = validateAndClip({
    point: bounded.forecast.point,
    ci80Lower: bounded.forecast.ci80Lower,
    ci80Upper: bounded.forecast.ci80Upper,
    ci95Lower: bounded.forecast.ci95Lower,
    ci95Upper: bounded.forecast.ci95Upper,
  })

  return persistForecastRun({
    requestId, spuId, originDate: today, horizonDays,
    status: validated.ok ? (bounded.clipped ? 'clipped' : validated.status) : 'degraded',
    modelFamilies: succeeded.map((m) => m.family),
    weights: fused.weights,
    fused: validated.ok
      ? { point: validated.point, ci80Lower: validated.ci80Lower, ci80Upper: validated.ci80Upper, ci95Lower: validated.ci95Lower, ci95Upper: validated.ci95Upper }
      : fused,
    perModel: msResult.models,
    borrowedHistoryFlag, borrowedOriginIds,
    inferenceMs: msResult.totalInferenceMs,
  })
}

// ─── 批量入口 ─────────────────────────────────────────────────────────────────
const forecastDailyAll = async ({ horizons = HORIZONS, spuIds = null } = {}) => {
  const baseSql = "SELECT spu_id FROM spu_tuples WHERE status = 'active'"
  const rows = Array.isArray(spuIds) && spuIds.length
    ? db.prepare(`${baseSql} AND spu_id IN (${spuIds.map(() => '?').join(',')})`).all(...spuIds)
    : db.prepare(baseSql).all()

  const summary = { total: rows.length * horizons.length, success: 0, degraded: 0, coldStart: 0, qualitative: 0, clipped: 0 }
  for (const row of rows) {
    for (const h of horizons) {
      try {
        const r = await forecastOne({ spuId: row.spu_id, horizonDays: h })
        switch (r.status) {
          case 'active':    summary.success += 1; break
          case 'clipped':   summary.clipped += 1; break
          case 'degraded':  summary.degraded += 1; break
          case 'cold_start': summary.coldStart += 1; break
          case 'qualitative-only': summary.qualitative += 1; break
        }
      } catch (_e) {
        summary.degraded += 1
      }
    }
  }
  return summary
}

// ─── 读路径 ───────────────────────────────────────────────────────────────────
const readLatestActive = (spuId, horizonDays = 7) => {
  const row = db
    .prepare(
      `SELECT * FROM forecast_runs
       WHERE spu_id = ? AND horizon_days = ?
         AND status IN ('active','clipped','cold_start','degraded','qualitative-only')
       ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(spuId, horizonDays)
  if (!row) return null
  return {
    forecastRunId: row.id,
    spuId: row.spu_id,
    originDate: row.origin_date,
    horizonDays: row.horizon_days,
    status: row.status,
    modelFamilies: JSON.parse(row.model_families_json || '[]'),
    weights: JSON.parse(row.weights_json || '{}'),
    point: JSON.parse(row.point_estimates_json || '[]'),
    ci80Lower: JSON.parse(row.ci80_lower_json || '[]'),
    ci80Upper: JSON.parse(row.ci80_upper_json || '[]'),
    ci95Lower: JSON.parse(row.ci95_lower_json || '[]'),
    ci95Upper: JSON.parse(row.ci95_upper_json || '[]'),
    borrowedHistoryFlag: !!row.borrowed_history_flag,
    borrowedOriginIds: JSON.parse(row.borrowed_origin_ids_json || '[]'),
    generatedAt: row.generated_at,
    inferenceMs: row.inference_ms,
  }
}

module.exports = {
  HORIZONS,
  HISTORY_LOOKBACK_DAYS,
  DEEP_THRESHOLD,
  DEEP_FAMILIES,
  regularizeDailyHistory,
  loadHistory,
  fuseForecasts,
  robustRecentMovePct,
  constrainToMarketMovement,
  forecastOne,
  forecastDailyAll,
  readLatestActive,
  __callModelService: callModelService,
  __persistForecastRun: persistForecastRun,
}
