import { createMatch, Phase, type MatchState } from '../src/core/state'
import { advanceFrame, type SimConfig } from '../src/core/sim'
import { ARENAS } from '../src/data/roster'
import { fxFrom } from '../src/core/fx'
import type { InputFrame } from '../src/core/input'

export const TRAINING_GRID = ARENAS[1]!

export function config(overrides: Partial<SimConfig> = {}): SimConfig {
  return { arena: TRAINING_GRID, roundsToWin: 2, training: false, ...overrides }
}

/** A match already past the intro, with the fighters placed at `gap` apart. */
export function fight(
  charA: number,
  charB: number,
  gap = 1.0,
  cfg: SimConfig = config(),
): MatchState {
  const m = createMatch(charA, charB, 99, TRAINING_GRID.breakables.length)
  m.phase = Phase.Fight
  m.phaseFrame = 0
  m.fighters[0].x = fxFrom(-gap / 2)
  m.fighters[1].x = fxFrom(gap / 2)
  m.fighters[0].special = 100
  m.fighters[1].special = 100
  void cfg
  return m
}

export function run(
  m: MatchState,
  frames: number,
  p1: (f: number) => InputFrame,
  p2: (f: number) => InputFrame = () => 0,
  cfg: SimConfig = config(),
): void {
  for (let f = 0; f < frames; f++) {
    advanceFrame(m, [p1(f), p2(f)], cfg)
  }
}

/** Deterministic pseudo-random input script; never uses Math.random. */
export function scriptedInputs(seed: number, length: number): InputFrame[] {
  let x = seed >>> 0
  const out: InputFrame[] = []
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    // Mask to the ten real buttons and thin it out so inputs look like play
    // rather than every button held every frame.
    out.push((x & 0x3ff) & (x >>> 11) & 0x3ff)
  }
  return out
}
