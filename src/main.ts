/**
 * Entry point, mode selection, and the game loop.
 *
 * The loop is a fixed-timestep accumulator: the simulation always advances in
 * whole 60 Hz ticks and the renderer interpolates between them. Input is polled
 * immediately before each tick rather than once per animation frame, which is
 * where a frame of avoidable latency usually hides.
 */

import { createMatch, Phase, type MatchState } from './core/state'
import { LocalSession } from './core/rollback'
import type { SimConfig } from './core/sim'
import { Ai, Difficulty, difficultyName } from './core/ai'
import {
  startRun, currentOpponent, clearStage, useContinue,
  difficultyForStage, stageLabel, type ArcadeRun,
} from './game/arcade'
import { ARENAS, characterAt } from './data/roster'
import {
  CompositeSource, GamepadSource, KeyboardSource,
  KEYMAP_P1, KEYMAP_P2, Btn, type InputFrame, type InputSource,
} from './core/input'
import { View } from './render/view'
import { Hud } from './ui/hud'
import { CharacterSelect } from './ui/select'

const STEP_MS = 1000 / 60
const MAX_CATCHUP_STEPS = 5
const ROUNDS_TO_WIN = 2
const STAGE_SPLASH_SECONDS = 2.4
const CONTINUE_SECONDS = 10

type Mode = 'versus' | 'training' | 'arcade'
type Screen = 'select' | 'fight'
type Overlay = 'none' | 'stage' | 'result' | 'continue' | 'ending'

const app = document.getElementById('app')!
const fightCanvas = document.getElementById('stage') as HTMLCanvasElement
const selectCanvas = document.getElementById('select-stage') as HTMLCanvasElement
const selectRoot = document.getElementById('select-ui')!
const hudRoot = document.getElementById('hud')!
const overlayRoot = document.getElementById('overlay')!
const perfRoot = document.getElementById('perf')!
const modeButton = document.getElementById('mode') as HTMLButtonElement
const difficultyButton = document.getElementById('difficulty') as HTMLButtonElement

const sources: [InputSource, InputSource] = [
  new CompositeSource([new KeyboardSource(KEYMAP_P1), new GamepadSource(0)]),
  new CompositeSource([new KeyboardSource(KEYMAP_P2), new GamepadSource(1)]),
]

let screen: Screen = 'select'
let mode: Mode = 'versus'
let difficulty: Difficulty = Difficulty.Veteran
let overlay: Overlay = 'none'
let overlayTimer = 0
let showPerf = false
let debugBoxes = false

const select = new CharacterSelect(selectCanvas, selectRoot)

let view: View | null = null
let hud: Hud | null = null
let session: LocalSession | null = null
let cfg: SimConfig | null = null
let ai: Ai | null = null
let run: ArcadeRun | null = null

const MODES: Mode[] = ['versus', 'arcade', 'training']

function setScreen(next: Screen): void {
  screen = next
  app.dataset.screen = next
}

function setMode(next: Mode): void {
  mode = next
  modeButton.textContent = `MODE: ${next.toUpperCase()}`
  modeButton.dataset.mode = next
  difficultyButton.hidden = next !== 'arcade'
  select.setSinglePlayer(next === 'arcade')
  select.setHint(
    next === 'arcade'
      ? '<b>P1</b> A/D move · J confirm<br><span class="dim">Fight the roster, then a mirror of yourself. Losing offers a continue.</span>'
      : '<b>P1</b> A/D move · J confirm &nbsp;&nbsp; <b>P2</b> ←/→ move · ; confirm' +
        '<br><span class="dim">Both players confirm to begin. Pick the same fighter for a mirror match.</span>',
  )
}

function setDifficulty(next: Difficulty): void {
  difficulty = next
  difficultyButton.textContent = `CPU: ${difficultyName(next)}`
}

modeButton.addEventListener('click', () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]!))
difficultyButton.addEventListener('click', () => setDifficulty(((difficulty + 1) % 3) as Difficulty))
setMode('versus')
setDifficulty(Difficulty.Veteran)

/**
 * Every shortcut has a letter alternative.
 *
 * On a Mac the function-key row is media and brightness controls unless Fn is
 * held, so an F1-only binding is effectively no binding at all for most
 * laptop users. The letters chosen are ones neither player's controls use.
 */
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1' || e.code === 'KeyB') {
    debugBoxes = !debugBoxes
    view?.setDebug(debugBoxes)
    e.preventDefault()
  }
  if (e.code === 'F2' || e.code === 'KeyN') {
    showPerf = !showPerf
    perfRoot.classList.toggle('visible', showPerf)
    e.preventDefault()
  }
  if ((e.code === 'Tab' || e.code === 'KeyM') && screen === 'select') {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]!)
    e.preventDefault()
  }
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    last = performance.now()
    accumulator = 0
  }
})

