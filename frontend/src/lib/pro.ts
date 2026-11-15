/**
 * Helpers for the Pro view: which pairs a conversion uses, how well past forecasts did,
 * and when a pair is usually busy. Pure functions, no React.
 */
import type { CurrencyCode, HistoryPoint, PairSnapshot, Snapshot, Tolerance } from '../types'
import { levelFor, RANK, type ForecastLevel } from './storm'
import { findPair } from './zones'

/**
 * The data pairs behind From → To: the direct pair if it exists, otherwise the two legs via USD
 * (EUR → JPY = EURUSD + USDJPY). Same rule as the globe colours (lib/zones.ts).
 */
export function routePairs(snapshot: Snapshot | null, from: CurrencyCode, to: CurrencyCode): PairSnapshot[] {
  if (!snapshot || from === to) return []
  const direct = findPair(snapshot, from, to)
  if (direct) return [direct]
  return [findPair(snapshot, from, 'USD'), findPair(snapshot, 'USD', to)].filter((p): p is PairSnapshot => !!p)
}

/** The leg with the most volatility (shown first, it drives the route's level) */
export function worstLeg(pairs: PairSnapshot[], tolerance: Tolerance): PairSnapshot | undefined {
  return [...pairs].sort((a, b) => RANK[levelFor(b, tolerance)] - RANK[levelFor(a, tolerance)])[0]
}

/** "USDJPY" → "USD/JPY" */
export const slashPair = (pair: string) => `${pair.slice(0, 3)}/${pair.slice(3)}`

/* ---------------- Tolerance: what the user plans for ---------------- */

export interface TolerancePlan {
  /** Tile / chart label */
  label: string
  /** One plain sentence shown under the switch */
  explain: string
  /** The move (bp) this user plans for, from the forecast and the top of its likely range */
  planFor: (forecast: number, high: number) => number
}

/**
 * Tolerance changes two things: when a pair is flagged (LEVEL_CUTOFFS in storm.ts) and how big a
 * move the numbers plan for. Relaxed = a typical move; Balanced = halfway to the top of the likely
 * range; Cautious = the top of the likely range. Always "either direction".
 */
export const TOLERANCE_PLAN: Record<Tolerance, TolerancePlan> = {
  relaxed: {
    label: 'Typical move',
    explain: 'Relaxed: storms flagged later; numbers plan for a typical move.',
    planFor: (f) => f,
  },
  balanced: {
    label: 'Plan for',
    explain: 'Balanced: numbers plan for a bit more than typical (halfway to the top of the likely range).',
    planFor: (f, h) => (f + h) / 2,
  },
  cautious: {
    label: 'Bad case',
    explain: 'Cautious: storms flagged earlier; numbers plan for the top of the likely range.',
    planFor: (_f, h) => h,
  },
}

/** The plan-for move for one forecast point (falls back to the forecast when there's no range) */
export function planMove(tolerance: Tolerance, forecast: number, high?: number | null): number {
  return TOLERANCE_PLAN[tolerance].planFor(forecast, high ?? forecast)
}

export interface ForecastCheck {
  /** Windows that have finished (so we know what actually happened) */
  windows: number
  /** Share of windows where the actual vol landed inside the forecast range */
  insideRange: number
  /** Typical size of the miss, as % of the forecast (median absolute error) */
  typicalMissPct: number
  /** Share of windows where the actual move stayed within the tolerance's plan-for level */
  withinPlan: number
}

/** How past forecasts compared with what actually happened, over the given points */
export function forecastCheck(points: HistoryPoint[], tolerance: Tolerance): ForecastCheck | null {
  const done = points.filter((p) => p.volActual != null && p.volForecast != null)
  if (done.length < 3) return null
  const inside = done.filter(
    (p) => p.volForecastLow != null && p.volForecastHigh != null && p.volActual! >= p.volForecastLow && p.volActual! <= p.volForecastHigh,
  ).length
  const misses = done.map((p) => Math.abs(p.volActual! - p.volForecast!) / p.volForecast!).sort((a, b) => a - b)
  const within = done.filter((p) => p.volActual! <= planMove(tolerance, p.volForecast!, p.volForecastHigh)).length
  return {
    windows: done.length,
    insideRange: inside / done.length,
    typicalMissPct: misses[Math.floor(misses.length / 2)] * 100,
    withinPlan: within / done.length,
  }
}

export interface HourCell {
  hour: number // 0–23 UTC
  /** Average forecast-vol percentile in that hour, or null if no data */
  avg: number | null
  level: ForecastLevel | null
}

/** Average volatility percentile per UTC hour — "when is this pair usually stormy?" */
export function hourlyProfile(points: HistoryPoint[], tolerance: Tolerance): HourCell[] {
  const sums = Array.from({ length: 24 }, () => ({ total: 0, n: 0 }))
  for (const p of points) {
    if (p.percentile == null) continue
    const h = new Date(p.t).getUTCHours()
    sums[h].total += p.percentile
    sums[h].n += 1
  }
  return sums.map(({ total, n }, hour) => {
    if (!n) return { hour, avg: null, level: null }
    const avg = total / n
    // Reuse the same cut-offs as the globe via a minimal fake snapshot
    const level = levelFor({ percentile: avg, status: 'live' } as PairSnapshot, tolerance) as ForecastLevel
    return { hour, avg, level }
  })
}

/** Rough money size of a move: amount × bp / 10,000 */
export function bpToMoney(amount: number, bp: number): number {
  return (amount * bp) / 10_000
}

export function formatMoney(value: number, currency: CurrencyCode): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: value < 100 ? 2 : 0 }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

/** "2026-07-02T18:40:00Z" → "18:40" (UTC) */
export function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16)
}
