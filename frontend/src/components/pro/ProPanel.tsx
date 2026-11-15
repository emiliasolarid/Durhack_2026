/**
 * Pro view: a slim panel on the right with the pair's recent history and more detail.
 * - Now: rate, spread, likely move in the next 30 min (and in money), trading cost
 * - Forecast vs what actually happened (past hours) + how often the forecast range was right
 * - Spread over time, and the hours when this pair is usually busy
 * Never shows or implies which way the rate will go. Labels sample data.
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Info, Scale, Waves, type LucideIcon } from 'lucide-react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { getHistory, USING_SAMPLE_DATA } from '../../data/api'
import { decimalsFor } from '../../data/mock'
import { costBand, costRatioPct, EXTREME_RATIO, LEVEL_INFO, levelFor, volRatio } from '../../lib/storm'
import {
  bpToMoney,
  forecastCheck,
  formatMoney,
  hhmm,
  hourlyProfile,
  planMove,
  routePairs,
  TOLERANCE_PLAN,
  slashPair,
  worstLeg,
} from '../../lib/pro'
import { useAppStore } from '../../store/useAppStore'
import type { PairHistory, PairSnapshot, PairStatus, Tolerance } from '../../types'

const HISTORY_HOURS = 120 // 5 days: enough for the "usual busy hours" view
const RANGES = [3, 12, 24] as const
type RangeH = (typeof RANGES)[number]

const TOLERANCES: { value: Tolerance; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'cautious', label: 'Cautious' },
]

const STATUS_NOTE: Partial<Record<PairStatus, string>> = {
  rollover: 'Daily rollover: quotes are paused for a few minutes. No forecast right now.',
  stale: 'Data delayed: no fresh quotes in the last few minutes. No forecast right now.',
  no_data: 'No data for this pair today.',
  thin: 'Weekend / thin market: fewer quotes than usual, treat the forecast with care.',
}

/* ---------- small building blocks ---------- */

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full border border-panel-border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent ${
            value === o.value ? 'bg-white/12 text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  Icon,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  Icon: LucideIcon
  /** CSS colour for the top edge + glow (the level colour on the move tile) */
  highlight?: string
}) {
  const edge = highlight ?? 'var(--color-accent)'
  return (
    <div
      tabIndex={0}
      title={sub ? `${label}: ${value} (${sub})` : `${label}: ${value}`}
      style={{ ['--edge' as string]: edge }}
      className="group relative min-w-0 cursor-default overflow-hidden rounded-xl border border-panel-border bg-gradient-to-b from-white/[0.07] to-white/[0.02] px-2.5 pt-2.5 pb-2 outline-none transition duration-200 ease-out hover:border-[color-mix(in_oklab,var(--edge)_55%,transparent)] hover:from-white/[0.11] hover:shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--edge)_45%,transparent)] focus-visible:ring-2 focus-visible:ring-accent motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-[1.03]"
    >
      {/* thin coloured edge on top, brighter on hover */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[2px] opacity-50 transition-opacity group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${edge}, transparent)` }}
      />
      <div className="text-ink-muted flex items-center gap-1 truncate text-[9.5px] font-medium uppercase tracking-wide">
        <Icon className="size-3 shrink-0 transition-colors group-hover:text-[var(--edge)]" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="num text-ink mt-1 truncate text-[15px] font-medium transition-colors group-hover:text-white">{value}</div>
      {sub && <div className="text-ink-muted mt-0.5 truncate text-[10px]">{sub}</div>}
    </div>
  )
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="font-display text-ink text-[13px] font-medium">{title}</h3>
      {sub && <span className="text-ink-faint text-[10px]">{sub}</span>}
    </div>
  )
}

function LevelBadge({ pair, tolerance }: { pair: PairSnapshot; tolerance: Tolerance }) {
  const level = levelFor(pair, tolerance)
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="num text-ink-muted text-xs">{slashPair(pair.pair)}</span>
        {level === 'nodata' ? (
          <span className="text-ink-muted text-xs">No forecast right now</span>
        ) : (
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${LEVEL_INFO[level].textClass}`}
            style={{
              background: `color-mix(in oklab, var(${LEVEL_INFO[level].colorVar}) 12%, transparent)`,
              borderColor: `color-mix(in oklab, var(${LEVEL_INFO[level].colorVar}) 35%, transparent)`,
            }}
          >
            {(() => {
              const { Icon } = LEVEL_INFO[level]
              return <Icon className="size-3.5" aria-hidden />
            })()}
            <span className="font-medium">{LEVEL_INFO[level].name}</span>
            <span className="text-ink-muted">· {LEVEL_INFO[level].volatility}</span>
          </span>
        )}
      </div>
      {level === 'extreme' ? (
        <p className="text-ink rounded-lg border border-extreme/50 bg-extreme/15 px-2.5 py-1.5 text-[11px] leading-snug">
          <span className="text-extreme font-semibold">Warning:</span> the next 30 min are likely to move{' '}
          <span className="num font-semibold">{volRatio(pair)?.toFixed(1)}×</span> this pair's normal size (flag at{' '}
          {EXTREME_RATIO}×), either direction. Expect bigger swings than usual.
        </p>
      ) : (
        level !== 'nodata' && (
          <p className="text-ink-muted text-[11px]">
            Busier than <span className="num text-ink">{Math.round(pair.percentile * 100)}%</span> of this pair's usual
            30-min windows.
          </p>
        )
      )}
    </div>
  )
}

