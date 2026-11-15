/**
 * Turning forecasts into labels.
 *
 * 1. Volatility level (globe colour, ticker, legend): the pair's forecast vol percentile
 *    vs its own history → Calm / Unsettled / Storm. "High" = high for THAT pair, not "bad".
 * 2. Trading cost (tooltip now, forecast panel in step 5): cost ratio = spread ÷ expected move.
 *
 * Every level has a word + icon + colour, and nothing here implies which way a rate will move.
 */
import { CloudLightning, CloudSun, Sun, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { PairSnapshot, StormLevel, Tolerance } from '../types'

export type ForecastLevel = Exclude<StormLevel, 'nodata'>

export interface StormLevelInfo {
  level: ForecastLevel
  name: string // weather word
  volatility: string // plain-English meaning
  Icon: LucideIcon
  textClass: string // Tailwind colour class from the @theme tokens
  colorVar: string // CSS variable, for the globe (WebGL can't use classes)
}

export const STORM_LEVELS: StormLevelInfo[] = [
  { level: 'calm', name: 'Calm', volatility: 'Low volatility', Icon: Sun, textClass: 'text-calm', colorVar: '--color-calm' },
  { level: 'unsettled', name: 'Unsettled', volatility: 'Medium volatility', Icon: CloudSun, textClass: 'text-unsettled', colorVar: '--color-unsettled' },
  { level: 'storm', name: 'Storm', volatility: 'High volatility', Icon: CloudLightning, textClass: 'text-storm', colorVar: '--color-storm' },
  { level: 'extreme', name: 'Extreme', volatility: '1.5× normal or more', Icon: TriangleAlert, textClass: 'text-extreme', colorVar: '--color-extreme' },
]

/** Forecast 30-min vol at or above this multiple of the pair's normal → "Extreme" (Emilia, 15 Nov 01:24) */
export const EXTREME_RATIO = 1.5

/** Forecast 30-min vol ÷ the pair's normal 30-min vol, or null when we don't know "normal" */
export function volRatio(pair: PairSnapshot | undefined): number | null {
  const move = pair?.forecast?.vol.at(-1)
  const normal = pair?.volNormal30m
  return move && normal ? move / normal : null
}

export const LEVEL_INFO = Object.fromEntries(STORM_LEVELS.map((l) => [l.level, l])) as Record<ForecastLevel, StormLevelInfo>

/**
 * Percentile cut-offs [unsettled from, storm from]. PROPOSAL — the team hasn't set numbers yet
 * (decisions doc, question 7). "Cautious" flags storms earlier.
 */
export const LEVEL_CUTOFFS: Record<Tolerance, [number, number]> = {
  relaxed: [0.7, 0.9],
  balanced: [0.6, 0.85],
  cautious: [0.5, 0.75],
}

/** Status values where we must NOT show a confident forecast */
const NO_FORECAST_STATUSES = new Set(['rollover', 'stale', 'no_data'])

export function levelFor(pair: PairSnapshot | undefined, tolerance: Tolerance): StormLevel {
  if (!pair || NO_FORECAST_STATUSES.has(pair.status)) return 'nodata'
  const ratio = volRatio(pair)
  if (ratio != null && ratio >= EXTREME_RATIO) return 'extreme' // same for every tolerance: always warn
  const [unsettledFrom, stormFrom] = LEVEL_CUTOFFS[tolerance]
  if (pair.percentile >= stormFrom) return 'storm'
  if (pair.percentile >= unsettledFrom) return 'unsettled'
  return 'calm'
}

export const RANK: Record<StormLevel, number> = { nodata: -1, calm: 0, unsettled: 1, storm: 2, extreme: 3 }

/** The more severe of two levels (used for cross rates like EUR/JPY). "No data" wins, to stay honest. */
export function worseLevel(a: StormLevel, b: StormLevel): StormLevel {
  if (a === 'nodata' || b === 'nodata') return 'nodata'
  return RANK[a] >= RANK[b] ? a : b
}

/* ---------------- Trading cost ---------------- */

export type CostBand = 'low' | 'normal' | 'high' | 'very_high'

/**
 * Cost ratio bands in %, from gnehz2005's Slack proposal (14 Nov): <2 excellent, 2–5 acceptable,
 * 5–10 expensive, >10 "usually avoid". PROVISIONAL: retail rules of thumb, not fitted to our data
 * (decisions doc, question 16). Wording avoids advice like "avoid".
 */
export const COST_BANDS: { band: CostBand; below: number; label: string }[] = [
  { band: 'low', below: 2, label: 'Low trading cost' },
  { band: 'normal', below: 5, label: 'Normal trading cost' },
  { band: 'high', below: 10, label: 'High trading cost' },
  { band: 'very_high', below: Infinity, label: 'Very high trading cost' },
]

/**
 * Same definition as models/cost_ratio.py: mean forecast spread ÷ forecast vol over the window, in %.
 * Pass `moveBps` to compare against the tolerance's "plan-for" move instead (Pro view).
 */
export function costRatioPct(pair: PairSnapshot, moveBps?: number): number | null {
  const { spreadBps, vol } = pair.forecast
  const move = moveBps ?? vol[vol.length - 1]
  if (!spreadBps.length || !move) return null
  const meanSpread = spreadBps.reduce((s, v) => s + v, 0) / spreadBps.length
  return (meanSpread / move) * 100
}

export function costBand(ratioPct: number | null) {
  if (ratioPct == null) return null
  return COST_BANDS.find((b) => ratioPct < b.below) ?? COST_BANDS[COST_BANDS.length - 1]
}
