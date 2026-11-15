/**
 * THE ONLY DOOR TO DATA. Every component gets forecasts through these functions.
 * Today they return mock data; when the team's export is ready, swap the bodies for fetches of
 * /data/<day>.json and keep the same return types (src/types.ts).
 */
import type { CurrencyCode, PairHistory, Snapshot } from '../types'
import { mockHistory, mockSnapshot } from './mock'

export const USING_SAMPLE_DATA = true

export async function getSnapshot(asOf: string, base: CurrencyCode): Promise<Snapshot> {
  return mockSnapshot(asOf, base)
}

/**
 * Past history of one pair up to asOf (Pro view): forecasts, what actually happened, spread, rate.
 * Real data: the team's replay export (decisions doc, question 8) — forecasts AND actuals per step.
 */
export async function getHistory(pair: string, asOf: string, hours: number): Promise<PairHistory | null> {
  return mockHistory(pair, asOf, hours)
}
