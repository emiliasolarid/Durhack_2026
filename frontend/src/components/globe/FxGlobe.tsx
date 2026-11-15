/**
 * Full-screen interactive globe.
 * - Auto-spins; pauses while you drag; resumes 3 s after you let go (unless something is in focus)
 * - Hover tooltip on every country
 * - Click a country → it's selected and the camera flies there; a lit zone also becomes the "To" currency
 * - The "To" currency's whole zone is highlighted (e.g. every eurozone country for EUR)
 * - Click empty globe or press Esc to clear the selection and resume spinning
 * - Respects the OS "reduce motion" setting (no spin, instant camera moves)
 *
 * - Lit zones are coloured by their volatility level vs the "From" currency (Calm / Unsettled / Storm);
 *   the "From" currency's own zone is the accent colour; zones with no usable data are slate.
 * - "Extreme" zones (forecast ≥ 1.5× normal) are bright red with pulsing warning rings.
 * - Lines (arcs) are kept few so the globe stays readable: your From → To route (or its two legs via USD),
 *   the route to the country you hover, and (Buy / Sell layer) your currency's active buy/sell pairs.
 * - Map layer toggle: "Volatility" (above) or "Buy / Sell": zones and lines go green (buy), red (sell)
 *   or grey (hold) from the model's signal READ FROM YOUR "From" CURRENCY (green Japan = buy JPY with
 *   your USD), with a pulsing ring on each country where a buy/sell is on.
 * - A pair picked in the Extreme alert list is drawn bright red (both countries, its line, rings).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { POINT_MARKERS, ZONES, ZONE_BY_COUNTRY, type CurrencyZone, type PointMarker } from '../../data/currencies'
import { countryCode, escapeHtml, type CountryFeature } from '../../lib/geo'
import { usePrefersReducedMotion, useWindowSize } from '../../lib/hooks'
import { slashPair } from '../../lib/pro'
import {
  actionFor,
  SIGNAL_DISCLAIMER,
  signalFrom,
  signalFromDetail,
  signalFromMeaning,
  signalFromTitle,
} from '../../lib/signal'
import { costBand, costRatioPct, LEVEL_INFO, levelFor, volRatio } from '../../lib/storm'
import { cssVar, withAlpha } from '../../lib/theme'
import { findPair, routeLegs, zoneLevel, type ZoneLevel } from '../../lib/zones'
import type { CurrencyCode, MapLayer, PairSnapshot, Snapshot } from '../../types'
import { useAppStore } from '../../store/useAppStore'

const RESUME_SPIN_AFTER_MS = 3000
const FLY_MS = 1200
const SPIN_SPEED = 0.35
const START_VIEW = { lat: 22, lng: 20, altitude: 2.4 }
const FOCUS_ALTITUDE = 1.9
/** px: the globe area starts under the top bar (matches `top-14`) */
const GLOBE_TOP_OFFSET = 56

