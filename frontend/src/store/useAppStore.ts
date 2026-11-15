/**
 * App state shared by the globe and the panels.
 * Replay (step 7) will add playing/speed to this same store.
 */
import { create } from 'zustand'
import type { CurrencyCode, Snapshot, Tolerance, ViewMode } from '../types'
import { HOME_CURRENCY, ZONES, type CurrencyZone } from '../data/currencies'

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
export const UPDATE_EVERY_MS = 60_000

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
  tolerance: Tolerance
  setTolerance: (tolerance: Tolerance) => void
  /** Simple (everyday) or Pro (history + detail) view */
  mode: ViewMode
  setMode: (mode: ViewMode) => void
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
}

const zoneOf = (code: CurrencyCode) => ZONES.find((z) => z.code === code)

/** Focus the camera on a currency zone chosen from the dropdowns */
function focusZone(code: CurrencyCode): Pick<AppState, 'selected' | 'focus'> {
  const zone = zoneOf(code)
  if (!zone) return { selected: null, focus: null }
  return { selected: { code: '', name: zone.name, zone }, focus: { ...zone.anchor } }
}

/** Demo moment: USD/JPY stormy, EUR/USD calm, USD/SGD unsettled (mock data). */
export const DEMO_AS_OF = '2026-07-02T18:40:00Z'

export const useAppStore = create<AppState>()((set, get) => ({
  asOf: DEMO_AS_OF,
  live: true,
  nextUpdateAt: Date.now() + UPDATE_EVERY_MS,
  setLive: (live) => set({ live, nextUpdateAt: Date.now() + UPDATE_EVERY_MS }),
  tick: () =>
    set((s) => ({
      asOf: new Date(new Date(s.asOf).getTime() + 60_000).toISOString().replace('.000Z', 'Z'),
      nextUpdateAt: Date.now() + UPDATE_EVERY_MS,
    })),
  tolerance: 'balanced',
  setTolerance: (tolerance) => set({ tolerance }),
  mode: 'simple',
  setMode: (mode) => set({ mode }),
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),

  amount: 10_000,
  base: HOME_CURRENCY,
  quote: 'JPY',
  selected: null,
  focus: null,

  setAmount: (amount) => set({ amount }),

  setBase: (code) => {
    const { quote, base } = get()
    // Picking the "To" currency as "From" swaps them, so the camera follows the new "To" (old From)
    if (code === quote) set({ base: code, quote: base, ...focusZone(base) })
    else set({ base: code })
  },

  setQuote: (code) => {
    const { base, quote } = get()
    if (code === base) set({ quote: code, base: quote, ...focusZone(code) })
    else set({ quote: code, ...focusZone(code) })
  },

  swap: () => {
    const { base, quote } = get()
    set({ base: quote, quote: base, ...focusZone(base) })
  },

  selectCountry: (country, focus) => {
    const { base } = get()
    const zoneCode = country.zone?.code
    // Clicking a lit zone that isn't the "From" currency makes it the "To" currency
    if (zoneCode && zoneCode !== base) set({ quote: zoneCode, selected: country, focus })
    else set({ selected: country, focus })
  },

  clearSelection: () => set({ selected: null, focus: null }),
}))
