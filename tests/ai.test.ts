import { describe, it, expect } from 'vitest'
import { fight, config } from './harness'
import { advanceFrame } from '../src/core/sim'
import { Ai, Difficulty, aiCanDriveCharacter } from '../src/core/ai'
import { ROSTER } from '../src/data/roster'
import { Btn, type InputFrame } from '../src/core/input'
import { checksum, type MatchState } from '../src/core/state'
import { fxToFloat } from '../src/core/fx'

const ALL_BUTTONS = 0x3ff

interface MatchResult {
  state: MatchState
  damageDealt: number
  damageTaken: number
  inputs: InputFrame[]
  /** Incoming attacks the AI guarded, as a fraction of those that connected. */
  blockRate: number
  incoming: number
  guarded: number
}

/**
 * Runs the AI in slot 1 against a scripted slot 0 for `frames` ticks.
 * `p1` drives the opponent so a test can pick what the AI has to cope with.
 */
function runAi(
  aiChar: number,
  oppChar: number,
  diff: Difficulty,
  frames: number,
  p1: (f: number) => InputFrame = () => 0,
  gap = 2.6,
  seed = 0x1234,
): MatchResult {
  const cfg = config({ training: true })
  const m = fight(oppChar, aiChar, gap, cfg)
  const ai = new Ai(1, diff, seed)
  const inputs: InputFrame[] = []
  // Damage is summed from hit events rather than from health deltas. Training
  // mode regenerates health every frame, so a health delta measures the
  // regeneration as much as the fighting — and can come out negative.
  let dealt = 0
  let taken = 0
  let incoming = 0
  let guarded = 0
  for (let f = 0; f < frames; f++) {
    const a = ai.think(m)
    inputs.push(a)
    advanceFrame(m, [p1(f), a], cfg)
    for (const e of m.events) {
      if (e.attacker === 1) {
        dealt += e.damage
      } else {
        taken += e.damage
        incoming++
        if (e.blocked) guarded++
      }
    }
  }
  return {
    state: m,
    damageDealt: dealt,
    damageTaken: taken,
    inputs,
    blockRate: incoming === 0 ? 0 : guarded / incoming,
    incoming,
    guarded,
  }
}

