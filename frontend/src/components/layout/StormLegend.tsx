/**
 * Simple view, top-right (mirrors the Extreme alert card on the left): tolerance switch + storm-scale key.
 * Same card style as the alert card: icon + uppercase title, one plain-English line, then the content.
 * - Tolerance (Relaxed / Balanced / Cautious) is the same store value as in the Pro panel.
 * - Each level row says how much of the time it covers for the chosen tolerance
 *   ("busiest 15%" = forecasts in the top 15% of that pair's own history), so switching visibly
 *   changes the key as well as the globe and the ticker.
 * - After a switch, one line says which zones changed level (or that none did right now).
 * Weather word + icon + colour on every level (colour-blind safe).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Gauge, TrendingUpDown, type LucideIcon } from 'lucide-react'
import { ZONES } from '../../data/currencies'
import { SIGNAL_BASIS, SIGNAL_DISCLAIMER, SIGNAL_INFO } from '../../lib/signal'
import { LEVEL_CUTOFFS, LEVEL_INFO, STORM_LEVELS, type ForecastLevel } from '../../lib/storm'
import { TOLERANCE_PLAN } from '../../lib/pro'
import { zoneLevel, type ZoneLevel } from '../../lib/zones'
import { useAppStore } from '../../store/useAppStore'
import type { Snapshot, Tolerance } from '../../types'
import ToleranceSwitch from './ToleranceSwitch'

const CHANGE_NOTE_MS = 10_000

/** "busiest 15%" etc. from the percentile cut-offs of a tolerance */
function coverage(level: ForecastLevel, tolerance: Tolerance): string {
  const [unsettledFrom, stormFrom] = LEVEL_CUTOFFS[tolerance]
  const pct = (x: number) => `${Math.round(x * 100)}%`
  if (level === 'calm') return `quietest ${pct(unsettledFrom)}`
  if (level === 'unsettled') return `next ${pct(stormFrom - unsettledFrom)}`
  if (level === 'storm') return `busiest ${pct(1 - stormFrom)}`
  return 'always'
}

interface ZoneChange {
  code: string
  from: ZoneLevel
  to: ZoneLevel
}

function zoneChanges(snapshot: Snapshot | null, base: string, from: Tolerance, to: Tolerance): ZoneChange[] {
  return ZONES.filter((z) => z.code !== base)
    .map((z) => ({ code: z.code, from: zoneLevel(snapshot, z.code, base, from), to: zoneLevel(snapshot, z.code, base, to) }))
    .filter((c) => c.from !== c.to)
}

