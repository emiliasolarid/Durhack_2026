/**
 * MOCK data so the UI can be built before the team's export exists. Not real prices.
 * Deterministic: the same asOf always gives the same numbers (handy for demos and tests).
 *
 * Built-in edge cases, so every state gets designed and tested (decisions doc, "Data gaps"):
 * - Daily rollover gap: every pair is "rollover" 21:06–21:10 UTC
 * - USDSGD has no data on 2026-07-07 ("no_data")
 * - USDSGD is "stale" 14:00–14:04 UTC every day
 * - Saturdays/Sundays are "thin"
 * Default demo moment (see store): USDJPY stormy, EURUSD calm, USDSGD unsettled.
 */
import type { CurrencyCode, HistoryPoint, PairHistory, PairSnapshot, PairStatus, Snapshot } from '../types'

export const HORIZONS_MIN = [5, 10, 15, 20, 25, 30]

interface PairSpec {
  pair: string
  base: CurrencyCode
  quote: CurrencyCode
  mid: number // starting level (made up)
  decimals: number
  spreadBps: number // typical interbank spread
  volPerMinBps: number // typical 1-min move size
  phase: number // shifts the volatility "weather" so pairs differ
  /** UTC hours when this pair is usually busiest (trading sessions), for the intraday pattern */
  busyHoursUtc: number[]
}

const SPECS: PairSpec[] = [
  { pair: 'EURUSD', base: 'EUR', quote: 'USD', mid: 1.165, decimals: 5, spreadBps: 0.3, volPerMinBps: 0.6, phase: 0, busyHoursUtc: [8, 14.5] },
  { pair: 'USDJPY', base: 'USD', quote: 'JPY', mid: 147.2, decimals: 3, spreadBps: 0.45, volPerMinBps: 0.8, phase: 2.1, busyHoursUtc: [0.5, 14.5, 17.5] },
  { pair: 'USDSGD', base: 'USD', quote: 'SGD', mid: 1.285, decimals: 5, spreadBps: 0.7, volPerMinBps: 0.5, phase: 4.2, busyHoursUtc: [2, 8, 15] },
]