/* ---------- chart pieces ---------- */

interface ChartRow {
  ts: number
  forecast: number | null
  plan: number | null
  band: [number, number] | null
  actual: number | null
  spread: number | null
}

const axisTick = { fill: 'var(--color-ink-faint)', fontSize: 10 }

function ChartTip({ active, payload, normal }: TooltipContentProps & { normal?: number }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as ChartRow
  const xNormal = row.actual != null && normal ? row.actual / normal : null
  const fmt = (v: number | null, unit = ' bp') => (v == null ? '—' : `${v.toFixed(2)}${unit}`)
  return (
    <div className="globe-tip chart-tip num">
      <strong className="text-ink">{hhmm(row.ts)} UTC</strong>
      {'forecast' in row && row.forecast !== undefined && (
        <>
          <span>Plan for {fmt(row.plan)}</span>
          <span>
            Forecast {fmt(row.forecast)}
            {row.band && ` (range ${row.band[0].toFixed(1)}–${row.band[1].toFixed(1)})`}
          </span>
          <span>
            Actual {row.actual == null ? 'not known yet' : fmt(row.actual)}
            {xNormal != null && ` · ${xNormal.toFixed(1)}× normal`}
          </span>
          {xNormal != null && xNormal >= EXTREME_RATIO && (
            <span style={{ color: 'var(--color-extreme)' }}>⚠ Extreme window</span>
          )}
        </>
      )}
      <span>Spread {fmt(row.spread)}</span>
    </div>
  )
}

function LegendKey({ dashed, color, label }: { dashed?: boolean; color: string; label: string }) {
  return (
    <span className="text-ink-muted flex items-center gap-1.5 text-[10px]">
      <svg width="18" height="6" aria-hidden>
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  )
}

/* ---------- the panel ---------- */

