/**
 * Compact convert card: amount, what it comes to in the To currency right now (mid-market), From ⇄ To, swap.
 * Only currencies we have forecasts for are offered (USD, EUR, JPY, SGD).
 * Step 5 adds the rate, "you'd receive" and the forecast underneath.
 */
import { useState, type ChangeEvent } from 'react'
import { ArrowLeftRight, MapPin } from 'lucide-react'
import { ZONES } from '../../data/currencies'
import { SIGNAL_DISCLAIMER, SIGNAL_INFO, signalFrom, signalFromDetail, signalFromMeaning, signalFromTitle } from '../../lib/signal'
import { bpToMoney, formatMoney, hhmm, planMove, routePairs, TOLERANCE_PLAN, worstLeg } from '../../lib/pro'
import { LEVEL_INFO, volRatio, type ForecastLevel } from '../../lib/storm'
import { findPair, routeLegs, routeRate, zoneLevel } from '../../lib/zones'
import type { PairStatus } from '../../types'
import { useAppStore } from '../../store/useAppStore'

const MAX_AMOUNT = 1_000_000_000
/** Digits and thousands commas, then optionally a dot and up to 2 decimals. Anything else is ignored. */
const ALLOWED_INPUT = /^[\d,]*(\.\d{0,2})?$/

