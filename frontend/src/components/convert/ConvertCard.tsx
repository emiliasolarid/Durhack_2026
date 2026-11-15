/**
 * Compact convert card: amount, From ⇄ To, swap.
 * Only currencies we have forecasts for are offered (USD, EUR, JPY, SGD).
 * Step 5 adds the rate, "you'd receive" and the forecast underneath.
 */
import { useState, type ChangeEvent } from 'react'
import { ArrowLeftRight, MapPin } from 'lucide-react'
import { ZONES } from '../../data/currencies'
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

export default function ConvertCard() {
  const amount = useAppStore((s) => s.amount)
  const base = useAppStore((s) => s.base)
  const quote = useAppStore((s) => s.quote)
  const selected = useAppStore((s) => s.selected)
  const setAmount = useAppStore((s) => s.setAmount)
  const setBase = useAppStore((s) => s.setBase)
  const setQuote = useAppStore((s) => s.setQuote)
  const swap = useAppStore((s) => s.swap)

  // The text box keeps what you type; the store keeps the number
  const [draft, setDraft] = useState(() => formatAmount(amount))

  return (
    <section aria-label="Convert" className="glass w-[min(280px,calc(100vw-2rem))] space-y-2.5 p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="amount" className="text-ink-muted text-[10px] uppercase tracking-wider">
          Amount
        </label>
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
          className="num h-10 w-full rounded-lg border border-panel-border bg-white/5 px-2.5 text-lg text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
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

      <p className="text-ink-muted flex items-center gap-1.5 text-[11px]" aria-live="polite">
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