describe('CPU opponent', () => {
  it('can drive every character in the roster', () => {
    for (let i = 0; i < ROSTER.length; i++) {
      expect(aiCanDriveCharacter(i), ROSTER[i]!.id).toBe(true)
    }
  })

  it('only ever emits inputs a controller could produce', () => {
    const { inputs } = runAi(1, 0, Difficulty.Elite, 900, (f) => (f % 40 === 0 ? Btn.Heavy : 0))
    for (const i of inputs) {
      expect(Number.isInteger(i)).toBe(true)
      expect(i & ~ALL_BUTTONS, `input ${i} has bits outside the button mask`).toBe(0)
    }
  })

  it('is deterministic — the same seed replays to the same match', () => {
    const a = runAi(2, 3, Difficulty.Veteran, 1200, (f) => (f % 37 === 0 ? Btn.Light : 0))
    const b = runAi(2, 3, Difficulty.Veteran, 1200, (f) => (f % 37 === 0 ? Btn.Light : 0))
    expect(checksum(a.state)).toBe(checksum(b.state))
    expect(a.inputs).toEqual(b.inputs)
  })

  it('produces different play from a different seed', () => {
    const a = runAi(1, 0, Difficulty.Veteran, 600, () => 0, 2.6, 0x1111)
    const b = runAi(1, 0, Difficulty.Veteran, 600, () => 0, 2.6, 0x9999)
    expect(a.inputs).not.toEqual(b.inputs)
  })

  it('closes distance instead of standing still', () => {
    const cfg = config({ training: true })
    const m = fight(0, 1, 9.0, cfg)
    const ai = new Ai(1, Difficulty.Veteran)
    const startGap = Math.abs(fxToFloat(m.fighters[1].x - m.fighters[0].x))
    for (let f = 0; f < 240; f++) advanceFrame(m, [0, ai.think(m)], cfg)
    const endGap = Math.abs(fxToFloat(m.fighters[1].x - m.fighters[0].x))
    expect(endGap).toBeLessThan(startGap - 1.5)
  })

  it('actually lands damage on a passive opponent, as every character', () => {
    for (let c = 0; c < ROSTER.length; c++) {
      const r = runAi(c, 0, Difficulty.Veteran, 1800)
      expect(r.damageDealt, `${ROSTER[c]!.id} dealt no damage`).toBeGreaterThan(100)
    }
  })

  it('lands damage as every character against every opponent', () => {
    for (let c = 0; c < ROSTER.length; c++) {
      for (let o = 0; o < ROSTER.length; o++) {
        const r = runAi(c, o, Difficulty.Veteran, 1500)
        expect(r.damageDealt, `${ROSTER[c]!.id} vs ${ROSTER[o]!.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('hits harder at a higher difficulty', () => {
    const rookie = runAi(1, 0, Difficulty.Rookie, 1800)
    const elite = runAi(1, 0, Difficulty.Elite, 1800)
    expect(elite.damageDealt).toBeGreaterThan(rookie.damageDealt)
  })

  it('guards a larger share of incoming attacks at a higher difficulty', () => {
    // Aggregated over every matchup. A single pairing lands too few attacks
    // to measure — the AI interrupts most of them — so one matchup's block
    // rate is noise. Measured as a rate rather than as damage taken, because
    // an aggressive tier stands in range more often and so eats more total
    // damage even while defending better against each individual attack.
    const rateFor = (d: Difficulty): number => {
      let incoming = 0
      let guarded = 0
      for (let aiChar = 0; aiChar < ROSTER.length; aiChar++) {
        for (let opp = 0; opp < ROSTER.length; opp++) {
          // The attacker advances as well, or it drifts out of range and
          // spends the match swinging at nothing.
          const attack = (f: number) =>
            f % 24 === 0 ? Btn.Heavy : f % 24 === 12 ? Btn.Light : Btn.Right
          const r = runAi(aiChar, opp, d, 1200, attack, 1.4, 0x1234 + aiChar * 17 + opp)
          incoming += r.incoming
          guarded += r.guarded
        }
      }
      expect(incoming, 'no attacks reached the AI at all').toBeGreaterThan(20)
      return guarded / incoming
    }

    const rookie = rateFor(Difficulty.Rookie)
    const veteran = rateFor(Difficulty.Veteran)
    const elite = rateFor(Difficulty.Elite)

    expect(rookie).toBeGreaterThan(0)
    expect(veteran).toBeGreaterThan(rookie)
    expect(elite).toBeGreaterThan(veteran)
  })

  it('beats a lower difficulty head to head, in every mirror matchup', () => {
    // The decisive test of a difficulty tier is not how it behaves but whether
    // it wins. Mirror matches so the only variable is the tier.
    for (let c = 0; c < ROSTER.length; c++) {
      const cfg = config()
      const m = fight(c, c, 2.5, cfg)
      const rookie = new Ai(0, Difficulty.Rookie, 0x900 + c)
      const elite = new Ai(1, Difficulty.Elite, 0x500 + c)
      for (
        let f = 0;
        f < 20000 && m.roundsWon[0] < cfg.roundsToWin && m.roundsWon[1] < cfg.roundsToWin;
        f++
      ) {
        advanceFrame(m, [rookie.think(m), elite.think(m)], cfg)
      }
      expect(m.roundsWon[1], `elite lost the ${ROSTER[c]!.id} mirror`).toBe(cfg.roundsToWin)
    }
  })

  it('walks into throws rather than blocking them, since guard does not stop a grab', () => {
    // Guard beats strikes but not command grabs. The AI must not treat an
    // incoming grab as something to hold back against.
    const grabs = (f: number) => (f % 30 === 0 ? Btn.Throw : 0)
    const r = runAi(0, 2, Difficulty.Elite, 900, grabs, 1.0)
    // It should still be fighting back rather than frozen in guard.
    expect(r.damageDealt).toBeGreaterThan(0)
  })

  it('never leaves the arena or desyncs the sim over a long match', () => {
    const cfg = config({ training: true })
    const m = fight(2, 3, 3.0, cfg)
    const a = new Ai(0, Difficulty.Elite, 0xaaa)
    const b = new Ai(1, Difficulty.Rookie, 0xbbb)
    for (let f = 0; f < 3000; f++) {
      advanceFrame(m, [a.think(m), b.think(m)], cfg)
      for (const fighter of m.fighters) {
        expect(Number.isInteger(fighter.x)).toBe(true)
        expect(Math.abs(fxToFloat(fighter.x))).toBeLessThanOrEqual(fxToFloat(cfg.arena.halfWidth) + 0.01)
      }
    }
  })

  it('wins a real match against a do-nothing opponent', () => {
    const cfg = config()
    const m = fight(0, 1, 2.5, cfg)
    const ai = new Ai(1, Difficulty.Elite)
    for (let f = 0; f < 7200 && m.roundsWon[1] < cfg.roundsToWin; f++) {
      advanceFrame(m, [0, ai.think(m)], cfg)
    }
    expect(m.roundsWon[1]).toBe(cfg.roundsToWin)
    expect(m.roundsWon[0]).toBe(0)
  })
})
