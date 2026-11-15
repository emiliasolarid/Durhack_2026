/**
 * Simple view, bottom-right: tolerance switch + storm-scale key.
 * - Tolerance (Relaxed / Balanced / Cautious) is the same store value as in the Pro panel.
 * - Each level row says how much of the time it covers for the chosen tolerance
 *   ("busiest 15%" = forecasts in the top 15% of that pair's own history), so switching visibly
 *   changes the key as well as the globe and the ticker.
 * - After a switch, one line says which zones changed level (or that none did right now).
 * Weather word + icon + colour on every level (colour-blind safe).
 */
import { useEffect, useState } from 'react'
import { ZONES } from '../../data/currencies'
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

export default function StormLegend() {
  const tolerance = useAppStore((s) => s.tolerance)
  const snapshot = useAppStore((s) => s.snapshot)
  const base = useAppStore((s) => s.base)
  const [changes, setChanges] = useState<ZoneChange[] | null>(null)

  // The "what changed" note fades away after a few seconds
  useEffect(() => {
    if (!changes) return
    const id = window.setTimeout(() => setChanges(null), CHANGE_NOTE_MS)
    return () => window.clearTimeout(id)
  }, [changes])

  return (
    <section aria-label="Tolerance and volatility scale" className="glass w-[320px] space-y-3 px-4 py-3 text-xs">
      <div className="space-y-1.5">
        <div className="text-ink-muted text-[10px] uppercase tracking-wider">Your tolerance</div>
        <ToleranceSwitch onChange={(from, to) => setChanges(zoneChanges(snapshot, base, from, to))} />
        <p className="text-ink-muted text-[11px] leading-snug" aria-live="polite">
          {TOLERANCE_PLAN[tolerance].simple}
        </p>
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

      <ul aria-label="Volatility scale" className="flex flex-col gap-1.5 border-t border-panel-border pt-2.5">
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
        <li className="text-ink-muted flex items-center gap-2">
          <span className="mx-0.5 size-3 shrink-0 rounded-sm bg-accent" aria-hidden />
          <span className="w-16 shrink-0">From</span>
          <span>Your own currency</span>
        </li>
        <li className="text-ink-muted flex items-center gap-2">
          <span className="mx-0.5 size-3 shrink-0 rounded-sm bg-nodata" aria-hidden />
          <span className="w-16 shrink-0">No data</span>
          <span>No forecast here</span>
        </li>
      </ul>
    </section>
  )
}
