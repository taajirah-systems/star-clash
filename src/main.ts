/**
 * Entry point and game loop.
 *
 * The loop is a fixed-timestep accumulator: the simulation always advances in
 * whole 60 Hz ticks and the renderer interpolates between them. Input is polled
 * immediately before each tick rather than once per animation frame, which is
 * where a frame of avoidable latency usually hides.
 */

import { createMatch, Phase, type MatchState } from './core/state'
import { LocalSession } from './core/rollback'
import type { SimConfig } from './core/sim'
import { ARENAS, characterAt } from './data/roster'
import {
  CompositeSource, GamepadSource, KeyboardSource,
  KEYMAP_P1, KEYMAP_P2, type InputFrame, type InputSource,
} from './core/input'
import { View } from './render/view'
import { Hud } from './ui/hud'
import { CharacterSelect } from './ui/select'

const STEP_MS = 1000 / 60
const MAX_CATCHUP_STEPS = 5
const ROUNDS_TO_WIN = 2

type Screen = 'select' | 'fight'

const app = document.getElementById('app')!
const fightCanvas = document.getElementById('stage') as HTMLCanvasElement
const selectCanvas = document.getElementById('select-stage') as HTMLCanvasElement
const selectRoot = document.getElementById('select-ui')!
const hudRoot = document.getElementById('hud')!
const overlayRoot = document.getElementById('overlay')!
const perfRoot = document.getElementById('perf')!
const modeButton = document.getElementById('mode') as HTMLButtonElement

const sources: [InputSource, InputSource] = [
  new CompositeSource([new KeyboardSource(KEYMAP_P1), new GamepadSource(0)]),
  new CompositeSource([new KeyboardSource(KEYMAP_P2), new GamepadSource(1)]),
]

let screen: Screen = 'select'
let training = false
let showPerf = false
let debugBoxes = false

const select = new CharacterSelect(selectCanvas, selectRoot)

let view: View | null = null
let hud: Hud | null = null
let session: LocalSession | null = null
let cfg: SimConfig | null = null

function setScreen(next: Screen): void {
  screen = next
  app.dataset.screen = next
}

function setMode(next: boolean): void {
  training = next
  modeButton.textContent = training ? 'MODE: TRAINING' : 'MODE: VERSUS'
  modeButton.classList.toggle('training', training)
}

modeButton.addEventListener('click', () => setMode(!training))
setMode(false)

// A backgrounded tab pauses requestAnimationFrame entirely. On return, start
// from a clean slate instead of trying to make up minutes of missed time.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    last = performance.now()
    accumulator = 0
  }
})

window.addEventListener('keydown', (e) => {
  if (e.code === 'F1') { debugBoxes = !debugBoxes; view?.setDebug(debugBoxes); e.preventDefault() }
  if (e.code === 'F2') { showPerf = !showPerf; perfRoot.classList.toggle('visible', showPerf); e.preventDefault() }
  if (e.code === 'Tab' && screen === 'select') { setMode(!training); e.preventDefault() }
})

/* ------------------------------------------------------------------ */
/* Match lifecycle                                                      */
/* ------------------------------------------------------------------ */

function startMatch(p1: number, p2: number): void {
  const arena = ARENAS[training ? 1 : 0]!
  cfg = { arena, roundsToWin: ROUNDS_TO_WIN, training }

  const state: MatchState = createMatch(p1, p2, 99, arena.breakables.length)
  for (const f of state.fighters) f.special = Math.floor(characterAt(f.charIndex).def.specialMax / 2)

  view?.dispose()
  view = new View(fightCanvas, arena, [p1, p2])
  view.setDebug(debugBoxes)
  hud = new Hud(hudRoot, [p1, p2])
  session = new LocalSession(state, cfg)
  overlayRoot.classList.remove('visible')
  setScreen('fight')
}

function showResult(state: MatchState): void {
  const winner = (state.roundsWon[0] ?? 0) > (state.roundsWon[1] ?? 0) ? 0 : 1
  const def = characterAt(state.fighters[winner]!.charIndex).def
  overlayRoot.innerHTML = `
    <div class="result">
      <div class="result-title">${def.name.toUpperCase()} WINS</div>
      <div class="result-score">${state.roundsWon[0]} — ${state.roundsWon[1]}</div>
      <div class="result-actions">
        <span><b>J</b> / <b>Numpad1</b> — Rematch</span>
        <span><b>U</b> / <b>Numpad4</b> — Character Select</span>
      </div>
    </div>`
  overlayRoot.classList.add('visible')
}

/* ------------------------------------------------------------------ */
/* Loop                                                                 */
/* ------------------------------------------------------------------ */

