/**
 * Bright red warning under the top bar whenever a pair's forecast 30-min move is ≥ 1.5× its normal.
 * Colour + icon + words (colour-blind safe). Clicking "Show" points the globe and panels at that pair.
 * It never says which way the rate will go.
 */
import { TriangleAlert } from 'lucide-react'
import { levelFor, volRatio } from '../../lib/storm'
import { slashPair } from '../../lib/pro'
import { useAppStore } from '../../store/useAppStore'

export default function ExtremeAlert() {
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
  const base = useAppStore((s) => s.base)
  const setQuote = useAppStore((s) => s.setQuote)

  const extreme = (snapshot?.pairs ?? []).filter((p) => levelFor(p, tolerance) === 'extreme')
  if (!extreme.length) return null

  return (
    <div
      role="status"
      className="motion-safe:animate-alarm flex items-center gap-3 rounded-full border border-extreme/70 bg-[color-mix(in_oklab,var(--color-extreme)_22%,var(--color-space))] px-4 py-1.5 text-xs text-ink shadow-[0_0_24px_-4px_var(--color-extreme)] backdrop-blur"
    >
      <TriangleAlert className="text-extreme size-4 shrink-0" aria-hidden />
      <span className="font-display text-extreme font-semibold uppercase tracking-wider">Extreme volatility</span>
      {extreme.map((p) => {
        const other = p.base === base ? p.quote : p.quote === base ? p.base : p.quote === 'USD' ? p.base : p.quote
        return (
          <span key={p.pair} className="flex items-center gap-2">
            <span>
              <span className="num font-medium">{slashPair(p.pair)}</span>: next 30 min likely to move{' '}
              <span className="num font-semibold">{volRatio(p)!.toFixed(1)}×</span> its normal size, either direction
            </span>
            <button
              type="button"
              onClick={() => setQuote(other)}
              className="cursor-pointer rounded-full border border-extreme/60 px-2 py-0.5 text-[11px] font-medium text-ink outline-none transition hover:bg-extreme/25 focus-visible:ring-2 focus-visible:ring-extreme"
            >
              Show
            </button>
          </span>
        )
      })}
    </div>
  )
}