/** Stable arc geometry between two currency zones (never recreated on timeframe ticks) */
interface StableArc {
  id: string
  base: string
  quote: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

/** Stable ring anchor (only recreated when the set of pulsing locations changes) */
interface StableRing {
  id: string
  lat: number
  lng: number
  zoneCode?: string
  pairId?: string
}

const ZONE_BY_CODE = new Map(ZONES.map((z) => [z.code, z]))

/** Tooltip lines for the Buy / Sell layer, said from the currency you hold (`from`) */
function signalLines(pair: PairSnapshot | undefined, from: CurrencyCode): string[] {
  if (!pair) return [`No signal: no direct pair with ${from}`]
  const view = signalFrom(pair, from)
  if (!view) return ['No signal right now (forecast server offline)']
  return [`${signalFromTitle(view)} · ${signalFromMeaning(view)}`, signalFromDetail(view), SIGNAL_DISCLAIMER]
}

function arcTooltip(pair: PairSnapshot, layer: MapLayer, level: ZoneLevel, from: CurrencyCode): string {
  const lines: string[] = []
  if (layer === 'signal') lines.push(...signalLines(pair, from))
  else if (level === 'nodata' || level === 'home') lines.push('No reliable data right now')
  else lines.push(`${LEVEL_INFO[level].name} · ${LEVEL_INFO[level].volatility.toLowerCase()} (next 30 min)`)
  const body = lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')
  return `<div class="globe-tip"><strong>${escapeHtml(slashPair(pair.pair))}</strong>${body}</div>`
}

function tooltipHtml(
  name: string,
  zone: CurrencyZone | null,
  level: ZoneLevel | undefined,
  snapshot: Snapshot | null,
  from: string,
  layer: MapLayer,
): string {
  const lines: string[] = []
  if (!zone) lines.push('No forecast for this country')
  else if (level === 'home') lines.push(`${zone.code} · your "From" currency`)
  else if (layer === 'signal') lines.push(...signalLines(findPair(snapshot, from, zone.code), from))
  else if (!level || level === 'nodata') lines.push(`${zone.code} · no reliable data right now`)
  else {
    const info = LEVEL_INFO[level]
    lines.push(`${zone.code} · ${info.name} · ${info.volatility.toLowerCase()} (next 30 min)`)
    const pair = findPair(snapshot, from, zone.code)
    const ratio = volRatio(pair)
    if (level === 'extreme' && ratio) lines.push(`⚠ Expected move ≈ ${ratio.toFixed(1)}× its normal size`)
    const band = pair ? costBand(costRatioPct(pair)) : null
    if (band) lines.push(band.label)
  }
  const body = lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')
  return `<div class="globe-tip"><strong>${escapeHtml(name)}</strong>${body}</div>`
}

export default function FxGlobe() {
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const resumeTimer = useRef<number | undefined>(undefined)

  const selectedCode = useAppStore((s) => s.selected?.code ?? null)
  const quote = useAppStore((s) => s.quote)
  // `base` = the currency the map is read from: the country you clicked (viewFrom), else your From.
  // `yourBase` = your From currency (your route, clicks on lines).
  const yourBase = useAppStore((s) => s.base)
  const viewFrom = useAppStore((s) => s.viewFrom)
  const base = viewFrom ?? yourBase
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
  const mapLayer = useAppStore((s) => s.mapLayer)
  const alertPair = useAppStore((s) => s.alertPair)
  const setQuote = useAppStore((s) => s.setQuote)
  const focus = useAppStore((s) => s.focus)
  const selectCountry = useAppStore((s) => s.selectCountry)
  const clearSelection = useAppStore((s) => s.clearSelection)

  const focusRef = useRef(focus) // read by the spin timer, which outlives renders
  useEffect(() => {
    focusRef.current = focus
  }, [focus])

  const reducedMotion = usePrefersReducedMotion()
  const { width, height } = useWindowSize()

  const [countries, setCountries] = useState<CountryFeature[]>([])
  const [loadError, setLoadError] = useState(false)
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Colours come from the @theme tokens in index.css
  const colors = useMemo(
    () => ({
      accent: cssVar('--color-accent', '#7c9cff'),
      ink: cssVar('--color-ink', '#e6ebf5'),
      nodata: cssVar('--color-nodata', '#334155'),
      calm: cssVar('--color-calm', '#2dd4bf'),
      unsettled: cssVar('--color-unsettled', '#fbbf24'),
      storm: cssVar('--color-storm', '#f43f8e'),
      extreme: cssVar('--color-extreme', '#ef4444'),
      buy: cssVar('--color-buy', '#22c55e'),
      sell: cssVar('--color-sell', '#ef4444'),
      hold: cssVar('--color-hold', '#94a3b8'),
    }),
    [],
  )

  // Pair picked in the Extreme alert list: its two currency zones (drawn bright red, on either layer)
  const alertZones = useMemo(() => {
    const p = alertPair ? snapshot?.pairs.find((x) => x.pair === alertPair) : undefined
    return new Set<string>(p ? [p.base, p.quote] : [])
  }, [alertPair, snapshot])
  const alertArcId = useMemo(() => {
    const p = alertPair ? snapshot?.pairs.find((x) => x.pair === alertPair) : undefined
    return p ? `${p.base}-${p.quote}` : null
  }, [alertPair, snapshot])

  // Volatility level of each currency zone, seen from the "From" currency
  const zoneLevels = useMemo(
    () => new Map<string, ZoneLevel>(ZONES.map((z) => [z.code, zoneLevel(snapshot, z.code, base, tolerance)])),
    [snapshot, base, tolerance],
  )

  const levelColor = useCallback(
    (level: ZoneLevel | undefined) => {
      if (level === 'home') return colors.accent
      if (!level || level === 'nodata') return colors.nodata
      return colors[level]
    },
    [colors],
  )

  /** Buy / Sell layer: green, red or grey from the model's signal; slate when there is no signal */
  const signalColor = useCallback(
    (pair: PairSnapshot | undefined) => {
      const action = actionFor(pair)
      return action ? colors[action] : colors.nodata
    },
    [colors],
  )

  /** Buy / Sell layer, read from the currency you hold: green = buy the other currency with it */
  const fromSignalColor = useCallback(
    (pair: PairSnapshot | undefined, from: CurrencyCode) => {
      const view = signalFrom(pair, from)
      return view ? colors[view.action] : colors.nodata
    },
    [colors],
  )

  /** Colour for a country code, or null if it isn't in a currency zone */
  const zoneColor = useCallback(
    (code: string) => {
      const zone = ZONE_BY_COUNTRY.get(code)
      if (!zone) return null
      if (alertZones.has(zone.code)) return colors.extreme
      if (mapLayer === 'volatility') return levelColor(zoneLevels.get(zone.code))
      // Buy / Sell: this zone's currency seen from the "From" currency (same colour as its line)
      return zone.code === base ? colors.accent : fromSignalColor(findPair(snapshot, base, zone.code), base)
    },
    [levelColor, zoneLevels, mapLayer, base, colors, fromSignalColor, snapshot, alertZones],
  )

  // Only rebuild arc objects when the set of currency pairs actually changes
  const pairSignature = useMemo(
    () =>
      (snapshot?.pairs ?? [])
        .map((p) => `${p.base}-${p.quote}`)
        .sort()
        .join('|'),
    [snapshot?.pairs],
  )

  const arcs = useMemo<StableArc[]>(() => {
    return (snapshot?.pairs ?? []).flatMap((pair) => {
      const a = ZONE_BY_CODE.get(pair.base)
      const b = ZONE_BY_CODE.get(pair.quote)
      if (!a || !b) return []
      return [
        {
          id: `${pair.base}-${pair.quote}`,
          base: pair.base,
          quote: pair.quote,
          startLat: a.anchor.lat,
          startLng: a.anchor.lng,
          endLat: b.anchor.lat,
          endLng: b.anchor.lng,
        },
      ]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairSignature])

  // Which lines to draw, each with the currency held on that leg (so its Buy / Sell colour reads from your side):
  // your route, the route to the hovered country, the pair picked in the alert list, and
  // (Buy / Sell) your currency's active buy/sell pairs
  const hoveredZone = hoveredCode ? (ZONE_BY_COUNTRY.get(hoveredCode)?.code ?? null) : null
  const arcFrom = useMemo(() => {
    const m = new Map<string, CurrencyCode>()
    const add = (from: CurrencyCode, to: CurrencyCode | null) => {
      if (!to) return
      for (const leg of routeLegs(snapshot, from, to)) m.set(`${leg.pair.base}-${leg.pair.quote}`, leg.from)
    }
    add(yourBase, quote)
    add(base, hoveredZone)
    if (alertArcId) m.set(alertArcId, alertArcId.split('-')[0])
    if (mapLayer === 'signal') {
      for (const p of snapshot?.pairs ?? []) {
        const view = signalFrom(p, base)
        if (view && view.action !== 'hold') m.set(`${p.base}-${p.quote}`, base)
      }
    }
    return m
  }, [snapshot, base, yourBase, quote, hoveredZone, mapLayer, alertArcId])
  const visibleKey = [...arcFrom.keys()].sort().join('|')

  // Same arc objects as above (so lines don't restart their animation), only the ones worth showing
  const visibleArcs = useMemo(
    () => arcs.filter((a) => visibleKey.split('|').includes(a.id)),
    [arcs, visibleKey],
  )

  /** Arcs on your route (drawn bolder) */
  const routeArcIds = useMemo(
    () => new Set(routeLegs(snapshot, yourBase, quote).map((l) => `${l.pair.base}-${l.pair.quote}`)),
    [snapshot, yourBase, quote],
  )

  const getPairForArc = useCallback(
    (arc: StableArc) => {
      return snapshot?.pairs.find((p) => p.base === arc.base && p.quote === arc.quote)
    },
    [snapshot?.pairs],
  )

  // 1. Load country shapes once (local file, so venue wifi can't break it)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/assets/countries.geojson', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ features: CountryFeature[] }>
      })
      .then((geo) => setCountries(geo.features.filter((f) => countryCode(f.properties) !== 'ATA')))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('[FxGlobe] could not load countries.geojson', err)
        setLoadError(true)
      })
    return () => controller.abort()
  }, [])

  // Pulsing rings (none when "reduce motion" is on):
  // Stabilized by active keys so ringRepeatPeriod runs on its own clock across ticks
  const activeRingKeys = useMemo(() => {
    if (reducedMotion) return ''
    const picked = [...alertZones].filter((c) => ZONE_BY_CODE.has(c)).map((c) => `zone:${c}`)
    if (picked.length) return picked.sort().join('|')
    if (mapLayer === 'volatility') {
      return ZONES.filter((z) => zoneLevels.get(z.code) === 'extreme')
        .map((z) => `zone:${z.code}`)
        .sort()
        .join('|')
    }
    // Buy / Sell: one ring on each country your currency has an active buy/sell call on
    return (snapshot?.pairs ?? [])
      .map((p) => signalFrom(p, base))
      .filter((v) => v && v.action !== 'hold' && ZONE_BY_CODE.has(v.other))
      .map((v) => `zone:${v!.other}`)
      .sort()
      .join('|')
  }, [reducedMotion, mapLayer, zoneLevels, snapshot?.pairs, base, alertZones])

  const rings = useMemo<StableRing[]>(() => {
    if (!activeRingKeys) return []
    return activeRingKeys.split('|').flatMap<StableRing>((key) => {
      if (key.startsWith('zone:')) {
        const code = key.slice(5)
        const z = ZONE_BY_CODE.get(code)
        return z ? [{ id: key, lat: z.anchor.lat, lng: z.anchor.lng, zoneCode: code }] : []
      }
      const pairId = key.slice(5)
      const [baseCode, quoteCode] = pairId.split('-')
      const a = ZONE_BY_CODE.get(baseCode)
      const b = ZONE_BY_CODE.get(quoteCode)
      if (!a || !b) return []
      return [
        { id: `${key}:a`, lat: a.anchor.lat, lng: a.anchor.lng, pairId },
        { id: `${key}:b`, lat: b.anchor.lat, lng: b.anchor.lng, pairId },
      ]
    })
  }, [activeRingKeys])

  const ringColor = useCallback(
    (obj: object) => {
      const ring = obj as StableRing
      return (t: number) => {
        let baseColor = colors.extreme
        if (ring.zoneCode && mapLayer === 'signal' && !alertZones.has(ring.zoneCode)) {
          baseColor = fromSignalColor(findPair(snapshot, base, ring.zoneCode), base)
        }
        if (ring.pairId) {
          const [b, q] = ring.pairId.split('-')
          const pair = snapshot?.pairs.find((p) => p.base === b && p.quote === q)
          baseColor = signalColor(pair)
        }
        return withAlpha(baseColor, Math.max(0, 1 - t))
      }
    },
    [colors.extreme, snapshot, signalColor, mapLayer, alertZones, fromSignalColor, base],
  )

  const arcColor = useCallback(
    (obj: object) => {
      const arc = obj as StableArc
      const pair = getPairForArc(arc)
      if (!pair) return colors.nodata
      if (arc.id === alertArcId) return colors.extreme
      if (mapLayer !== 'signal') return levelColor(levelFor(pair, tolerance))
      const from = arcFrom.get(arc.id)
      return from ? fromSignalColor(pair, from) : colors.nodata
    },
    [getPairForArc, mapLayer, levelColor, tolerance, colors.nodata, colors.extreme, alertArcId, arcFrom, fromSignalColor],
  )

  const arcStroke = useCallback(
    (obj: object) => {
      // The picked alert pair is boldest; your route and your currency's own pairs are bolder than the rest
      const arc = obj as StableArc
      if (arc.id === alertArcId) return 1.4
      return routeArcIds.has(arc.id) || arc.base === base || arc.quote === base ? 0.9 : 0.5
    },
    [alertArcId, routeArcIds, base],
  )

  const arcLabel = useCallback(
    (obj: object) => {
      const pair = getPairForArc(obj as StableArc)
      if (!pair) return ''
      const arc = obj as StableArc
      return arcTooltip(pair, mapLayer, levelFor(pair, tolerance), arcFrom.get(arc.id) ?? base)
    },
    [getPairForArc, mapLayer, tolerance, arcFrom, base],
  )

  /** Clicking a line points the app at that pair (its currency that isn't the "From" one) */
  const handleArcClick = useCallback(
    (obj: object) => {
      const arc = obj as StableArc
      setQuote(
        arc.base === yourBase
          ? arc.quote
          : arc.quote === yourBase
            ? arc.base
            : arc.quote === 'USD'
              ? arc.base
              : arc.quote,
      )
    },
    [setQuote, yourBase],
  )

  // 2. Spin + pause-on-drag, set up once the globe exists
  useEffect(() => {
    const globe = globeRef.current
    if (!ready || !globe) return
    const controls = globe.controls()

    controls.autoRotateSpeed = SPIN_SPEED
    controls.autoRotate = !reducedMotion && !focusRef.current

    const onStart = () => {
      window.clearTimeout(resumeTimer.current)
      controls.autoRotate = false
    }
    const onEnd = () => {
      if (reducedMotion) return
      window.clearTimeout(resumeTimer.current)
      resumeTimer.current = window.setTimeout(() => {
        if (!focusRef.current) controls.autoRotate = true
      }, RESUME_SPIN_AFTER_MS)
    }

    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)
    return () => {
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
      window.clearTimeout(resumeTimer.current)
    }
  }, [ready, reducedMotion])

  // 3. Fly to whatever is in focus (from a globe click OR the convert card); spin again when cleared
  useEffect(() => {
    const globe = globeRef.current
    if (!ready || !globe) return
    if (focus) {
      window.clearTimeout(resumeTimer.current)
      globe.controls().autoRotate = false
      globe.pointOfView({ ...focus, altitude: FOCUS_ALTITUDE }, reducedMotion ? 0 : FLY_MS)
    } else if (!reducedMotion) {
      globe.controls().autoRotate = true
    }
  }, [ready, focus, reducedMotion])

  // Esc clears the selection (but not while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.key === 'Escape' && !target?.closest('input, select, textarea')) clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])

  // 4. Polygon styling (accessors re-run when hover / selection / "To" currency change)
  const isPicked = useCallback((code: string) => alertZones.has(ZONE_BY_COUNTRY.get(code)?.code ?? ''), [alertZones])
  const isActive = useCallback(
    (code: string) =>
      code === hoveredCode || code === selectedCode || ZONE_BY_COUNTRY.get(code)?.code === quote || isPicked(code),
    [hoveredCode, selectedCode, quote, isPicked],
  )

  const capColor = useCallback(
    (obj: object) => {
      const code = countryCode((obj as CountryFeature).properties)
      const color = zoneColor(code)
      if (color) return withAlpha(color, isActive(code) ? 1 : 0.78)
      return withAlpha(colors.nodata, isActive(code) ? 0.75 : 0.35)
    },
    [colors, isActive, zoneColor],
  )

  const sideColor = useCallback(
    (obj: object) => {
      const code = countryCode((obj as CountryFeature).properties)
      const color = zoneColor(code)
      return color ? withAlpha(color, 0.55) : withAlpha(colors.nodata, 0.15)
    },
    [colors, zoneColor],
  )

  const strokeColor = useCallback(
    (obj: object) => {
      const code = countryCode((obj as CountryFeature).properties)
      if (code === selectedCode) return colors.ink
      if (isPicked(code)) return colors.extreme
      return ZONE_BY_COUNTRY.has(code) ? withAlpha(colors.ink, 0.45) : withAlpha(colors.ink, 0.12)
    },
    [colors, selectedCode, isPicked],
  )

  const altitude = useCallback(
    (obj: object) => {
      const code = countryCode((obj as CountryFeature).properties)
      if (code === selectedCode || isPicked(code)) return 0.04
      if (isActive(code)) return 0.03
      return ZONE_BY_COUNTRY.has(code) ? 0.018 : 0.006
    },
    [selectedCode, isActive, isPicked],
  )

  const tooltipFor = useCallback(
    (name: string, code: string) => {
      const zone = ZONE_BY_COUNTRY.get(code) ?? null
      return tooltipHtml(name, zone, zone ? zoneLevels.get(zone.code) : undefined, snapshot, base, mapLayer)
    },
    [zoneLevels, snapshot, base, mapLayer],
  )

  const polygonLabel = useCallback(
    (obj: object) => {
      const p = (obj as CountryFeature).properties
      return tooltipFor(p.NAME, countryCode(p))
    },
    [tooltipFor],
  )

  // 5. Interaction handlers
  const handlePolygonClick = useCallback(
    (obj: object, _event: MouseEvent, coords: { lat: number; lng: number }) => {
      const p = (obj as CountryFeature).properties
      const code = countryCode(p)
      const zone = ZONE_BY_COUNTRY.get(code) ?? null
      // Single-country zones fly to a fixed anchor (so clicking Alaska still centres the US)
      const target = zone && zone.countries.length === 1 ? zone.anchor : coords
      selectCountry({ code, name: p.NAME, zone }, { lat: target.lat, lng: target.lng })
    },
    [selectCountry],
  )

  const handlePolygonHover = useCallback((obj: object | null) => {
    setHoveredCode(obj ? countryCode((obj as CountryFeature).properties) : null)
  }, [])

  const handlePointClick = useCallback(
    (obj: object) => {
      const m = obj as PointMarker
      selectCountry({ code: m.code, name: m.name, zone: ZONE_BY_COUNTRY.get(m.code) ?? null }, { lat: m.lat, lng: m.lng })
    },
    [selectCountry],
  )

  const handlePointHover = useCallback((obj: object | null) => {
    setHoveredCode(obj ? (obj as PointMarker).code : null)
  }, [])

  const handleGlobeReady = useCallback(() => {
    globeRef.current?.pointOfView(START_VIEW, 0)
    setReady(true)
  }, [])

  return (
    // Starts below the top bar, so the globe is centred in the space you can actually see
    <div className="absolute inset-x-0 top-14 bottom-0" aria-label="Interactive globe of FX forecast zones">
      <Globe
        ref={globeRef}
        width={width}
        height={Math.max(0, height - GLOBE_TOP_OFFSET)}
        onGlobeReady={handleGlobeReady}
        // Textures (local copies in public/assets)
        globeImageUrl="/assets/earth-dark.jpg"
        bumpImageUrl="/assets/earth-topology.png"
        backgroundImageUrl="/assets/night-sky.png"
        atmosphereColor={colors.accent}
        atmosphereAltitude={0.18}
        // Countries
        polygonsData={countries}
        polygonCapColor={capColor}
        polygonSideColor={sideColor}
        polygonStrokeColor={strokeColor}
        polygonAltitude={altitude}
        polygonLabel={polygonLabel}
        polygonsTransitionDuration={reducedMotion ? 0 : 250}
        onPolygonClick={handlePolygonClick}
        onPolygonHover={handlePolygonHover}
        // Singapore and Hong Kong (too small to be polygons at this map scale)
        pointsData={POINT_MARKERS}
        pointLat="lat"
        pointLng="lng"
        pointColor={(obj: object) => zoneColor((obj as PointMarker).code) ?? colors.nodata}
        pointAltitude={(obj: object) => (isActive((obj as PointMarker).code) ? 0.05 : 0.025)}
        pointRadius={1.1}
        pointLabel={(obj: object) => tooltipFor((obj as PointMarker).name, (obj as PointMarker).code)}
        onPointClick={handlePointClick}
        onPointHover={handlePointHover}
        // Lines joining the two countries of each pair (independent continuous dash clock)
        arcsData={visibleArcs}
        arcColor={arcColor}
        arcStroke={arcStroke}
        arcAltitudeAutoScale={0.35}
        arcDashLength={reducedMotion ? 1 : 0.45}
        arcDashGap={reducedMotion ? 0 : 0.12}
        arcDashAnimateTime={reducedMotion ? 0 : 2400}
        arcsTransitionDuration={0}
        arcLabel={arcLabel}
        onArcClick={handleArcClick}
        // Warning rings (extreme volatility) or buy/sell pulses (independent ring clock)
        ringsData={rings}
        ringLat="lat"
        ringLng="lng"
        ringColor={ringColor}
        ringMaxRadius={7}
        ringPropagationSpeed={3}
        ringRepeatPeriod={700}
        ringAltitude={0.02}
        // Clicking empty globe clears the selection
        onGlobeClick={clearSelection}
      />
      {loadError && (
        <p role="alert" className="glass absolute top-20 left-1/2 -translate-x-1/2 px-4 py-2 text-sm text-ink-muted">
          Couldn&rsquo;t load the country map. Check that public/assets/countries.geojson exists.
        </p>
      )}
    </div>
  )
}