export default function ProPanel() {
  const snapshot = useAppStore((s) => s.snapshot)
  const asOf = useAppStore((s) => s.asOf)
  const base = useAppStore((s) => s.base)
  const quote = useAppStore((s) => s.quote)
  const amount = useAppStore((s) => s.amount)
  const tolerance = useAppStore((s) => s.tolerance)
  const setTolerance = useAppStore((s) => s.setTolerance)

  const legs = useMemo(() => routePairs(snapshot, base, quote), [snapshot, base, quote])
  const [picked, setPicked] = useState<string | null>(null)
  const pair = legs.find((p) => p.pair === picked) ?? worstLeg(legs, tolerance)
  const [rangeH, setRangeH] = useState<RangeH>(12)

  // Load 5 days of history for the selected pair
  const [history, setHistory] = useState<PairHistory | null>(null)
  useEffect(() => {
    if (!pair) return
    let cancelled = false
    getHistory(pair.pair, asOf, HISTORY_HOURS)
      .then((h) => !cancelled && setHistory(h))
      .catch((err: unknown) => console.error('[data] could not load history', err))
    return () => {
      cancelled = true
    }
  }, [pair?.pair, asOf]) // eslint-disable-line react-hooks/exhaustive-deps

  const nowMs = new Date(asOf).getTime()
  const shown = useMemo(() => {
    if (!history || history.pair !== pair?.pair) return []
    const from = nowMs - rangeH * 3_600_000
    return history.points.filter((p) => new Date(p.t).getTime() >= from)
  }, [history, pair?.pair, rangeH, nowMs])

  const rows: ChartRow[] = useMemo(
    () =>
      shown.map((p) => ({
        ts: new Date(p.t).getTime(),
        forecast: p.volForecast,
        plan: p.volForecast == null ? null : planMove(tolerance, p.volForecast, p.volForecastHigh),
        band: p.volForecastLow != null && p.volForecastHigh != null ? [p.volForecastLow, p.volForecastHigh] : null,
        actual: p.volActual,
        spread: p.spreadBps,
      })),
    [shown, tolerance],
  )
  const check = useMemo(() => forecastCheck(shown, tolerance), [shown, tolerance])
  const normal = pair?.volNormal30m
  const extremeLine = normal ? normal * EXTREME_RATIO : undefined
  // Stretches of time where what actually happened was Extreme (≥ 1.5× normal) → red bands on the chart
  const extremeSpans = useMemo(() => {
    if (!extremeLine) return []
    const spans: [number, number][] = []
    let start: number | null = null
    let last = 0
    for (const r of rows) {
      const hot = r.actual != null && r.actual >= extremeLine
      if (hot && start == null) start = r.ts
      if (!hot && start != null) {
        spans.push([start, last])
        start = null
      }
      last = r.ts
    }
    if (start != null) spans.push([start, last])
    return spans
  }, [rows, extremeLine])
  const hours = useMemo(() => (history ? hourlyProfile(history.points, tolerance) : []), [history, tolerance])
  const nowHour = new Date(asOf).getUTCHours()
  // Stretch the shading across this pair's own quietest → busiest hour so the pattern is readable
  const avgs = hours.map((h) => h.avg).filter((v): v is number => v != null)
  const lo = Math.min(...avgs)
  const span = Math.max(...avgs) - lo || 1

  if (base === quote || !pair) {
    return (
      <aside aria-label="Pro view" className="glass w-[min(380px,calc(100vw-1.5rem))] p-4 text-sm">
        <p className="text-ink-muted">Pick two different currencies to see their history.</p>
      </aside>
    )
  }

  const horizon = pair.forecast.horizonsMin.at(-1) ?? 30
  const forecastMove = pair.forecast.vol.at(-1) ?? 0
  const moveLow = pair.forecast.volLow?.at(-1)
  const moveHigh = pair.forecast.volHigh?.at(-1)
  const plan = TOLERANCE_PLAN[tolerance]
  const move = planMove(tolerance, forecastMove, moveHigh)
  const ratio = costRatioPct(pair, move)
  const level = levelFor(pair, tolerance)
  const levelColor = level === 'nodata' ? 'var(--color-nodata)' : `var(${LEVEL_INFO[level].colorVar})`
  const band = costBand(ratio)
  const statusNote = STATUS_NOTE[pair.status]
  const confident = pair.status === 'live' || pair.status === 'thin'

  return (
    <aside
      aria-label="Pro view"
      className="glass flex max-h-full w-[min(380px,calc(100vw-1.5rem))] flex-col gap-4 overflow-y-auto p-4 [&>*]:shrink-0"
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-ink text-base font-semibold tracking-tight">
            {base} → {quote}
          </h2>
          <Segmented label="Tolerance" options={TOLERANCES} value={tolerance} onChange={setTolerance} />
        </div>
        <p className="text-ink-faint text-[11px] leading-snug">{TOLERANCE_PLAN[tolerance].explain}</p>

        {legs.length > 1 && (
          <div className="space-y-1">
            <p className="text-ink-muted text-[11px]">
              No direct {base}/{quote} data, so this goes through USD. The busier leg sets the level.
            </p>
            <div className="flex gap-1.5">
              {legs.map((leg) => {
                const lvl = levelFor(leg, tolerance)
                const info = lvl === 'nodata' ? null : LEVEL_INFO[lvl]
                return (
                  <button
                    key={leg.pair}
                    type="button"
                    onClick={() => setPicked(leg.pair)}
                    aria-pressed={leg.pair === pair.pair}
                    className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      leg.pair === pair.pair ? 'border-accent text-ink' : 'border-panel-border text-ink-muted hover:text-ink'
                    }`}
                  >
                    {info && <info.Icon className={`size-3 ${info.textClass}`} aria-hidden />}
                    {slashPair(leg.pair)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <LevelBadge pair={pair} tolerance={tolerance} />
        {statusNote && <p className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-ink-muted">{statusNote}</p>}
      </div>

      {/* Now */}
      <div className="grid grid-cols-3 gap-1.5">
        <Stat
          Icon={ArrowLeftRight}
          label="Mid rate"
          value={pair.mid.toFixed(decimalsFor(pair.pair) + 1)}
          sub={slashPair(pair.pair)}
        />
        <Stat Icon={Scale} label="Spread" value={`${pair.spreadBps.toFixed(2)} bp`} sub="bid–ask, now" />
        <Stat
          Icon={Waves}
          label={plan.label}
          value={confident ? `±${move.toFixed(1)} bp` : '—'}
          sub={confident ? `≈ ±${formatMoney(bpToMoney(amount, move), base)} · ${horizon} min` : 'no forecast'}
          highlight={levelColor}
        />
      </div>
      {confident && (
        <p className="text-ink-muted -mt-2 text-[11px] leading-snug">
          On your {formatMoney(amount, base)}, plan for a move of about ±
          <span className="num text-ink">{formatMoney(bpToMoney(amount, move), base)}</span> over the next {horizon} min,
          either direction (forecast {forecastMove.toFixed(1)} bp, likely range {moveLow?.toFixed(1)}–{moveHigh?.toFixed(1)}{' '}
          bp).
          {band && ratio != null && (
            <>
              {' '}
              Spread ≈ {ratio.toFixed(0)}% of that move: <span className="text-ink">{band.label}</span>{' '}
              <span className="text-ink-faint">(provisional bands)</span>.
            </>
          )}
        </p>
      )}

      {/* Range filter */}
      <div className="flex items-center justify-between">
        <span className="text-ink-muted text-[10px] uppercase tracking-wider">History</span>
        <Segmented
          label="History range"
          options={RANGES.map((h) => ({ value: h, label: `${h} h` }))}
          value={rangeH}
          onChange={setRangeH}
        />
      </div>

      {/* Forecast vs actual — the hero chart of the Pro view */}
      <section
        aria-label="Forecast versus actual volatility"
        className="group/chart relative shrink-0 space-y-2 overflow-hidden rounded-xl border border-panel-border bg-gradient-to-b from-[color-mix(in_oklab,var(--color-series-forecast)_9%,transparent)] to-white/[0.015] p-3 transition duration-300 hover:border-[color-mix(in_oklab,var(--color-series-forecast)_45%,transparent)] hover:shadow-[0_14px_36px_-14px_color-mix(in_oklab,var(--color-series-forecast)_70%,transparent)] motion-safe:hover:-translate-y-0.5"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-[2px] opacity-60 transition-opacity group-hover/chart:opacity-100"
          style={{ background: 'linear-gradient(90deg, transparent, var(--color-series-forecast), var(--color-series-actual), transparent)' }}
        />
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-ink text-sm font-semibold tracking-tight">Forecast vs what happened</h3>
            <p className="text-ink-faint text-[10px]">bp moved per {horizon}-min window</p>
          </div>
          {confident && (
            <div className="text-right">
              <div className="num text-ink text-base leading-none font-semibold whitespace-nowrap">
                <span className="text-ink-faint mr-1 text-[10px] font-normal">next</span>
                {forecastMove.toFixed(1)} bp
              </div>
              {normal && (
                <div
                  className={`num mt-1 text-[10px] ${forecastMove / normal >= EXTREME_RATIO ? 'text-extreme font-semibold' : 'text-ink-muted'}`}
                >
                  {forecastMove / normal >= EXTREME_RATIO && '⚠ '}
                  {(forecastMove / normal).toFixed(1)}× normal
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <LegendKey dashed color="var(--color-series-forecast)" label={`${plan.label} · shaded = likely range`} />
          <LegendKey color="var(--color-series-actual)" label="Actual" />
          {normal && <LegendKey dashed color="var(--color-ink-faint)" label="Normal" />}
          {extremeLine && <LegendKey dashed color="var(--color-extreme)" label={`Extreme (${EXTREME_RATIO}× normal)`} />}
        </div>

        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 330, height: 192 }}>
            <ComposedChart data={rows} margin={{ top: 10, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="fill-actual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-series-actual)" stopOpacity={0.38} />
                  <stop offset="100%" stopColor="var(--color-series-actual)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fill-band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-series-forecast)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-series-forecast)" stopOpacity={0.08} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-panel-border)" strokeDasharray="2 4" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => hhmm(v)}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, (max: number) => Math.ceil(Math.max(max, (extremeLine ?? 0) * 1.12))]}
              />
              {/* when what happened was Extreme */}
              {extremeSpans.map(([a, b]) => (
                <ReferenceArea key={a} x1={a} x2={b === a ? a + 5 * 60_000 : b} fill="var(--color-extreme)" fillOpacity={0.16} ifOverflow="hidden" />
              ))}
              {/* the last 30 min: no actual yet */}
              <ReferenceArea
                x1={nowMs - horizon * 60_000}
                x2={nowMs}
                fill="var(--color-ink)"
                fillOpacity={0.05}
                ifOverflow="hidden"
              />
              {normal && (
                <ReferenceLine
                  y={normal}
                  stroke="var(--color-ink-faint)"
                  strokeDasharray="1 3"
                />
              )}
              {extremeLine && (
                <ReferenceLine
                  y={extremeLine}
                  stroke="var(--color-extreme)"
                  strokeDasharray="5 3"
                  strokeOpacity={0.85}
                  label={{ value: `${EXTREME_RATIO}× normal`, position: 'insideTopLeft', fill: 'var(--color-extreme)', fontSize: 9 }}
                />
              )}
              <Area dataKey="band" stroke="none" fill="url(#fill-band)" isAnimationActive={false} activeDot={false} />
              <Area
                dataKey="actual"
                className="chart-glow-actual"
                stroke="var(--color-series-actual)"
                strokeWidth={2}
                fill="url(#fill-actual)"
                isAnimationActive={false}
                activeDot={{ r: 4.5, stroke: 'var(--color-space)', strokeWidth: 2, fill: 'var(--color-series-actual)' }}
              />
              <Line
                dataKey="plan"
                className="chart-glow-forecast"
                stroke="var(--color-series-forecast)"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: 'var(--color-space)', strokeWidth: 2, fill: 'var(--color-series-forecast)' }}
              />
              <ReferenceLine
                x={nowMs}
                stroke="var(--color-ink-muted)"
                strokeDasharray="2 3"
                label={{ value: 'now', position: 'insideTopRight', fill: 'var(--color-ink-muted)', fontSize: 9 }}
              />
              <Tooltip
                content={(props) => <ChartTip {...props} normal={normal} />}
                cursor={{ stroke: 'var(--color-ink-muted)', strokeDasharray: '2 2' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {check ? (
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { k: 'Within your plan', v: `${Math.round(check.withinPlan * 100)}%` },
              { k: 'Inside likely range', v: `${Math.round(check.insideRange * 100)}%` },
              { k: 'Typical miss', v: `±${Math.round(check.typicalMissPct)}%` },
            ].map((c) => (
              <div key={c.k} className="rounded-lg bg-white/[0.04] px-2 py-1.5 text-center">
                <div className="num text-ink text-sm font-medium">{c.v}</div>
                <div className="text-ink-muted text-[9.5px]">{c.k}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink-muted text-[11px]">Not enough finished windows in this range yet.</p>
        )}
        <p className="text-ink-faint text-[10px] leading-snug">
          Last {rangeH} h, {check?.windows ?? 0} finished windows. Grey strip = last {horizon} min, no actual yet.
          {extremeSpans.length > 0 && (
            <>
              {' '}
              <span className="text-extreme">Red bands</span> = what actually happened was Extreme.
            </>
          )}
        </p>
      </section>

      {/* Spread */}
      <section className="space-y-1.5" aria-label="Spread over time">
        <SectionTitle title="Spread" sub="bp, gaps = rollover / no data" />
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 340, height: 80 }}>
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--color-panel-border)" />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
              <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} tickCount={3} />
              <Line dataKey="spread" stroke="var(--color-ink-muted)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <ReferenceLine x={nowMs} stroke="var(--color-ink-muted)" strokeDasharray="2 3" />
              <Tooltip content={ChartTip} cursor={{ stroke: 'var(--color-ink-faint)' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Usual busy hours */}
      <section className="space-y-1.5" aria-label="Usual volatility by hour">
        <SectionTitle title="When it's usually busy" sub="avg volatility by hour, UTC, last 5 days" />
        <div className="grid grid-cols-24 gap-[2px]">
          {hours.map((h) => {
            const info = h.level ? LEVEL_INFO[h.level] : null
            const label = h.avg == null ? 'no data' : `${Math.round(h.avg * 100)}th pct · ${info?.name}`
            return (
              <div
                key={h.hour}
                title={`${String(h.hour).padStart(2, '0')}:00–${String((h.hour + 1) % 24).padStart(2, '0')}:00 UTC · ${label}`}
                aria-label={`${h.hour}:00 UTC, ${label}`}
                className={`h-5 rounded-[3px] ${h.hour === nowHour ? 'ring-1 ring-ink' : ''}`}
                style={{
                  background:
                    h.avg == null
                      ? 'var(--color-nodata)'
                      : `color-mix(in oklab, var(--color-series-forecast) ${Math.round(12 + ((h.avg - lo) / span) * 88)}%, transparent)`,
                }}
              />
            )
          })}
        </div>
        <div className="text-ink-faint flex justify-between text-[10px]">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        <p className="text-ink-muted text-[11px]">Brighter = usually more volatile (vs this pair's quietest hour). Outlined = the current hour. Hover for details.</p>
      </section>

      {/* Honesty footer */}
      <p className="text-ink-faint flex gap-1.5 border-t border-panel-border pt-3 text-[10px] leading-snug">
        <Info className="mt-px size-3 shrink-0" aria-hidden />
        <span>
          We forecast how much a rate may move and what it costs to trade, never which way it will go.
          {USING_SAMPLE_DATA && ' Sample data, not real prices.'}
        </span>
      </p>
    </aside>
  )
}
