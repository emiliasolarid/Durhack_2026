/**
 * App state shared by the globe and the panels.
 * Replay: `replay` is set while the app plays back through the last day of data instead of live.
 */
import { create } from 'zustand'
import type { CurrencyCode, MapLayer, ReplayRange, Snapshot, Tolerance, ViewMode } from '../types'
import { HOME_CURRENCY, ZONES, type CurrencyZone } from '../data/currencies'
import { USING_LIVE_DATA } from '../data/api'

export interface SelectedCountry {
  code: string // ISO alpha-3 of the clicked country ("" when chosen from the dropdown)
  name: string
  zone: CurrencyZone | null // null = "No forecast"
}

export interface CameraFocus {
  lat: number
  lng: number
}

/** How often the forecasts refresh. The data is 1-minute bars, so the model updates every minute. */
/** Live Yahoo data refreshes every 15 s (the latest price moves within the minute). */
export const UPDATE_EVERY_MS = USING_LIVE_DATA ? 15_000 : 60_000

/** Replay speeds, in simulated minutes per real second (15 plays a whole day in ~1.5 min) */
export const REPLAY_SPEEDS = [1, 5, 15] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]

export interface ReplayState {
  start: string // ISO
  end: string // ISO
  playing: boolean
  speed: ReplaySpeed
}

interface AppState {
  /** The simulated "now" (the data is historical). The live clock moves it 1 min per real minute. */
  asOf: string
  /** Live updates on (asOf advances every UPDATE_EVERY_MS) or paused */
  live: boolean
  /** Wall-clock time (ms) of the next refresh; drives the countdown */
  nextUpdateAt: number
  setLive: (live: boolean) => void
  /** Advance the simulated clock by one minute (called by the live clock in App) */
  tick: () => void

  /** Set while replaying the last day; null = live. In replay, asOf is the replayed moment. */
  replay: ReplayState | null
  /** Start playing from the beginning of the range */
  startReplay: (range: ReplayRange) => void
  /** Back to live data */
  exitReplay: () => void
  setReplayPlaying: (playing: boolean) => void
  setReplaySpeed: (speed: ReplaySpeed) => void
  /** Jump to a moment inside the range (scrubber) */
  seekReplay: (asOf: string) => void
  /** Move the replayed moment on by `speed` minutes; stops at the end (called once a second) */
  replayTick: () => void
  tolerance: Tolerance
  setTolerance: (tolerance: Tolerance) => void
  /** Simple (everyday) or Pro (history + detail) view */
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  /** What the globe colours show: volatility levels or the Buy / Sell signal */
  mapLayer: MapLayer
  setMapLayer: (mapLayer: MapLayer) => void
  /** Latest data for asOf, from src/data/api.ts. null while loading. */
  snapshot: Snapshot | null
  setSnapshot: (snapshot: Snapshot) => void

  amount: number
  base: CurrencyCode
  quote: CurrencyCode
  selected: SelectedCountry | null
  /** Where the globe camera should be; null = free spin */
  focus: CameraFocus | null

  setAmount: (amount: number) => void
  setBase: (code: CurrencyCode) => void
  setQuote: (code: CurrencyCode) => void
  swap: () => void
  /** Called by the globe when a country is clicked */
  selectCountry: (country: SelectedCountry, focus: CameraFocus) => void
  clearSelection: () => void
  /** Pair picked in the Extreme alert list (e.g. "SGDJPY"): drawn bright red on the globe until cleared */
  alertPair: string | null
  /**
   * The currency the map is read from after you click its country (colours, keys, ticker):
   * click Japan → every country is coloured vs JPY. null = your "From" currency. Your From/To and the
   * converted amount don't change. Cleared by "Back to …", Esc, empty globe, or changing From/To.
   */
  viewFrom: CurrencyCode | null
  setViewFrom: (code: CurrencyCode | null) => void
  /** Point the camera halfway along your From → To route (first load), so you see your route, not the Atlantic */
  focusRoute: () => void
  /**
   * Show a pair from the Extreme alert list: highlight it and fly the camera to it.
   * If the pair includes your From currency, its other currency also becomes "To" (your route).
   * Picking the highlighted pair again clears it.
   */
  showAlertPair: (pair: { pair: string; base: CurrencyCode; quote: CurrencyCode }) => void
}

const zoneOf = (code: CurrencyCode) => ZONES.find((z) => z.code === code)

/** Longitude halfway between two others, the short way round (so Tokyo–Los Angeles goes over the Pacific) */
function midLng(a: number, b: number): number {
  let mid = (a + b) / 2
  if (Math.abs(a - b) > 180) mid += mid > 0 ? -180 : 180
  return mid
}

/** Focus the camera on a currency zone chosen from the dropdowns */
function focusZone(code: CurrencyCode): Pick<AppState, 'selected' | 'focus'> {
  const zone = zoneOf(code)
  if (!zone) return { selected: null, focus: null }
  return { selected: { code: '', name: zone.name, zone }, focus: { ...zone.anchor } }
}

/** Demo moment: USD/JPY stormy, EUR/USD calm, USD/SGD unsettled (mock data). */
export const DEMO_AS_OF = '2026-07-02T18:40:00Z'

const toIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const nowIso = () => toIso(Date.now())
const ms = (iso: string) => new Date(iso).getTime()