let last = performance.now()
let accumulator = 0
let awaitingSelect = false

// Rolling frame-time window for the perf readout. A single instantaneous
// number is noise; the 1% low is what a player actually feels.
const frameTimes: number[] = []

async function beginSelect(): Promise<void> {
  if (awaitingSelect) return
  awaitingSelect = true
  select.reset()
  setScreen('select')
  const choice = await select.waitForChoice()
  awaitingSelect = false
  startMatch(choice.p1, choice.p2)
}

function pollInputs(): [InputFrame, InputFrame] {
  return [sources[0].poll(), sources[1].poll()]
}

/** `forced` drives the tick from supplied inputs instead of the devices. */
function tickFight(forced?: readonly [InputFrame, InputFrame]): void {
  if (!session || !view || !hud || !cfg) return
  const state = session.state

  if (state.phase === Phase.MatchEnd) {
    const inputs = forced ?? pollInputs()
    // Light = rematch, Throw = back to select. Read directly rather than
    // through the sim, since the sim is finished with this match.
    if ((inputs[0] & 0x01) !== 0 || (inputs[1] & 0x01) !== 0) {
      startMatch(state.fighters[0].charIndex, state.fighters[1].charIndex)
      return
    }
    if ((inputs[0] & 0x08) !== 0 || (inputs[1] & 0x08) !== 0) {
      overlayRoot.classList.remove('visible')
      void beginSelect()
      return
    }
    return
  }

  view.captureFrame(state)
  const inputs = forced ?? pollInputs()
  session.advance(inputs[0], inputs[1])

  // Re-read through the session: the tick above may have ended the match, and
  // the narrowed `state.phase` from the early return above is now stale.
  if (session.state.phase === Phase.MatchEnd) showResult(session.state)
}

function loop(now: number): void {
  requestAnimationFrame(loop)

  const raw = now - last
  last = now
  // Clamped so a backgrounded tab does not come back and simulate 400 frames
  // in one go, which would look like a teleport and could skip a KO.
  const dt = Math.min(raw, 100)
  accumulator += dt

  if (showPerf) {
    frameTimes.push(raw)
    if (frameTimes.length > 180) frameTimes.shift()
  }

  if (screen === 'select') {
    accumulator = 0
    select.update(pollInputs(), dt / 1000)
    return
  }

  let steps = 0
  while (accumulator >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
    tickFight()
    accumulator -= STEP_MS
    steps++
  }
  // Spiral-of-death guard. If the frame took longer than the catch-up budget,
  // the leftover time is discarded rather than carried: keeping it means the
  // next frame owes even more, the debt compounds, and the game never recovers
  // its footing after a single long stall.
  if (steps === MAX_CATCHUP_STEPS && accumulator > STEP_MS) accumulator = 0

  if (session && view && hud && cfg) {
    const alpha = Math.min(1, accumulator / STEP_MS)
    view.render(session.state, alpha, dt / 1000)
    hud.update(session.state, cfg.roundsToWin)
  }

  if (showPerf && frameTimes.length > 10) {
    const sorted = [...frameTimes].sort((a, b) => a - b)
    const avg = frameTimes.reduce((s, v) => s + v, 0) / frameTimes.length
    const low1 = sorted[Math.floor(sorted.length * 0.99)] ?? avg
    perfRoot.textContent =
      `${(1000 / avg).toFixed(0)} fps  ·  avg ${avg.toFixed(1)}ms  ·  1% low ${low1.toFixed(1)}ms  ·  frame ${session?.frame ?? 0}`
  }
}

// Dev-only inspection hook: lets the browser console (and automated checks)
// read the live simulation without reaching into module scope.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__starclash = {
    get session() { return session },
    get state() { return session?.state },
    get cfg() { return cfg },
    get screen() { return screen },
    get view() { return view },
    select,
    /**
     * Advances the match by exactly `n` ticks and draws once. Lets a hidden
     * tab — where requestAnimationFrame never fires — still be driven and
     * screenshotted deterministically.
     *
     * Goes through the real tick rather than calling the session directly, so
     * everything the loop does around a tick (result screen, rematch handling)
     * happens here too and this path cannot quietly drift from the real one.
     */
    step(n = 1, inputs?: [InputFrame, InputFrame]) {
      if (!session || !view || !hud || !cfg) return null
      for (let i = 0; i < n; i++) tickFight(inputs)
      if (session && view && hud && cfg) {
        view.render(session.state, 1, 1 / 60)
        hud.update(session.state, cfg.roundsToWin)
      }
      return session?.state.frame ?? null
    },
  }
}

void beginSelect()
requestAnimationFrame(loop)
