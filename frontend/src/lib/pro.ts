/**
 * Helpers for the Pro view: which pairs a conversion uses, how well past forecasts did,
 * and when a pair is usually busy. Pure functions, no React.
 */
import type { CurrencyCode, HistoryPoint, PairSnapshot, Snapshot, Tolerance } from '../types'
import { levelFor, type ForecastLevel } from './storm'
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

const RANK: Record<string, number> = { nodata: -1, calm: 0, unsettled: 1, storm: 2 }

/** The leg with the most volatility (shown first, it drives the route's level) */
export function worstLeg(pairs: PairSnapshot[], tolerance: Tolerance): PairSnapshot | undefined {
  return [...pairs].sort((a, b) => RANK[levelFor(b, tolerance)] - RANK[levelFor(a, tolerance)])[0]
}

/** "USDJPY" → "USD/JPY" */
export const slashPair = (pair: string) => `${pair.slice(0, 3)}/${pair.slice(3)}`

export interface ForecastCheck {
  /** Windows that have finished (so we know what actually happened) */
  windows: number
  /** Share of windows where the actual vol landed inside the forecast range */
  insideRange: number
  /** Typical size of the miss, as % of the forecast (median absolute error) */
  typicalMissPct: number
}

/** How past forecasts compared with what actually happened, over the given points */
export function forecastCheck(points: HistoryPoint[]): ForecastCheck | null {
  const done = points.filter((p) => p.volActual != null && p.volForecast != null)
  if (done.length < 3) return null
  const inside = done.filter(
    (p) => p.volForecastLow != null && p.volForecastHigh != null && p.volActual! >= p.volForecastLow && p.volActual! <= p.volForecastHigh,
  ).length
  const misses = done.map((p) => Math.abs(p.volActual! - p.volForecast!) / p.volForecast!).sort((a, b) => a - b)
  return {
    windows: done.length,
    insideRange: inside / done.length,
    typicalMissPct: misses[Math.floor(misses.length / 2)] * 100,
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