/* ------------------------------------------------------------------ */
/* Overlays                                                             */
/* ------------------------------------------------------------------ */

function setOverlay(next: Overlay, html = '', seconds = 0): void {
  overlay = next
  overlayTimer = seconds
  overlayRoot.innerHTML = html
  overlayRoot.classList.toggle('visible', next !== 'none')
}

function nameOf(charIndex: number): string {
  return characterAt(charIndex).def.name.toUpperCase()
}

function showStageSplash(): void {
  if (!run) return
  const opp = currentOpponent(run)
  const def = characterAt(opp).def
  setOverlay(
    'stage',
    `<div class="result">
       <div class="stage-tag">${stageLabel(run)}</div>
       <div class="result-title">${def.name.toUpperCase()}</div>
       <div class="result-score">${def.title} · ${difficultyName(difficultyForStage(run))}</div>
     </div>`,
    STAGE_SPLASH_SECONDS,
  )
}

function showResult(state: MatchState): void {
  const winner = (state.roundsWon[0] ?? 0) > (state.roundsWon[1] ?? 0) ? 0 : 1
  setOverlay(
    'result',
    `<div class="result">
       <div class="result-title">${nameOf(state.fighters[winner]!.charIndex)} WINS</div>
       <div class="result-score">${state.roundsWon[0]} — ${state.roundsWon[1]}</div>
       <div class="result-actions">
         <span><b>J</b> / <b>;</b> — Rematch</span>
         <span><b>U</b> / <b>]</b> — Character Select</span>
       </div>
     </div>`,
  )
}

function showContinue(): void {
  setOverlay(
    'continue',
    `<div class="result">
       <div class="result-title">CONTINUE?</div>
       <div class="continue-count">${CONTINUE_SECONDS}</div>
       <div class="result-actions">
         <span><b>J</b> — Continue</span>
         <span><b>U</b> — Give up</span>
       </div>
     </div>`,
    CONTINUE_SECONDS,
  )
}

function showEnding(): void {
  if (!run) return
  setOverlay(
    'ending',
    `<div class="result">
       <div class="stage-tag">LADDER CLEARED</div>
       <div class="result-title">${nameOf(run.playerChar)}</div>
       <div class="result-score">${run.opponents.length} STAGES · ${run.continuesUsed} CONTINUE${run.continuesUsed === 1 ? '' : 'S'}</div>
       <div class="result-actions"><span><b>J</b> — Character Select</span></div>
     </div>`,
  )
}

/* ------------------------------------------------------------------ */
/* Match lifecycle                                                      */
/* ------------------------------------------------------------------ */

function startMatch(p1: number, p2: number): void {
  const arena = ARENAS[mode === 'training' ? 1 : 0]!
  cfg = { arena, roundsToWin: ROUNDS_TO_WIN, training: mode === 'training' }

  const state: MatchState = createMatch(p1, p2, 99, arena.breakables.length)
  for (const f of state.fighters) f.special = Math.floor(characterAt(f.charIndex).def.specialMax / 2)

  view?.dispose()
  view = new View(fightCanvas, arena, [p1, p2])
  view.setDebug(debugBoxes)
  hud = new Hud(hudRoot, [p1, p2])
  session = new LocalSession(state, cfg)

  if (mode === 'arcade' && run) {
    ai = ai ?? new Ai(1, difficulty)
    ai.setDifficulty(difficultyForStage(run))
    ai.reset()
  } else {
    ai = null
  }

  setOverlay('none')
  setScreen('fight')
}

function onMatchEnd(state: MatchState): void {
  const playerWon = (state.roundsWon[0] ?? 0) > (state.roundsWon[1] ?? 0)
  if (mode !== 'arcade' || !run) {
    showResult(state)
    return
  }
  if (!playerWon) {
    showContinue()
    return
  }
  if (clearStage(run)) showStageSplash()
  else showEnding()
}

/* ------------------------------------------------------------------ */
/* Input                                                                */
/* ------------------------------------------------------------------ */

function pollDevices(): [InputFrame, InputFrame] {
  return [sources[0].poll(), sources[1].poll()]
}

/**
 * Inputs for one simulated tick. In arcade the CPU replaces player two's
 * device entirely — it produces an ordinary InputFrame, so nothing downstream
 * can tell the difference, and the CPU is held to exactly the same rules.
 * Called once per tick, because the AI's plan timers advance on each call.
 */
