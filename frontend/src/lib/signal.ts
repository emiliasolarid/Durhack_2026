/**
 * The model's Buy / Sell / Hold signal for a pair (the "Buy / Sell" map layer).
 *
 * Rule (models/signal.py, computed by the forecast server, never in the browser):
 *   expected move = (2 × P(up) − 1) × forecast vol × √(2/π)
 *   BUY if it is above the forecast spread, SELL if below minus the spread, otherwise HOLD.
 *   A call then stays on until the expected move drops under half the spread (steady_signal), so it doesn't flicker.
 * BUY EUR/USD means buy EUR and sell USD. It is a model output, not advice.
 */
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import type { CurrencyCode, PairSnapshot, SignalAction } from '../types'
import { slashPair } from './pro'

export interface SignalInfo {
  action: SignalAction
  name: string
  meaning: string
  Icon: LucideIcon
  textClass: string // Tailwind colour class from the @theme tokens
  colorVar: string // CSS variable, for the globe (WebGL can't use classes)
}

export const SIGNALS: SignalInfo[] = [
  { action: 'buy', name: 'Buy', meaning: 'Expected rise beats the cost', Icon: TrendingUp, textClass: 'text-buy', colorVar: '--color-buy' },
  { action: 'sell', name: 'Sell', meaning: 'Expected fall beats the cost', Icon: TrendingDown, textClass: 'text-sell', colorVar: '--color-sell' },
  { action: 'hold', name: 'Hold', meaning: 'Move too small to pay the spread', Icon: Minus, textClass: 'text-hold', colorVar: '--color-hold' },
]

export const SIGNAL_INFO = Object.fromEntries(SIGNALS.map((s) => [s.action, s])) as Record<SignalAction, SignalInfo>

/** The pair's signal, or null when there isn't one (no pair, or the model server is offline) */
export function actionFor(pair: PairSnapshot | undefined): SignalAction | null {
  return pair?.signal?.action ?? null
}

const signed = (bp: number) => `${bp >= 0 ? '+' : '−'}${Math.abs(bp).toFixed(1)}`

/** "BUY USD/JPY: buy USD, sell JPY" / "HOLD USD/JPY" */
export function signalHeadline(pair: PairSnapshot): string | null {
  const action = actionFor(pair)
  if (!action) return null
  const name = `${SIGNAL_INFO[action].name.toUpperCase()} ${slashPair(pair.pair)}`
  if (action === 'buy') return `${name}: buy ${pair.base}, sell ${pair.quote}`
  if (action === 'sell') return `${name}: sell ${pair.base}, buy ${pair.quote}`
  return name
}

/** "expected +1.2 bp vs 0.4 bp cost, next 10 min" */
export function signalDetail(pair: PairSnapshot): string | null {
  const s = pair.signal
  if (!s) return null
  return `expected ${signed(s.expectedMoveBps)} bp vs ${s.hurdleBps.toFixed(1)} bp cost, next ${s.horizonMin} min`
}

/** Short disclaimer shown wherever the signal appears */
export const SIGNAL_DISCLAIMER = 'Model signal, not financial advice'
/** One line on what the signal is based on (hit rate from the team's held-out test) */
export const SIGNAL_BASIS = 'XGBoost forecast on live Yahoo prices · right about 53% of the time on held-out data'

/** The signal seen from one currency: buy or sell `other` with your `from` currency */
export interface SignalFromView {
  action: SignalAction
  from: CurrencyCode
  other: CurrencyCode
  /** Expected move of `other` against `from`, bp (+ = other rises) */
  moveBps: number
  hurdleBps: number
  horizonMin: number
}

/**
 * Turn a pair's signal around so it reads from `from`.
 * BUY USD/JPY means USD up vs JPY, so seen from USD the call on JPY is SELL JPY (JPY expected to fall vs USD).
 * Same model call, just said from your side; null if there's no signal or `from` isn't in the pair.
 */
export function signalFrom(pair: PairSnapshot | undefined, from: CurrencyCode): SignalFromView | null {
  const s = pair?.signal
  if (!pair || !s || (pair.base !== from && pair.quote !== from)) return null
  const other = pair.base === from ? pair.quote : pair.base
  const flip = other === pair.quote
  const action: SignalAction = !flip || s.action === 'hold' ? s.action : s.action === 'buy' ? 'sell' : 'buy'
  return { action, from, other, moveBps: flip ? -s.expectedMoveBps : s.expectedMoveBps, hurdleBps: s.hurdleBps, horizonMin: s.horizonMin }
}

/** "Buy JPY" / "Sell JPY" / "Hold" */
export function signalFromTitle(v: SignalFromView): string {
  return v.action === 'hold' ? 'Hold' : `${SIGNAL_INFO[v.action].name} ${v.other}`
}

/** "JPY expected to rise vs USD" */
export function signalFromMeaning(v: SignalFromView): string {
  if (v.action === 'hold') return 'Expected move smaller than the cost'
  return `${v.other} expected to ${v.action === 'buy' ? 'rise' : 'fall'} vs ${v.from}`
}

/** "expected +1.2 bp vs 0.4 bp cost, next 10 min" (move of `other` against `from`) */
export function signalFromDetail(v: SignalFromView): string {
  return `expected ${signed(v.moveBps)} bp vs ${v.hurdleBps.toFixed(1)} bp cost, next ${v.horizonMin} min`
}

/**
 * The currency to read a pair's signal from, so every place in the UI says the same thing:
 * - your From currency if it's in the pair (USD/JPY seen from USD → "Sell JPY", same as the globe);
 * - else USD if it's in the pair (routes go through USD, so it matches the globe's second leg);
 * - else the pair's second currency (EUR/JPY → "Buy EUR" = the team's "BUY EUR/JPY").
 */
export function heldCurrency(pair: PairSnapshot, from: CurrencyCode): CurrencyCode {
  if (pair.base === from || pair.quote === from) return from
  if (pair.base === 'USD' || pair.quote === 'USD') return 'USD'
  return pair.quote
}

/** Short pair-level wording for traders: "BUY USD/JPY" (same model call, said the market way) */
export function pairCall(pair: PairSnapshot): string | null {
  const action = actionFor(pair)
  return action ? `${action.toUpperCase()} ${pair.base}/${pair.quote}` : null
}