export const useAppStore = create<AppState>()((set, get) => ({
  asOf: USING_LIVE_DATA ? nowIso() : DEMO_AS_OF,
  live: true,
  nextUpdateAt: Date.now() + UPDATE_EVERY_MS,
  setLive: (live) => set({ live, nextUpdateAt: Date.now() + UPDATE_EVERY_MS }),
  tick: () =>
    set((s) => ({
      asOf: USING_LIVE_DATA ? nowIso() : new Date(new Date(s.asOf).getTime() + 60_000).toISOString().replace('.000Z', 'Z'),
      nextUpdateAt: Date.now() + UPDATE_EVERY_MS,
    })),

  replay: null,
  startReplay: ({ start, end }) => {
    if (!(ms(end) > ms(start))) return // empty or malformed range: stay live
    set({ replay: { start, end, playing: true, speed: 5 }, asOf: start, live: false, snapshot: null })
  },
  exitReplay: () =>
    set({ replay: null, live: true, snapshot: null, asOf: USING_LIVE_DATA ? nowIso() : DEMO_AS_OF, nextUpdateAt: Date.now() + UPDATE_EVERY_MS }),
  setReplayPlaying: (playing) =>
    set((s) => {
      if (!s.replay) return {}
      // Pressing play at the very end starts again from the beginning
      const restart = playing && ms(s.asOf) >= ms(s.replay.end)
      return { replay: { ...s.replay, playing }, ...(restart ? { asOf: s.replay.start } : {}) }
    }),
  setReplaySpeed: (speed) => set((s) => (s.replay ? { replay: { ...s.replay, speed } } : {})),
  seekReplay: (asOf) =>
    set((s) => {
      if (!s.replay) return {}
      const t = Math.min(ms(s.replay.end), Math.max(ms(s.replay.start), ms(asOf)))
      return Number.isFinite(t) ? { asOf: toIso(t) } : {}
    }),
  replayTick: () =>
    set((s) => {
      if (!s.replay?.playing) return {}
      const next = ms(s.asOf) + s.replay.speed * 60_000
      const end = ms(s.replay.end)
      return next >= end ? { asOf: s.replay.end, replay: { ...s.replay, playing: false } } : { asOf: toIso(next) }
    }),

  tolerance: 'balanced',
  setTolerance: (tolerance) => set({ tolerance }),
  mode: 'simple',
  setMode: (mode) => set({ mode }),
  mapLayer: 'volatility',
  setMapLayer: (mapLayer) => set({ mapLayer }),
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),

  amount: 10_000,
  base: HOME_CURRENCY,
  quote: 'JPY',
  selected: null,
  focus: null,

  setAmount: (amount) => set({ amount }),

  alertPair: null,
  viewFrom: null,
  setViewFrom: (code) => set({ viewFrom: code && code !== get().base ? code : null }),
  focusRoute: () => {
    const { base, quote } = get()
    const a = zoneOf(base)?.anchor
    const b = zoneOf(quote)?.anchor
    if (!a || !b) return
    set({ selected: null, focus: { lat: (a.lat + b.lat) / 2, lng: midLng(a.lng, b.lng) } })
  },

  setBase: (code) => {
    set({ alertPair: null, viewFrom: null })
    const { quote, base } = get()
    // Picking the "To" currency as "From" swaps them, so the camera follows the new "To" (old From)
    if (code === quote) set({ base: code, quote: base, ...focusZone(base) })
    else set({ base: code })
  },

  setQuote: (code) => {
    set({ alertPair: null, viewFrom: null })
    const { base, quote } = get()
    if (code === base) set({ quote: code, base: quote, ...focusZone(code) })
    else set({ quote: code, ...focusZone(code) })
  },

  swap: () => {
    const { base, quote } = get()
    set({ base: quote, quote: base, alertPair: null, viewFrom: null, ...focusZone(base) })
  },

  selectCountry: (country, focus) => {
    const { base } = get()
    const zoneCode = country.zone?.code
    // Clicking a lit zone that isn't the "From" currency makes it the "To" currency AND the currency the
    // map is read from (every other country recoloured vs it); clicking your own From country resets that
    if (zoneCode && zoneCode !== base) set({ quote: zoneCode, viewFrom: zoneCode, selected: country, focus, alertPair: null })
    else set({ selected: country, focus, alertPair: null, viewFrom: null })
  },

  clearSelection: () => set({ selected: null, focus: null, alertPair: null, viewFrom: null }),

  showAlertPair: (p) => {
    const { base, alertPair, setQuote, clearSelection } = get()
    if (alertPair === p.pair) return clearSelection() // second click: back to normal
    if (p.base === base || p.quote === base) {
      // Your currency is in it: the other one becomes "To" (camera flies there), then highlight
      setQuote(p.base === base ? p.quote : p.base)
      set({ alertPair: p.pair })
      return
    }
    // A cross that isn't your route: keep your From/To, just look at it (midway between its two countries)
    const a = zoneOf(p.base)?.anchor
    const b = zoneOf(p.quote)?.anchor
    const focus = a && b ? { lat: (a.lat + b.lat) / 2, lng: midLng(a.lng, b.lng) } : (a ?? b ?? null)
    set({ alertPair: p.pair, selected: null, focus: focus ? { ...focus } : null })
  },
}))