/** Small deterministic pseudo-random number in [0, 1) from a string + integer */
function noise(key: string, n: number): number {
  let h = 2166136261 ^ n
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

function statusFor(spec: PairSpec, t: Date): PairStatus {
  const minutesUtc = t.getUTCHours() * 60 + t.getUTCMinutes()
  const day = t.toISOString().slice(0, 10)
  if (spec.pair === 'USDSGD' && day === '2026-07-07') return 'no_data'
  if (minutesUtc >= 21 * 60 + 6 && minutesUtc <= 21 * 60 + 10) return 'rollover'
  if (spec.pair === 'USDSGD' && minutesUtc >= 14 * 60 && minutesUtc <= 14 * 60 + 4) return 'stale'
  const weekday = t.getUTCDay()
  if (weekday === 0 || weekday === 6) return 'thin'
  return 'live'
}

/** Busier around each session's peak hour, quieter otherwise: about −0.03 … +0.15 */
function sessionBoost(spec: PairSpec, t: Date): number {
  const hour = t.getUTCHours() + t.getUTCMinutes() / 60
  const bumps = spec.busyHoursUtc.map((peak) => {
    const d = Math.min(Math.abs(hour - peak), 24 - Math.abs(hour - peak)) // distance round the clock
    return Math.exp(-(d * d) / 4.5)
  })
  return 0.18 * Math.max(...bumps) - 0.03
}

/** Volatility "weather" for a pair at minute t: slow waves + session pattern + a little noise → 0..1 */
function percentileAt(spec: PairSpec, t: Date): number {
  const minute = Math.floor(t.getTime() / 60_000)
  const wave = 0.5 + 0.3 * Math.sin(minute / 47 + spec.phase) + 0.15 * Math.sin(minute / 11 + spec.phase * 2)
  return Math.min(0.99, Math.max(0.01, wave + sessionBoost(spec, t) + (noise(spec.pair, minute) - 0.5) * 0.1))
}

function pairAt(spec: PairSpec, t: Date): PairSnapshot {
  const minute = Math.floor(t.getTime() / 60_000)
  const percentile = percentileAt(spec, t)

  // Rate drifts a little (purely cosmetic)
  const drift = Math.sin(minute / 90 + spec.phase) * 0.002 + (noise(spec.pair + 'p', minute) - 0.5) * 0.0004
  const mid = Number((spec.mid * (1 + drift)).toFixed(spec.decimals))
  const spreadBps = Number((spec.spreadBps * (1 + percentile * 0.8)).toFixed(3))
  const halfSpread = (mid * spreadBps) / 20_000

  // Forecast: vol in bp over each horizon grows ~√minutes; stormier → bigger
  const scale = 0.6 + percentile * 1.4
  const vol = HORIZONS_MIN.map((h) => Number((spec.volPerMinBps * scale * Math.sqrt(h)).toFixed(3)))

  return {
    pair: spec.pair,
    base: spec.base,
    quote: spec.quote,
    bid: Number((mid - halfSpread).toFixed(spec.decimals)),
    ask: Number((mid + halfSpread).toFixed(spec.decimals)),
    mid,
    spreadBps,
    realizedVol30m: Number((spec.volPerMinBps * Math.sqrt(30) * (0.7 + percentile)).toFixed(3)),
    forecast: {
      horizonsMin: HORIZONS_MIN,
      vol,
      volLow: vol.map((v) => Number((v * 0.75).toFixed(3))),
      volHigh: vol.map((v) => Number((v * 1.3).toFixed(3))),
      spreadBps: HORIZONS_MIN.map((_, i) => Number((spreadBps * (1 + 0.03 * i)).toFixed(3))),
    },
    percentile: Number(percentile.toFixed(3)),
    status: statusFor(spec, t),
  }
}

export function mockSnapshot(asOf: string, base: CurrencyCode): Snapshot {
  const t = new Date(asOf)
  return { asOf, base, lastUpdated: asOf, pairs: SPECS.map((s) => pairAt(s, t)) }
}

/**
 * Past history for one pair, every `stepMin` minutes, ending at asOf (oldest first).
 * "Actual" vol is what happened over the following 30 min, so it only exists for points at least
 * 30 min before asOf — the UI must never show the future.
 * Mock rule: the actual follows the real "weather" 15 min later (so the forecast lags a little)
 * times some noise, which gives an honest-looking forecast-vs-actual chart.
 */
export function mockHistory(pair: string, asOf: string, hours: number, stepMin = 5): PairHistory | null {
  const spec = SPECS.find((s) => s.pair === pair)
  if (!spec) return null
  const horizon = HORIZONS_MIN[HORIZONS_MIN.length - 1]
  const end = Math.floor(new Date(asOf).getTime() / (stepMin * 60_000)) * stepMin * 60_000
  const steps = Math.floor((hours * 60) / stepMin)
  const points: HistoryPoint[] = []

  for (let i = steps; i >= 0; i--) {
    const tMs = end - i * stepMin * 60_000
    const t = new Date(tMs)
    const snap = pairAt(spec, t)
    const noReading = snap.status === 'no_data' || snap.status === 'rollover'
    const fc = snap.forecast.vol[snap.forecast.vol.length - 1]
    let actual: number | null = null
    if (!noReading && tMs + horizon * 60_000 <= end) {
      const later = percentileAt(spec, new Date(tMs + 15 * 60_000))
      const wobble = 0.8 + noise(spec.pair + 'a', tMs / 60_000) * 0.45
      actual = Number((spec.volPerMinBps * (0.6 + later * 1.4) * Math.sqrt(horizon) * wobble).toFixed(3))
    }
    points.push({
      t: t.toISOString(),
      mid: noReading ? null : snap.mid,
      spreadBps: noReading ? null : snap.spreadBps,
      volForecast: noReading ? null : fc,
      volForecastLow: noReading ? null : snap.forecast.volLow?.at(-1) ?? null,
      volForecastHigh: noReading ? null : snap.forecast.volHigh?.at(-1) ?? null,
      volActual: actual,
      percentile: noReading ? null : snap.percentile,
      status: snap.status,
    })
  }
  return { pair: spec.pair, base: spec.base, quote: spec.quote, stepMin, horizonMin: horizon, points }
}

/** Decimal places to show for a pair's rate */
export function decimalsFor(pair: string): number {
  return pair.includes('JPY') ? 2 : 4
}
