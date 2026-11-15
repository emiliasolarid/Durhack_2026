/**
 * Top bar: small brand on the left, a slowly scrolling "conveyor belt" of rates in the middle,
 * last-updated + "Sample data" on the right.
 * Each rate shows its volatility level (icon + word); in the Buy / Sell map layer it shows the model's signal instead,
 * read from your From currency exactly like the globe (USD/JPY with From USD → "Sell JPY", red like Japan).
 * Hovering pauses the belt; "reduce motion" turns the scrolling off.
 */
import { useMemo } from 'react'
import { USING_SAMPLE_DATA } from '../../data/api'
import LayerToggle from './LayerToggle'
import ModeToggle from './ModeToggle'
import NextUpdate from './NextUpdate'
import { decimalsFor } from '../../data/mock'
import { heldCurrency, SIGNAL_INFO, signalFrom, signalFromTitle } from '../../lib/signal'
import { LEVEL_INFO, levelFor } from '../../lib/storm'
import { useAppStore } from '../../store/useAppStore'
import type { CurrencyCode, SignalAction, Snapshot, StormLevel, Tolerance } from '../../types'

interface TickerItem {
  pair: string // "EUR/USD"
  mid: number | null
  level: StormLevel
  signal: SignalAction | null
  /** "Sell JPY" / "Buy EUR" / "Hold" */
  signalText: string | null
}

/** Every pair the data has (USD pairs first, then crosses), each with its own level and signal */
function tickerItems(snapshot: Snapshot | null, tolerance: Tolerance, from: CurrencyCode): TickerItem[] {
  const pairs = [...(snapshot?.pairs ?? [])].sort(
    (a, b) => Number(!a.pair.includes('USD')) - Number(!b.pair.includes('USD')) || a.pair.localeCompare(b.pair),
  )
  return pairs.map((p) => {
    const view = signalFrom(p, heldCurrency(p, from))
    return {
      pair: `${p.base}/${p.quote}`,
      mid: p.mid,
      level: levelFor(p, tolerance),
      signal: view?.action ?? null,
      signalText: view ? signalFromTitle(view) : null,
    }
  })
}

function TickerEntry({ item, copy = false, showSignal }: { item: TickerItem; copy?: boolean; showSignal: boolean }) {
  // Volatility layer: the weather word. Buy / Sell layer: the model's signal.
  const info = showSignal ? (item.signal ? SIGNAL_INFO[item.signal] : null) : item.level === 'nodata' ? null : LEVEL_INFO[item.level]
  return (
    <li aria-hidden={copy || undefined} className="flex shrink-0 items-center gap-2.5 px-6">
      <span className="text-ink-muted font-medium">{item.pair}</span>
      <span className="num text-ink">{item.mid == null ? '—' : item.mid.toFixed(decimalsFor(item.pair))}</span>
      {info ? (
        <span className={`flex items-center gap-1 ${info.textClass}`}>
          <info.Icon className="size-4" aria-hidden />
          <span>{showSignal ? item.signalText : info.name}</span>
        </span>
      ) : (
        <span className="text-ink-muted">{showSignal ? 'No signal' : 'No data'}</span>
      )}
      <span className="text-ink-faint pl-3" aria-hidden>
        •
      </span>
    </li>
  )
}


export default function RatesTicker() {
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
  const showSignal = useAppStore((s) => s.mapLayer === 'signal')
  const base = useAppStore((s) => s.viewFrom ?? s.base)
  const items = useMemo(() => tickerItems(snapshot, tolerance, base), [snapshot, tolerance, base])

  return (
    <div className="glass flex h-11 items-center overflow-hidden rounded-full text-[13px]">
      <span className="font-display flex shrink-0 items-center gap-2 border-r border-panel-border px-5 text-[15px] font-semibold tracking-tight">
        <span className="size-2 rounded-full bg-accent shadow-[0_0_10px_2px_var(--color-accent)]" aria-hidden />
        FX Forecast
      </span>

      {/* The moving belt. Edges fade out so items glide in and out */}
      <div
        className="group relative min-w-0 flex-1 overflow-hidden"
        style={{ maskImage: 'linear-gradient(90deg, transparent, black 6%, black 94%, transparent)' }}
      >
        <ul aria-label="Rates" className="flex w-max motion-safe:animate-ticker group-hover:[animation-play-state:paused]">
          {items.map((item) => (
            <TickerEntry key={item.pair} item={item} showSignal={showSignal} />
          ))}
          {/* Second copy for a seamless loop; hidden from screen readers */}
          {items.map((item) => (
            <TickerEntry key={`${item.pair}-copy`} item={item} copy showSignal={showSignal} />
          ))}
        </ul>
      </div>

      <span className="text-ink-muted flex shrink-0 items-center gap-2 border-l border-panel-border px-4">
        {USING_SAMPLE_DATA && (
          <span className="rounded-full border border-panel-border px-2 py-0.5 text-[10px] uppercase tracking-wider">
            Sample data
          </span>
        )}
        <NextUpdate />
      </span>
      <span className="flex shrink-0 items-center gap-1.5 border-l border-panel-border px-3">
        <LayerToggle />
      </span>
      <span className="flex shrink-0 items-center border-l border-panel-border px-2">
        <ModeToggle />
      </span>
    </div>
  )
}
