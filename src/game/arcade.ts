/**
 * Arcade ladder.
 *
 * A run is a sequence of CPU opponents ending in a mirror of the player's own
 * fighter. Kept as plain data with pure transitions so the flow can be tested
 * without a browser, a renderer, or a running match.
 */

import { Difficulty } from '../core/ai'
import { ROSTER } from '../data/roster'

export interface ArcadeRun {
  playerChar: number
  difficulty: Difficulty
  /** Character index per stage, in order. */
  opponents: readonly number[]
  /** 0-based index into `opponents`. */
  stage: number
  continuesUsed: number
  cleared: boolean
}

/** Deterministic shuffle, so a seed always produces the same ladder. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice()
  let x = (seed || 1) >>> 0
  for (let i = out.length - 1; i > 0; i--) {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    const j = x % (i + 1)
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

export function startRun(playerChar: number, difficulty: Difficulty, seed = 0x1f3a5c7): ArcadeRun {
  const others = ROSTER.map((_, i) => i).filter((i) => i !== playerChar)
  // Every other fighter once, then the player's own mirror as the final stage.
  const opponents = [...shuffle(others, seed), playerChar]
  return { playerChar, difficulty, opponents, stage: 0, continuesUsed: 0, cleared: false }
}

export function currentOpponent(run: ArcadeRun): number {
  return run.opponents[Math.min(run.stage, run.opponents.length - 1)] ?? 0
}

export function isFinalStage(run: ArcadeRun): boolean {
  return run.stage === run.opponents.length - 1
}

export function stageCount(run: ArcadeRun): number {
  return run.opponents.length
}

/**
 * The final stage is always fought at Elite regardless of the chosen tier —
 * a mirror match against your own kit should be the wall at the top of the
 * ladder, not a lap of honour.
 */
export function difficultyForStage(run: ArcadeRun): Difficulty {
  if (isFinalStage(run)) return Difficulty.Elite
  // Earlier stages ramp up by one tier across the run, capped at the ceiling.
  const bump = run.stage >= Math.floor(run.opponents.length / 2) ? 1 : 0
  const tier = Math.min(Difficulty.Elite, run.difficulty + bump)
  return tier as Difficulty
}

/** Advances past a cleared stage. Returns false when the ladder is finished. */
export function clearStage(run: ArcadeRun): boolean {
  if (isFinalStage(run)) {
    run.cleared = true
    return false
  }
  run.stage++
  return true
}

export function useContinue(run: ArcadeRun): void {
  run.continuesUsed++
}

export function stageLabel(run: ArcadeRun): string {
  if (isFinalStage(run)) return 'FINAL STAGE'
  return `STAGE ${run.stage + 1} / ${run.opponents.length}`
}
