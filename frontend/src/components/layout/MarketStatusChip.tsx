/**
 * Honest data-freshness chip (top-centre). Shown when the newest quote is more than 20 min old and we're
 * not replaying: "Markets closed for the weekend · last quotes Fri 21:58 UTC" (or "No fresh quotes" on a
 * weekday), with a button straight into Replay, which is the best way to see the app on a closed market.
 */
import { useEffect, useState } from 'react'
import { MoonStar, Play } from 'lucide-react'
import { getReplayRange } from '../../data/api'
import { hhmm } from '../../lib/pro'
import { useAppStore } from '../../store/useAppStore'

/** Older than this (minutes) and we say so */
const STALE_AFTER_MIN = 20

/** FX trades round the clock on weekdays; roughly closed from Fri ~21:00 to Sun ~22:00 UTC (varies with DST) */
function weekendClosed(d: Date): boolean {
  const day = d.getUTCDay()
  const h = d.getUTCHours()
  return day === 6 || (day === 5 && h >= 21) || (day === 0 && h < 22)
}

/** "Fri 21:58" */
function dayTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--'
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${hhmm(iso)}`
}

export default function MarketStatusChip() {
  const lastUpdated = useAppStore((s) => s.snapshot?.lastUpdated)
  const replaying = useAppStore((s) => s.replay != null)
  const asOf = useAppStore((s) => s.asOf)
  const startReplay = useAppStore((s) => s.startReplay)
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  if (replaying || !lastUpdated) return null
  const ageMin = (now - Date.parse(lastUpdated)) / 60_000
  if (!(ageMin > STALE_AFTER_MIN)) return null
  const closed = weekendClosed(new Date(now))

  const replay = () => {
    setLoading(true)
    getReplayRange(asOf)
      .then(startReplay)
      .catch((err: unknown) => console.error('[replay] could not start', err))
      .finally(() => setLoading(false))
  }

  return (
    <div role="status" className="glass flex items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-[12px]">
      <MoonStar className="text-unsettled size-4 shrink-0" aria-hidden />
      <span className="text-ink font-medium">{closed ? 'Markets closed for the weekend' : 'No fresh quotes'}</span>
      <span className="text-ink-muted hidden lg:inline">
        · last quotes <span className="num text-ink">{dayTime(lastUpdated)} UTC</span>
      </span>
      <button type="button" onClick={replay} disabled={loading} className="seg-btn seg-sm border border-panel-border" title="Play back the last trading day">
        <Play className="size-3.5" aria-hidden />
        {loading ? 'Loading…' : 'Replay last day'}
      </button>
    </div>
  )
}
