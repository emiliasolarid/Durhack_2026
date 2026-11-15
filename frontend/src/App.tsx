/**
 * Layout: the globe fills the screen; small panels sit at the edges so it stays visible.
 * Pro mode adds a slim history panel on the right (the globe stays visible on the left/centre).
 * Bottom-centre: replay controls (play back through the last day of data).
 */
import { useEffect, useRef } from 'react'
import FxGlobe from './components/globe/FxGlobe'
import ConvertCard from './components/convert/ConvertCard'
import RatesTicker from './components/layout/RatesTicker'
import StormLegend from './components/layout/StormLegend'
import ProPanel from './components/pro/ProPanel'
import ExtremeAlert from './components/layout/ExtremeAlert'
import ViewFromChip from './components/layout/ViewFromChip'
import MarketStatusChip from './components/layout/MarketStatusChip'
import ReplayBar from './components/layout/ReplayBar'
import { getSnapshot } from './data/api'
import { useAppStore } from './store/useAppStore'

/** Load data for the current simulated "now" whenever it (or the From currency) changes */
function useSnapshotLoader() {
  const asOf = useAppStore((s) => s.asOf)
  const base = useAppStore((s) => s.base)
  const replaying = useAppStore((s) => s.replay !== null)
  const setSnapshot = useAppStore((s) => s.setSnapshot)
  useEffect(() => {
    // Abort the request when asOf moves on, so slow ones don't pile up during replay
    const controller = new AbortController()
    getSnapshot(asOf, base, replaying, controller.signal)
      .then((snap) => {
        if (!controller.signal.aborted) setSnapshot(snap)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) console.error('[data] could not load snapshot', err)
      })
    return () => controller.abort()
  }, [asOf, base, replaying, setSnapshot])
}

/** Live clock: every UPDATE_EVERY_MS the simulated "now" moves on 1 minute and everything refreshes */
function useLiveClock() {
  const live = useAppStore((s) => s.live)
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => {
      const { nextUpdateAt, tick } = useAppStore.getState()
      if (Date.now() >= nextUpdateAt) tick()
    }, 1000)
    return () => window.clearInterval(id)
  }, [live])
}

/** Replay clock: once a second the replayed moment moves on by the chosen speed */
function useReplayClock() {
  const playing = useAppStore((s) => s.replay?.playing ?? false)
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => useAppStore.getState().replayTick(), 1000)
    return () => window.clearInterval(id)
  }, [playing])
}

/** First view: once the first data arrives, fly the camera to your From → To route (once per visit) */
function useIntroFlight() {
  const hasData = useAppStore((s) => s.snapshot != null)
  const done = useRef(false)
  useEffect(() => {
    if (!hasData || done.current) return
    done.current = true
    useAppStore.getState().focusRoute()
  }, [hasData])
}

export default function App() {
  useSnapshotLoader()
  useIntroFlight()
  useLiveClock()
  useReplayClock()
  const mode = useAppStore((s) => s.mode)

  return (
    <div className="relative h-full w-full">
      {/* Globe layer (full screen, behind everything) */}
      <FxGlobe />

      {/* Top: thin rates "conveyor belt" with a small brand */}
      <header className="absolute top-3 left-3 right-3">
        <RatesTicker />
      </header>

      {/* Top-centre: market closed / data delayed, and which currency the map is read from (after a country click) */}
      <div className="pointer-events-none absolute top-17 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 [&>*]:pointer-events-auto">
        <MarketStatusChip />
        <ViewFromChip />
      </div>

      {/* Left column: Extreme alerts (top, shrinks / scrolls to fit) above the convert card (bottom) */}
      <div className="pointer-events-none absolute top-17 bottom-3 left-3 flex flex-col justify-end gap-3 [&>*]:pointer-events-auto">
        <div className="flex min-h-0 flex-1 flex-col">
          <ExtremeAlert />
        </div>
        <div className="shrink-0">
          <ConvertCard />
        </div>
      </div>

      {/* Bottom-centre: replay the last day (kept clear of the Pro panel) */}
      <div
        className={`pointer-events-none absolute bottom-3 left-[304px] flex justify-center [&>*]:pointer-events-auto ${
          mode === 'pro' ? 'right-[400px]' : 'right-[304px]'
        }`}
      >
        <ReplayBar />
      </div>

      {mode === 'pro' ? (
        /* Right: Pro panel (history + detail), between the top bar and the bottom edge */
        <div className="absolute top-17 right-3 bottom-3 flex flex-col">
          <ProPanel />
        </div>
      ) : (
        /* Top-right (mirrors the alert card on the left): tolerance + map key */
        <div className="absolute top-17 right-3 hidden sm:block">
          <StormLegend />
        </div>
      )}
    </div>
  )
}