function LevelWord({ level }: { level: ZoneLevel }) {
  if (level === 'home' || level === 'nodata') return <span className="text-ink-muted">No data</span>
  const info = LEVEL_INFO[level]
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${info.textClass}`}>
      <info.Icon className="size-3" aria-hidden />
      {info.name}
    </span>
  )
}

/** The periwinkle row: your own currency, or the country you clicked (map read from its currency) */
function ReferenceRow() {
  const viewFrom = useAppStore((s) => s.viewFrom)
  return (
    <li className="text-ink-muted flex items-center gap-2">
      <span className="mx-0.5 size-3 shrink-0 rounded-sm bg-accent" aria-hidden />
      <span className="w-16 shrink-0">{viewFrom ? 'Seen from' : 'From'}</span>
      <span>{viewFrom ? `${viewFrom}, the country you clicked` : 'Your own currency'}</span>
    </li>
  )
}

/** Card shell shared by both keys: same look as the Extreme alert card (icon + uppercase title + one line) */
function KeyCard({ label, Icon, title, subtitle, children }: { label: string; Icon: LucideIcon; title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="glass w-[min(300px,calc(100vw-2rem))] space-y-3 p-3.5 text-xs [@media(max-height:720px)]:space-y-2 [@media(max-height:720px)]:p-3">
      <div className="space-y-0.5">
        <header className="flex items-center gap-2">
          <Icon className="text-accent size-4 shrink-0" aria-hidden />
          <h2 className="font-display text-ink text-[12px] font-semibold uppercase tracking-wider">{title}</h2>
        </header>
        <p className="text-ink-muted text-[11px] leading-snug" aria-live="polite">
          {subtitle}
        </p>
      </div>
      {children}
    </section>
  )
}

/** Key for the Buy / Sell map layer: every colour is read from your "From" currency */
function SignalLegend() {
  const base = useAppStore((s) => s.viewFrom ?? s.base)
  const hasSignal = useAppStore((s) => s.snapshot?.pairs.some((p) => p.signal) ?? false)
  const rows: { action: 'buy' | 'sell' | 'hold'; meaning: string }[] = [
    { action: 'buy', meaning: `Expected to rise vs ${base}` },
    { action: 'sell', meaning: `Expected to fall vs ${base}` },
    { action: 'hold', meaning: 'Move too small to pay the cost' },
  ]
  return (
    <KeyCard
      label="Buy / Sell key"
      Icon={TrendingUpDown}
      title="Buy / Sell signal"
      subtitle={
        <>
          Model signal for the next 10 min, seen from <span className="num text-ink">{base}</span>
        </>
      }
    >
      <ul aria-label="Signals" className="flex flex-col gap-1.5">
        {rows.map(({ action, meaning }) => {
          const { name, Icon, textClass } = SIGNAL_INFO[action]
          return (
            <li key={action} className="flex items-center gap-2">
              <Icon className={`size-4 shrink-0 ${textClass}`} aria-hidden />
              <span className={`w-16 shrink-0 font-medium ${textClass}`}>{name}</span>
              <span className="text-ink-muted min-w-0 flex-1">{meaning}</span>
            </li>
          )
        })}
        <ReferenceRow />
        <li className="text-ink-muted flex items-center gap-2">
          <span className="mx-0.5 size-3 shrink-0 rounded-sm bg-nodata" aria-hidden />
          <span className="w-16 shrink-0">No signal</span>
          <span>No direct pair with {base}</span>
        </li>
      </ul>
      <div className="border-t border-panel-border pt-2 text-[11px] leading-snug">
        {hasSignal ? (
          <>
            <p className="text-ink font-medium">{SIGNAL_DISCLAIMER}.</p>
            <p className="text-ink-muted">{SIGNAL_BASIS}.</p>
          </>
        ) : (
          <p className="text-ink-muted">No signal right now: the forecast server isn&rsquo;t running.</p>
        )}
      </div>
    </KeyCard>
  )
}

export default function StormLegend() {
  const mapLayer = useAppStore((s) => s.mapLayer)
  return mapLayer === 'signal' ? <SignalLegend /> : <VolatilityLegend />
}

function VolatilityLegend() {
  const tolerance = useAppStore((s) => s.tolerance)
  const snapshot = useAppStore((s) => s.snapshot)
  const base = useAppStore((s) => s.viewFrom ?? s.base)
  const [changes, setChanges] = useState<ZoneChange[] | null>(null)

  // The "what changed" note fades away after a few seconds
  useEffect(() => {
    if (!changes) return
    const id = window.setTimeout(() => setChanges(null), CHANGE_NOTE_MS)
    return () => window.clearTimeout(id)
  }, [changes])

  return (
    <KeyCard label="Tolerance and volatility scale" Icon={Gauge} title="Your tolerance" subtitle={TOLERANCE_PLAN[tolerance].simple}>
      <div className="space-y-1.5">
        <ToleranceSwitch size="md" onChange={(from, to) => setChanges(zoneChanges(snapshot, base, from, to))} />
        {changes && (
          <p className="text-ink-muted text-[11px] leading-snug motion-safe:animate-flash rounded-md px-1 -mx-1" aria-live="polite">
            {changes.length === 0 ? (
              'No zone changes level right now.'
            ) : (
              <>
                <span className="text-ink">Changed: </span>
                {changes.map((c, i) => (
                  <span key={c.code}>
                    {i > 0 && ', '}
                    <span className="num text-ink">{c.code}</span> <LevelWord level={c.from} /> → <LevelWord level={c.to} />
                  </span>
                ))}
              </>
            )}
          </p>
        )}
      </div>

      <div className="text-ink-muted border-t border-panel-border pt-2.5 text-[10px] uppercase tracking-wider [@media(max-height:720px)]:pt-2">
        Map key · volatility, next 30 min
      </div>
      <ul aria-label="Volatility scale" className="-mt-1 flex flex-col gap-1.5 [@media(max-height:720px)]:gap-1">
        {STORM_LEVELS.map(({ level, name, volatility, Icon, textClass }) => (
          <li key={level} className="flex items-center gap-2">
            <Icon className={`size-4 shrink-0 ${textClass}`} aria-hidden />
            <span className={`w-16 shrink-0 font-medium ${textClass}`}>{name}</span>
            <span className="text-ink-muted min-w-0 flex-1 truncate">{volatility}</span>
            <span
              key={`${level}-${tolerance}`}
              title="Share of time a pair is this busy, compared with its own history"
              className="text-ink-muted/80 motion-safe:animate-flash shrink-0 rounded px-1 text-right text-[10px]"
            >
              {coverage(level, tolerance)}
            </span>
          </li>
        ))}
        <ReferenceRow />
        <li className="text-ink-muted flex items-center gap-2">
          <span className="mx-0.5 size-3 shrink-0 rounded-sm bg-nodata" aria-hidden />
          <span className="w-16 shrink-0">No data</span>
          <span>No forecast here</span>
        </li>
      </ul>
    </KeyCard>
  )
}
