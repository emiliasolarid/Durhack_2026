/**
 * Top bar: small brand on the left, a slowly scrolling "conveyor belt" of rates in the middle,
 * last-updated + "Sample data" on the right.
 * Each rate shows its volatility level (icon + word), never an up/down arrow — we don't forecast direction.
 * Hovering pauses the belt; "reduce motion" turns the scrolling off.
 */
import { useMemo } from 'react'
import { USING_SAMPLE_DATA } from '../../data/api'
import ModeToggle from './ModeToggle'
import { decimalsFor } from '../../data/mock'
import { LEVEL_INFO, levelFor, worseLevel } from '../../lib/storm'
import { findPair } from '../../lib/zones'
import { useAppStore } from '../../store/useAppStore'
import type { Snapshot, StormLevel, Tolerance } from '../../types'

interface TickerItem {
  pair: string // "EUR/USD"
  mid: number | null
  level: StormLevel
}

/** The 3 data pairs plus 3 crosses derived through USD */
function tickerItems(snapshot: Snapshot | null, tolerance: Tolerance): TickerItem[] {
  const get = (a: string, b: string) => findPair(snapshot, a, b)
  const eurusd = get('EUR', 'USD')
  const usdjpy = get('USD', 'JPY')
  const usdsgd = get('USD', 'SGD')
  const lvl = (p = eurusd) => levelFor(p, tolerance)
  const both = (x?: number, y?: number, f = (a: number, b: number) => a * b) =>
    x != null && y != null ? f(x, y) : null

  return [
    { pair: 'EUR/USD', mid: eurusd?.mid ?? null, level: lvl(eurusd) },
    { pair: 'USD/JPY', mid: usdjpy?.mid ?? null, level: lvl(usdjpy) },
    { pair: 'USD/SGD', mid: usdsgd?.mid ?? null, level: lvl(usdsgd) },
    { pair: 'EUR/JPY', mid: both(eurusd?.mid, usdjpy?.mid), level: worseLevel(lvl(eurusd), lvl(usdjpy)) },
    { pair: 'EUR/SGD', mid: both(eurusd?.mid, usdsgd?.mid), level: worseLevel(lvl(eurusd), lvl(usdsgd)) },
    { pair: 'SGD/JPY', mid: both(usdjpy?.mid, usdsgd?.mid, (j, s) => j / s), level: worseLevel(lvl(usdjpy), lvl(usdsgd)) },
  ]
}

function TickerEntry({ item, copy = false }: { item: TickerItem; copy?: boolean }) {
  const info = item.level === 'nodata' ? null : LEVEL_INFO[item.level]
  return (
    <li aria-hidden={copy || undefined} className="flex shrink-0 items-center gap-2 px-5">
      <span className="text-ink-muted font-medium">{item.pair}</span>
      <span className="num text-ink">{item.mid == null ? '—' : item.mid.toFixed(decimalsFor(item.pair))}</span>
      {info ? (
        <span className={`flex items-center gap-1 ${info.textClass}`}>
          <info.Icon className="size-3.5" aria-hidden />
          <span>{info.name}</span>
        </span>
      ) : (
        <span className="text-ink-muted">No data</span>
      )}
      <span className="text-ink-faint pl-3" aria-hidden>
        •
      </span>
    </li>
  )
}

function formatUtc(iso: string | undefined): string {
  if (!iso) return '--:--'
  return new Date(iso).toISOString().slice(11, 16) + ' UTC'
}

export default function RatesTicker() {
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
  const items = useMemo(() => tickerItems(snapshot, tolerance), [snapshot, tolerance])

  return (
    <div className="glass flex h-9 items-center overflow-hidden rounded-full text-xs">
      <span className="font-display shrink-0 border-r border-panel-border px-4 font-semibold tracking-tight">
        FX Forecast
      </span>

      {/* The moving belt. Edges fade out so items glide in and out */}
      <div
        className="group relative min-w-0 flex-1 overflow-hidden"
        style={{ maskImage: 'linear-gradient(90deg, transparent, black 6%, black 94%, transparent)' }}
      >
        <ul aria-label="Rates" className="flex w-max motion-safe:animate-ticker group-hover:[animation-play-state:paused]">
          {items.map((item) => (
            <TickerEntry key={item.pair} item={item} />
          ))}
          {/* Second copy for a seamless loop; hidden from screen readers */}
          {items.map((item) => (
            <TickerEntry key={`${item.pair}-copy`} item={item} copy />
          ))}
        </ul>
      </div>

      <span className="text-ink-muted flex shrink-0 items-center gap-2 border-l border-panel-border px-4">
        {USING_SAMPLE_DATA && (
          <span className="rounded-full border border-panel-border px-2 py-0.5 text-[10px] uppercase tracking-wider">
            Sample data
          </span>
        )}
        Updated <span className="num text-ink">{formatUtc(snapshot?.lastUpdated)}</span>
      </span>
      <span className="shrink-0 border-l border-panel-border px-2">
        <ModeToggle />
      </span>
    </div>
  )
}
