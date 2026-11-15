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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { SINGAPORE_MARKER, ZONES, ZONE_BY_COUNTRY, type CurrencyZone } from '../../data/currencies'
import { countryCode, escapeHtml, type CountryFeature } from '../../lib/geo'
import { usePrefersReducedMotion, useWindowSize } from '../../lib/hooks'
import { costBand, costRatioPct, LEVEL_INFO, volRatio } from '../../lib/storm'
import { cssVar, withAlpha } from '../../lib/theme'
import { findPair, zoneLevel, type ZoneLevel } from '../../lib/zones'
import type { Snapshot } from '../../types'
import { useAppStore } from '../../store/useAppStore'

const RESUME_SPIN_AFTER_MS = 3000
const FLY_MS = 1200
const SPIN_SPEED = 0.35
const START_VIEW = { lat: 22, lng: 20, altitude: 2.4 }
const FOCUS_ALTITUDE = 1.9

type SingaporeMarker = typeof SINGAPORE_MARKER

function tooltipHtml(
  name: string,
  zone: CurrencyZone | null,
  level: ZoneLevel | undefined,
  snapshot: Snapshot | null,
  from: string,
): string {
  const lines: string[] = []
  if (!zone) lines.push('No forecast for this country')
  else if (level === 'home') lines.push(`${zone.code} · your "From" currency`)
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
  const base = useAppStore((s) => s.base)
  const snapshot = useAppStore((s) => s.snapshot)
  const tolerance = useAppStore((s) => s.tolerance)
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
      extreme: cssVar('--color-extreme', '#ff2e3b'),
    }),
    [],
  )

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

  /** Colour for a country code, or null if it isn't in a currency zone */
  const zoneColor = useCallback(
    (code: string) => {
      const zone = ZONE_BY_COUNTRY.get(code)
      return zone ? levelColor(zoneLevels.get(zone.code)) : null
    },
    [levelColor, zoneLevels],
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

  const singaporeData = useMemo(() => [SINGAPORE_MARKER], [])

  // Pulsing warning rings on every "Extreme" zone (none when "reduce motion" is on)
  const extremeRings = useMemo(
    () => (reducedMotion ? [] : ZONES.filter((z) => zoneLevels.get(z.code) === 'extreme').map((z) => z.anchor)),
    [zoneLevels, reducedMotion],
  )
  const ringColor = useCallback(() => (t: number) => withAlpha(colors.extreme, Math.max(0, 1 - t)), [colors])

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
  const isActive = useCallback(
    (code: string) =>
      code === hoveredCode || code === selectedCode || ZONE_BY_COUNTRY.get(code)?.code === quote,
    [hoveredCode, selectedCode, quote],
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
      return ZONE_BY_COUNTRY.has(code) ? withAlpha(colors.ink, 0.45) : withAlpha(colors.ink, 0.12)
    },
    [colors, selectedCode],
  )

  const altitude = useCallback(
    (obj: object) => {
      const code = countryCode((obj as CountryFeature).properties)
      if (code === selectedCode) return 0.04
      if (isActive(code)) return 0.03
      return ZONE_BY_COUNTRY.has(code) ? 0.018 : 0.006
    },
    [selectedCode, isActive],
  )

  const tooltipFor = useCallback(
    (name: string, code: string) => {
      const zone = ZONE_BY_COUNTRY.get(code) ?? null
      return tooltipHtml(name, zone, zone ? zoneLevels.get(zone.code) : undefined, snapshot, base)
    },
    [zoneLevels, snapshot, base],
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
      const m = obj as SingaporeMarker
      selectCountry({ code: m.code, name: m.name, zone: ZONE_BY_COUNTRY.get(m.code) ?? null }, { lat: m.lat, lng: m.lng })
    },
    [selectCountry],
  )

  const handlePointHover = useCallback((obj: object | null) => {
    setHoveredCode(obj ? (obj as SingaporeMarker).code : null)
  }, [])

  const handleGlobeReady = useCallback(() => {
    globeRef.current?.pointOfView(START_VIEW, 0)
    setReady(true)
  }, [])

  return (
    <div className="absolute inset-0" aria-label="Interactive globe of FX forecast zones">
      <Globe
        ref={globeRef}
        width={width}
        height={height}
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
        // Singapore (too small to be a polygon at this map scale)
        pointsData={singaporeData}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => zoneColor('SGP') ?? colors.nodata}
        pointAltitude={(obj: object) => (isActive((obj as SingaporeMarker).code) ? 0.05 : 0.025)}
        pointRadius={1.1}
        pointLabel={(obj: object) => tooltipFor((obj as SingaporeMarker).name, 'SGP')}
        onPointClick={handlePointClick}
        onPointHover={handlePointHover}
        // Extreme-volatility warning rings
        ringsData={extremeRings}
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
