import { describe, it, expect } from 'vitest'
import { fight, run, config } from './harness'
import { Phase, type MatchState } from '../src/core/state'
import { St } from '../src/core/fsm'
import { Btn } from '../src/core/input'
import { advanceFrame } from '../src/core/sim'
import { ROSTER } from '../src/data/roster'
import { fxFrom } from '../src/core/fx'

const AUREL = 0

/** Runs until `pred` holds or the budget runs out; returns the frames taken. */
function until(m: MatchState, pred: (m: MatchState) => boolean, budget = 2000): number {
  const cfg = config()
  for (let i = 0; i < budget; i++) {
    if (pred(m)) return i
    advanceFrame(m, [0, 0], cfg)
  }
  return -1
}

describe('round and match flow', () => {
  it('runs the intro before the fighters can act', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.phase = Phase.Intro
    m.phaseFrame = 0
    // Attacks pressed during the intro must not land.
    const before = m.fighters[1].health
    run(m, 60, () => Btn.Light)
    expect(m.phase).toBe(Phase.Intro)
    expect(m.fighters[1].health).toBe(before)

    expect(until(m, (s) => s.phase === Phase.Fight)).toBeGreaterThan(0)
  })

  it('ends the round on a KO and banks it to the other fighter', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.fighters[1].health = 20
    run(m, 20, (f) => (f === 0 ? Btn.Heavy : 0))
    expect(m.fighters[1].health).toBeLessThanOrEqual(0)
    expect(m.phase).toBe(Phase.KO)
    expect(m.fighters[1].state).toBe(St.Defeated)

    expect(until(m, (s) => s.roundsWon[0] === 1)).toBeGreaterThan(0)
  })

  it('starts a fresh round with full health after a KO', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.fighters[1].health = 20
    run(m, 20, (f) => (f === 0 ? Btn.Heavy : 0))
    expect(until(m, (s) => s.round === 2 && s.phase === Phase.Intro)).toBeGreaterThan(0)
    expect(m.fighters[0].health).toBe(ROSTER[AUREL]!.health)
    expect(m.fighters[1].health).toBe(ROSTER[AUREL]!.health)
    expect(m.fighters[0].state).toBe(St.Idle)
    expect(m.roundsWon[0]).toBe(1)
  })

  it('ends the match once one side reaches the round target', () => {
    const cfg = config()
    const m = fight(AUREL, AUREL, 1.0, cfg)
    for (let round = 0; round < cfg.roundsToWin; round++) {
      // Wait out the intro, then finish the round. A round reset puts the
      // fighters back at their starting spread, well outside heavy range, so
      // close the gap before swinging.
      until(m, (s) => s.phase === Phase.Fight)
      m.fighters[0].x = fxFrom(-0.5)
      m.fighters[1].x = fxFrom(0.5)
      m.fighters[1].health = 20
      run(m, 24, (f) => (f === 0 ? Btn.Heavy : 0))
      expect(m.phase, `round ${round + 1} should have ended`).toBe(Phase.KO)
      until(m, (s) => s.phase === Phase.RoundEnd || s.phase === Phase.MatchEnd)
    }
    expect(m.roundsWon[0]).toBe(cfg.roundsToWin)
    expect(m.phase).toBe(Phase.MatchEnd)
  })

  it('stops simulating once the match is over', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.phase = Phase.MatchEnd
    const before = { x: m.fighters[0].x, hp: m.fighters[1].health }
    run(m, 120, () => Btn.Heavy | Btn.Right)
    expect(m.fighters[0].x).toBe(before.x)
    expect(m.fighters[1].health).toBe(before.hp)
  })

  it('awards the round to whoever has more health when time expires', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.roundTimerFrames = 2
    m.fighters[0].health = 800
    m.fighters[1].health = 400
    run(m, 4, () => 0)
    expect(m.phase).toBe(Phase.KO)
    expect(until(m, (s) => s.roundsWon[0] === 1)).toBeGreaterThan(0)
  })

  it('replays the round rather than awarding it on a timeout draw', () => {
    const m = fight(AUREL, AUREL, 1.0)
    m.roundTimerFrames = 2
    m.fighters[0].health = 600
    m.fighters[1].health = 600
    run(m, 4, () => 0)
    expect(m.roundsWon[0]).toBe(0)
    expect(m.roundsWon[1]).toBe(0)
    expect(m.phase).toBe(Phase.RoundEnd)
  })

  it('never ends a round in training mode', () => {
    const cfg = config({ training: true })
    const m = fight(AUREL, AUREL, 1.0, cfg)
    m.fighters[1].health = 30
    for (let f = 0; f < 400; f++) {
      advanceFrame(m, [f % 30 === 0 ? Btn.Heavy : 0, 0], cfg)
    }
    expect(m.phase).toBe(Phase.Fight)
    expect(m.roundsWon[0]).toBe(0)
    // Health and special both recover so a player can keep drilling.
    expect(m.fighters[1].health).toBeGreaterThan(0)
    expect(m.fighters[0].special).toBe(ROSTER[AUREL]!.specialMax)
  })

  it('freezes both fighters during hitstop', () => {
    const m = fight(AUREL, AUREL, 1.0)
    run(m, 14, (f) => (f === 0 ? Btn.Heavy : 0))
    expect(m.hitstop).toBeGreaterThan(0)
    const x0 = m.fighters[0].x
    const x1 = m.fighters[1].x
    const frame = m.fighters[0].moveFrame
    run(m, 1, () => Btn.Right, () => Btn.Left)
    expect(m.fighters[0].x).toBe(x0)
    expect(m.fighters[1].x).toBe(x1)
    expect(m.fighters[0].moveFrame).toBe(frame)
  })
})
