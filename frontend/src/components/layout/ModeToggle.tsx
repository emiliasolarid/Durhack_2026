/** Simple ↔ Pro switch (sits in the top bar). Pro adds history and detail; Simple stays minimal. */
import { useAppStore } from '../../store/useAppStore'
import type { ViewMode } from '../../types'

const MODES: { mode: ViewMode; label: string; hint: string }[] = [
  { mode: 'simple', label: 'Simple', hint: 'Just the essentials' },
  { mode: 'pro', label: 'Pro', hint: 'History, forecast accuracy and more detail' },
]

export default function ModeToggle() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  return (
    <div role="radiogroup" aria-label="View" className="flex rounded-full border border-panel-border p-0.5">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={mode === m.mode}
          title={m.hint}
          onClick={() => setMode(m.mode)}
          className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent ${
            mode === m.mode ? 'bg-accent text-space' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
