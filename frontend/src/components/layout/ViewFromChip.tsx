/**
 * Shown while the map is read from a country you clicked (store `viewFrom`):
 * "Seen from JPY · colours vs JPY  [Back to USD ✕]". Sits top-centre, between the two side columns.
 */
import { Eye, X } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'

export default function ViewFromChip() {
  const viewFrom = useAppStore((s) => s.viewFrom)
  const base = useAppStore((s) => s.base)
  const mapLayer = useAppStore((s) => s.mapLayer)
  const setViewFrom = useAppStore((s) => s.setViewFrom)
  if (!viewFrom) return null
  return (
    <div
      role="status"
      className="glass flex items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-[12px] shadow-[0_0_18px_-6px_var(--color-accent)]"
    >
      <Eye className="text-accent size-4 shrink-0" aria-hidden />
      <span className="text-ink">
        Seen from <span className="num text-accent-bright font-semibold">{viewFrom}</span>
      </span>
      <span className="text-ink-muted hidden md:inline">
        · {mapLayer === 'signal' ? 'buy / sell' : 'volatility'} of every country vs {viewFrom}
      </span>
      <button
        type="button"
        onClick={() => setViewFrom(null)}
        className="seg-btn seg-sm text-ink! border border-panel-border"
        title={`Colour the map from your own currency (${base}) again`}
      >
        Back to {base}
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