function tickInputs(state: MatchState): [InputFrame, InputFrame] {
  const p1 = sources[0].poll()
  const p2 = ai ? ai.think(state) : sources[1].poll()
  return [p1, p2]
}

/* ------------------------------------------------------------------ */
/* Loop                                                                 */
/* ------------------------------------------------------------------ */

let last = performance.now()
let accumulator = 0
let awaitingSelect = false
let prevOverlayInput = 0

const frameTimes: number[] = []

async function beginSelect(): Promise<void> {
  if (awaitingSelect) return
  awaitingSelect = true
  run = null
  ai = null
  select.reset()
  setOverlay('none')
  setScreen('select')
  const choice = await select.waitForChoice()
  awaitingSelect = false
  if (mode === 'arcade') {
    run = startRun(choice.p1, difficulty)
    setScreen('fight')
    showStageSplash()
  } else {
    startMatch(choice.p1, choice.p2)
  }
}

/** Overlays own the frame while they are up; the match does not advance. */
function tickOverlay(dt: number): void {
  const inputs = pollDevices()
  const any = inputs[0] | inputs[1]
  const confirm = (any & Btn.Light) !== 0 && (prevOverlayInput & Btn.Light) === 0
  const back = (any & Btn.Throw) !== 0 && (prevOverlayInput & Btn.Throw) === 0
  prevOverlayInput = any

  if (overlayTimer > 0) {
    overlayTimer = Math.max(0, overlayTimer - dt / 1000)
    const counter = overlayRoot.querySelector('.continue-count')
    if (counter) counter.textContent = String(Math.ceil(overlayTimer))
  }

  switch (overlay) {
    case 'stage':
      if (overlayTimer === 0 || confirm) {
        if (run) startMatch(run.playerChar, currentOpponent(run))
      }
      break
    case 'continue':
      if (confirm && run) {
        useContinue(run)
        startMatch(run.playerChar, currentOpponent(run))
      } else if (back || overlayTimer === 0) {
        void beginSelect()
      }
      break
    case 'ending':
      if (confirm) void beginSelect()
      break
    case 'result':
      if (confirm && session) {
        startMatch(session.state.fighters[0].charIndex, session.state.fighters[1].charIndex)
      } else if (back) {
        void beginSelect()
      }
      break
    default:
      break
  }
}

function tickFight(forced?: readonly [InputFrame, InputFrame]): void {
  if (!session || !view || !hud || !cfg) return
  const state = session.state
  if (state.phase === Phase.MatchEnd) return

  view.captureFrame(state)
  const inputs = forced ?? tickInputs(state)
  session.advance(inputs[0], inputs[1])

  // Re-read through the session: the tick above may have ended the match, and
  // the narrowed `state.phase` from the early return is now stale.
  if (session.state.phase === Phase.MatchEnd) onMatchEnd(session.state)
}

function loop(now: number): void {
  requestAnimationFrame(loop)

  const raw = now - last
  last = now
  // Clamped so a backgrounded tab does not come back and simulate hundreds of
  // frames at once, which would look like a teleport and could skip a KO.
  const dt = Math.min(raw, 100)
  accumulator += dt

  if (showPerf) {
    frameTimes.push(raw)
    if (frameTimes.length > 180) frameTimes.shift()
  }

  if (screen === 'select') {
    accumulator = 0
    select.update(pollDevices(), dt / 1000)
    return
  }

  if (overlay !== 'none') {
    accumulator = 0
    tickOverlay(dt)
    if (session && view && hud && cfg) {
      view.render(session.state, 1, dt / 1000)
      hud.update(session.state, cfg.roundsToWin)
    }
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
  // next frame owes even more, the debt compounds, and the game never recovers.
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
      `${(1000 / avg).toFixed(0)} fps · avg ${avg.toFixed(1)}ms · 1% low ${low1.toFixed(1)}ms · frame ${session?.frame ?? 0}`
  }
}

if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__starclash = {
    get session() { return session },
    get state() { return session?.state },
    get cfg() { return cfg },
    get screen() { return screen },
    get overlay() { return overlay },
    get run() { return run },
    get ai() { return ai },
    get view() { return view },
    select,
    setMode,
    setDifficulty,
    tickOverlay,
    /**
     * Advances the match by exactly `n` ticks and draws once. Lets a hidden
     * tab — where requestAnimationFrame never fires — still be driven and
     * screenshotted deterministically. Goes through the real tick so this path
     * cannot quietly drift from the one players take.
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
