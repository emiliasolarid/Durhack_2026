/**
 * Shared data contract between the model team and the UI.
 * PROPOSAL v2 (15 Nov) — agree with the team, then change it in ONE place (here).
 * v2 adds `base` and `status` to PairSnapshot. See "DurHack decisions & to-do".
 */

export type CurrencyCode = string // e.g. "USD", "JPY"

export interface PairForecast {
  /** Minutes ahead for each forecast point, e.g. [5, 10, ..., 30] */
  horizonsMin: number[]
  /** Forecast realised volatility in bp at each horizon (same length as horizonsMin) */
  vol: number[]
  /** Forecast spread in basis points at each horizon */
  spreadBps: number[]
  /** Optional uncertainty band */
  volLow?: number[]
  volHigh?: number[]
}

/** Data state of one pair at the simulated "now". See the "Data gaps" table in the decisions doc. */
export type PairStatus = 'live' | 'rollover' | 'stale' | 'no_data' | 'thin'

export interface PairSnapshot {
  pair: string // market convention, e.g. "USDJPY"
  base: CurrencyCode // "USD"  (v2)
  quote: CurrencyCode // "JPY"
  bid: number
  ask: number
  mid: number
  spreadBps: number
  realizedVol30m: number
  forecast: PairForecast
  /** How unusual forecast vol is vs this pair's own history, 0–1. Drives globe colour. */
  percentile: number
  status: PairStatus // (v2)
}

export interface Snapshot {
  asOf: string // ISO timestamp — the (simulated) "now"
  base: CurrencyCode
  lastUpdated: string // ISO timestamp of the newest data used
  pairs: PairSnapshot[]
}

/* ---------- v3 (15 Nov, PROPOSAL): past history for the Pro view. Additive only. ---------- */

/** One time step of a pair's history (every `stepMin` minutes) */
export interface HistoryPoint {
  t: string // ISO timestamp
  mid: number | null
  spreadBps: number | null
  /** Vol the model forecast AT time t for the next `horizonMin` minutes (bp) */
  volForecast: number | null
  volForecastLow?: number | null
  volForecastHigh?: number | null
  /** Vol that actually happened over t … t+horizonMin (bp). null until that window has passed */
  volActual: number | null
  /** Forecast vol percentile vs the pair's own history, 0–1 */
  percentile: number | null
  status: PairStatus
}

export interface PairHistory {
  pair: string
  base: CurrencyCode
  quote: CurrencyCode
  stepMin: number // e.g. 5
  horizonMin: number // e.g. 30
  points: HistoryPoint[] // oldest first, last point = asOf
}

/** UI-side derived types */
export type StormLevel = 'calm' | 'unsettled' | 'storm' | 'nodata'
export type Tolerance = 'relaxed' | 'balanced' | 'cautious'
export type ViewMode = 'simple' | 'pro'