function formatAmount(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

/** Keep digits and one decimal point; "12,500.5" → 12500.5 (not capped: see the input handler) */
function parseAmount(text: string): number {
  const cleaned = text.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function CurrencySelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (code: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-ink-muted text-[10px] uppercase tracking-wider">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-lg border border-panel-border bg-white/5 px-2.5 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {ZONES.map((z) => (
          <option key={z.code} value={z.code} title={z.name} className="bg-space">
            {z.code}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Amount in `currency` with that currency's usual decimals and its code: "1,557,240 JPY" (never an ambiguous "$") */
function formatIn(value: number, currency: string): string {
  let digits = 2
  try {
    digits = new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    // unknown code: keep 2 decimals
  }
  return `${value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}`
}

/** "155.72" / "1.1028" / "0.78432": enough digits to be useful at any size */
function formatRate(rate: number): string {
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : 5
  return rate.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** One plain sentence per level: the answer for YOUR conversion over the next 30 min (never a direction) */
const VERDICT: Record<ForecastLevel, (ratio: string) => string> = {
  calm: () => 'Quiet for this route: a normal time to convert.',
  unsettled: () => 'A bit busier than usual: the rate may move more than normal.',
  storm: () => 'Busy: bigger swings than usual, either direction. If you can wait, it may settle.',
  extreme: (r) => `Very busy: likely ${r} its normal move, either direction. Consider waiting.`,
}

/** Why there's no verdict right now (rollover / stale / missing data) */
const NO_VERDICT: Partial<Record<PairStatus, string>> = {
  rollover: 'Daily rollover: quotes are paused for a few minutes. No forecast right now.',
  stale: 'No fresh quotes: the market may be closed or the data delayed. No forecast right now.',
  no_data: 'No data for this route today.',
}

/**
 * The answer tile: the verdict for your route (level + one sentence), what your amount comes to at the
 * mid-market rate, and how big a move to plan for on it. Tinted with the level's colour (same as the
 * To country on the globe). Updates as you type, on every refresh and during replay.
 */
function AnswerTile() {
  const amount = useAppStore((s) => s.amount)
  const base = useAppStore((s) => s.base)
  const quote = useAppStore((s) => s.quote)
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
  const rate = routeRate(snapshot, base, quote)
  const viaUsd = routeLegs(snapshot, base, quote).length === 2

  if (base === quote) return null
  if (rate == null) {
    return <p className="text-ink-muted text-[11px]">{snapshot ? `No ${base} → ${quote} rate right now` : 'Loading rates…'}</p>
  }

  // Same level as the To country on the globe (worse leg for routes via USD)
  const zl = zoneLevel(snapshot, quote, base, tolerance)
  const level: ForecastLevel | null = zl === 'home' || zl === 'nodata' ? null : zl
  const info = level ? LEVEL_INFO[level] : null
  const legs = routePairs(snapshot, base, quote)
  const leg = worstLeg(legs, tolerance)
  const forecast = leg?.forecast.vol.at(-1)
  const move = forecast == null ? null : planMove(tolerance, forecast, leg?.forecast.volHigh?.at(-1))
  const ratio = volRatio(leg)
  const reason = legs.map((l) => NO_VERDICT[l.status]).find(Boolean)
  const tint = info ? `var(${info.colorVar})` : 'var(--color-nodata)'

  const value = formatIn(amount * rate, quote)
  const number = value.slice(0, value.lastIndexOf(' '))
  return (
    <div
      aria-live="polite"
      className="group relative space-y-1 overflow-hidden rounded-xl border px-3 pt-2.5 pb-2 transition duration-200 ease-out motion-safe:hover:-translate-y-0.5"
      style={{
        borderColor: `color-mix(in oklab, ${tint} 40%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in oklab, ${tint} 16%, transparent), rgb(255 255 255 / 0.02))`,
        boxShadow: `0 10px 28px -16px ${tint}`,
      }}
    >
      {/* Glowing top edge in the level's colour, like the Pro tiles */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${tint}, transparent)` }} />

      {/* 1. The verdict */}
      <p className="text-ink-muted text-[10px] uppercase tracking-wider">
        Next 30 min · {base} → {quote}
      </p>
      {info && level ? (
        <div>
          <p className={`flex items-center gap-1.5 text-[15px] font-semibold ${info.textClass}`}>
            <info.Icon className="size-4.5 shrink-0" aria-hidden />
            {info.name}
            <span className="text-ink-muted text-[11px] font-normal">· {info.volatility}</span>
          </p>
          <p className="text-ink text-[12px] leading-snug">
            {VERDICT[level](ratio ? `${ratio.toFixed(1)}×` : `${1.5}×`)}
          </p>
        </div>
      ) : (
        <p className="text-ink-muted text-[12px] leading-snug">{reason ?? 'No forecast for this route right now.'}</p>
      )}

      {/* 2. What you'd get */}
      <div className="border-t border-white/[0.06] pt-1.5">
        <p className="text-ink-muted text-[10px] uppercase tracking-wider">You&rsquo;d get about · mid-market</p>
        {/* Re-keyed on every new value so it gives a short glow each time the number changes */}
        <p
          key={value}
          className="num text-ink motion-safe:animate-value-pop flex items-baseline gap-1.5 truncate text-2xl font-semibold tracking-tight"
          title="Mid-market value, before fees and spread"
        >
          <span className="truncate">{number}</span>
          <span className="text-accent-bright text-sm font-semibold">{quote}</span>
        </p>
        <p className="num text-ink-muted truncate text-[11px]">
          1 {base} = {formatRate(rate)} {quote}
          {viaUsd ? ' via USD' : ''} · {hhmm(snapshot?.lastUpdated ?? snapshot?.asOf)} UTC
        </p>
        {/* 3. How big a move to plan for on this amount (tolerance-aware, either direction) */}
        {level && move != null && (
          <p className="text-ink-muted text-[11px]" title="Either direction, over the next 30 min (depends on your tolerance)">
            {TOLERANCE_PLAN[tolerance].label}: <span className="num text-ink">±{formatMoney(bpToMoney(amount, move), base)}</span> on your amount
          </p>
        )}
      </div>
    </div>
  )
}

/** Buy / Sell layer only: the model's call for YOUR route, in one plain sentence (said from the From currency) */
function RouteSignal() {
  const amount = useAppStore((s) => s.amount)
  const base = useAppStore((s) => s.base)
  const quote = useAppStore((s) => s.quote)
  const snapshot = useAppStore((s) => s.snapshot)
  const pair = findPair(snapshot, base, quote)
  const view = signalFrom(pair, base)

  let body
  if (base === quote) body = <p className="text-ink-muted">Pick two different currencies to see a signal.</p>
  else if (!pair) body = <p className="text-ink-muted">No signal for {base} → {quote}: the model has no direct pair.</p>
  else if (!view) body = <p className="text-ink-muted">No signal right now: the forecast server isn&rsquo;t running.</p>
  else {
    const { Icon, textClass } = SIGNAL_INFO[view.action]
    // How big the expected move is on your amount, in the To currency (shows how small 1 bp is)
    const rate = routeRate(snapshot, base, quote)
    const impact = rate == null ? null : Math.abs((amount * rate * view.moveBps) / 10_000)
    body = (
      <>
        <p className={`flex items-center gap-1.5 text-[14px] font-semibold ${textClass}`}>
          <Icon className="size-4 shrink-0" aria-hidden />
          {signalFromTitle(view)}
        </p>
        <p className="text-ink">{signalFromMeaning(view)}</p>
        <p className="num text-ink-muted">{signalFromDetail(view)}</p>
        {impact != null && view.action !== 'hold' && (
          <p className="text-ink-muted">
            On your amount that&rsquo;s about <span className="num text-ink">{formatIn(impact, quote)}</span>
          </p>
        )}
      </>
    )
  }
  return (
    <div aria-live="polite" className="space-y-0.5 rounded-lg border border-panel-border bg-white/[0.03] px-2.5 py-2 text-[11px] leading-snug">
      <p className="text-ink-muted text-[10px] uppercase tracking-wider">Model signal · {base} → {quote}</p>
      {body}
      <p className="text-ink-faint text-[10px]">{SIGNAL_DISCLAIMER}</p>
    </div>
  )
}

export default function ConvertCard() {
  const amount = useAppStore((s) => s.amount)
  const base = useAppStore((s) => s.base)
  const quote = useAppStore((s) => s.quote)
  const selected = useAppStore((s) => s.selected)
  const setAmount = useAppStore((s) => s.setAmount)
  const setBase = useAppStore((s) => s.setBase)
  const setQuote = useAppStore((s) => s.setQuote)
  const swap = useAppStore((s) => s.swap)
  const showSignal = useAppStore((s) => s.mapLayer === 'signal')

  // The text box keeps what you type; the store keeps the number
  const [draft, setDraft] = useState(() => formatAmount(amount))

  return (
    <section aria-label="Convert" className="glass w-[min(280px,calc(100vw-2rem))] space-y-2.5 p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="amount" className="text-ink-muted text-[10px] uppercase tracking-wider">
          Amount
        </label>
        <div className="group/amount relative">
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            onChange={(e) => {
              const text = e.target.value
              if (!ALLOWED_INPUT.test(text)) return // letters, spaces, a 2nd dot… are refused
              const n = parseAmount(text)
              if (n > MAX_AMOUNT) {
                // Over the cap: show the capped number in the box too, so box and conversion always agree
                setDraft(formatAmount(MAX_AMOUNT))
                setAmount(MAX_AMOUNT)
                return
              }
              setDraft(text)
              setAmount(n)
            }}
            onBlur={() => setDraft(formatAmount(amount))}
            className="num h-12 w-full rounded-xl border border-panel-border bg-gradient-to-b from-white/[0.09] to-white/[0.02] pr-16 pl-3 text-xl font-medium text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.07)] outline-none transition duration-200 hover:border-accent/40 focus:border-accent/80 focus:shadow-[0_0_0_3px_rgb(124_156_255/0.18),0_0_24px_-6px_var(--color-accent)]"
          />
          {/* The currency you're converting from, as a glowing chip inside the box */}
          <span
            aria-hidden
            className="num pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent-bright transition group-focus-within/amount:shadow-[0_0_12px_-2px_var(--color-accent)]"
          >
            {base}
          </span>
        </div>
      </div>

      <div className="flex items-end gap-2">
        <CurrencySelect id="from" label="From" value={base} onChange={setBase} />
        <button
          type="button"
          onClick={swap}
          aria-label={`Swap: convert ${quote} to ${base} instead`}
          title="Swap currencies"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-panel-border text-accent transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent outline-none"
        >
          <ArrowLeftRight className="size-4" aria-hidden />
        </button>
        <CurrencySelect id="to" label="To" value={quote} onChange={setQuote} />
      </div>

      <AnswerTile />

      {showSignal && <RouteSignal />}

      <p className="text-ink-muted flex items-center gap-1.5 text-[11px] [@media(max-height:760px)]:hidden" aria-live="polite">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        {selected
          ? selected.zone
            ? `${selected.name} · ${selected.zone.code}`
            : `${selected.name} · no forecast for this country`
          : 'Tip: click a lit country on the globe to pick it'}
      </p>
    </section>
  )
}
