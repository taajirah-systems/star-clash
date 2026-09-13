import { describe, it, expect } from 'vitest'
import {
  startRun, currentOpponent, clearStage, useContinue,
  difficultyForStage, isFinalStage, stageCount, stageLabel,
} from '../src/game/arcade'
import { Difficulty } from '../src/core/ai'
import { ROSTER } from '../src/data/roster'

describe('arcade ladder', () => {
  it('fights every other character exactly once, then a mirror', () => {
    for (let c = 0; c < ROSTER.length; c++) {
      const run = startRun(c, Difficulty.Veteran)
      expect(run.opponents).toHaveLength(ROSTER.length)
      expect(run.opponents[run.opponents.length - 1], 'final stage should be a mirror').toBe(c)
      const others = run.opponents.slice(0, -1).sort()
      expect(others).toEqual(ROSTER.map((_, i) => i).filter((i) => i !== c))
    }
  })

  it('builds the same ladder for the same seed and a different one otherwise', () => {
    const a = startRun(0, Difficulty.Veteran, 0x1111)
    const b = startRun(0, Difficulty.Veteran, 0x1111)
    const c = startRun(0, Difficulty.Veteran, 0x2222)
    expect(a.opponents).toEqual(b.opponents)
    expect(a.opponents.slice(0, -1)).not.toEqual(c.opponents.slice(0, -1))
  })

  it('walks the whole ladder and reports completion once', () => {
    const run = startRun(1, Difficulty.Rookie)
    const seen: number[] = []
    for (let i = 0; i < stageCount(run); i++) {
      seen.push(currentOpponent(run))
      const more = clearStage(run)
      expect(more).toBe(i < stageCount(run) - 1)
    }
    expect(seen).toEqual([...run.opponents])
    expect(run.cleared).toBe(true)
  })

  it('ramps difficulty across the run and finishes at Elite', () => {
    const run = startRun(0, Difficulty.Rookie)
    const tiers: Difficulty[] = []
    for (let i = 0; i < stageCount(run); i++) {
      tiers.push(difficultyForStage(run))
      clearStage(run)
    }
    expect(tiers[0]).toBe(Difficulty.Rookie)
    expect(tiers[tiers.length - 1]).toBe(Difficulty.Elite)
    // Never gets easier as the ladder goes on.
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!).toBeGreaterThanOrEqual(tiers[i - 1]!)
    }
  })

  it('never exceeds Elite even when started there', () => {
    const run = startRun(0, Difficulty.Elite)
    for (let i = 0; i < stageCount(run); i++) {
      expect(difficultyForStage(run)).toBe(Difficulty.Elite)
      clearStage(run)
    }
  })

  it('counts continues without advancing the stage', () => {
    const run = startRun(2, Difficulty.Veteran)
    const opponent = currentOpponent(run)
    useContinue(run)
    useContinue(run)
    expect(run.continuesUsed).toBe(2)
    expect(run.stage).toBe(0)
    expect(currentOpponent(run)).toBe(opponent)
  })

  it('labels the last stage as the final one', () => {
    const run = startRun(3, Difficulty.Veteran)
    expect(isFinalStage(run)).toBe(false)
    expect(stageLabel(run)).toContain('STAGE 1')
    while (clearStage(run)) { /* advance */ }
    expect(isFinalStage(run)).toBe(true)
    expect(stageLabel(run)).toBe('FINAL STAGE')
  })
})
