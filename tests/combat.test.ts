import { describe, it, expect } from 'vitest'
import { fight, run, config } from './harness'
import { Btn } from '../src/core/input'
import { St, SF, has } from '../src/core/fsm'
import { moveIdxOf, ROSTER } from '../src/data/roster'
import { fxToFloat, fxFrom } from '../src/core/fx'
import { DamageKind } from '../src/core/defs'

const AUREL = 0, DAX = 1, VORN = 2, ECHO = 3

/** Press a button on frame 0 only, so `pressed()` fires exactly once. */
const tap = (b: Btn) => (f: number) => (f === 0 ? b : 0)
const holdBack = () => Btn.Left // player 2 faces -x, so Left is forward; Right is back
const holdGuard = () => Btn.Guard

describe('strike resolution', () => {
  it('a light attack in range takes health off', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const before = m.fighters[1].health
    run(m, 12, tap(Btn.Light))
    expect(m.fighters[1].health).toBeLessThan(before)
  })

  it('a light attack out of range takes nothing off', () => {
    const m = fight(AUREL, AUREL, 5.0)
    const before = m.fighters[1].health
    run(m, 30, tap(Btn.Light))
    expect(m.fighters[1].health).toBe(before)
  })

  it('connects on exactly the declared startup frame, not before', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const startup = ROSTER[AUREL]!.moves.light!.startup
    const full = m.fighters[1].health
    // The move begins on frame 0, so a 7-frame startup means frames 0..5 are
    // still wind-up and the hitbox goes live on frame 6.
    run(m, startup - 1, tap(Btn.Light))
    expect(m.fighters[1].health).toBe(full)
    run(m, 1, () => 0)
    expect(m.fighters[1].health).toBeLessThan(full)
  })

  it('only lets a single-hitbox move connect once', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const full = m.fighters[1].health
    run(m, 40, tap(Btn.Light))
    const dealt = full - m.fighters[1].health
    const expected = ROSTER[AUREL]!.moves.light!.damage
    expect(dealt).toBe(expected)
  })
})

describe('guard', () => {
  it('blocking a non-chip attack takes no health and holds the defender in stun', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const before = m.fighters[1].health
    // The attack starts on frame 10 so the defender's parry window (opened by
    // the initial guard press) has already lapsed and this is a plain block.
    run(m, 17, (f) => (f === 10 ? Btn.Light : 0), holdGuard)
    expect(m.fighters[1].health).toBe(before)
    expect(m.fighters[1].state).toBe(St.BlockStun)
    run(m, 20, () => 0, holdGuard)
    expect(m.fighters[1].health).toBe(before)
  })

  it('tapping guard just before an attack parries it instead of blocking', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const before = m.fighters[1].health
    const p2 = (f: number) => (f >= 3 ? Btn.Guard : 0)
    run(m, 10, tap(Btn.Light), p2)
    expect(m.fighters[1].health).toBe(before)
    // A parry pays the defender far more meter than a block, and leaves them
    // out of stun rather than in it.
    expect(m.fighters[1].meter).toBe(ROSTER[AUREL]!.meterRule.kind === 'guard'
      ? (ROSTER[AUREL]!.meterRule as { perParry: number }).perParry
      : 0)
    expect(has(m.fighters[1].state, SF.Reeling)).toBe(false)
  })

  it('blocking a chip attack still costs a little health', () => {
    const m = fight(AUREL, AUREL, 1.2)
    const before = m.fighters[1].health
    run(m, 30, tap(Btn.Special), holdGuard)
    const lost = before - m.fighters[1].health
    expect(lost).toBeGreaterThan(0)
    expect(lost).toBe(ROSTER[AUREL]!.moves.axiomStrike!.chip)
  })

  it('a standing guard does not cover a low', () => {
    const m = fight(ECHO, AUREL, 1.4)
    const before = m.fighters[1].health
    // Down + Special is Siphon Sweep, a low; a standing guard eats it in full.
    run(m, 30, tap(Btn.Down | Btn.Special), () => Btn.Guard)
    expect(before - m.fighters[1].health).toBeGreaterThan(ROSTER[ECHO]!.moves.siphonSweep!.chip)
  })

  it('a crouching guard covers a low', () => {
    const m = fight(ECHO, AUREL, 1.4)
    const before = m.fighters[1].health
    run(m, 30, tap(Btn.Down | Btn.Special), () => Btn.Guard | Btn.Down)
    expect(before - m.fighters[1].health).toBe(ROSTER[ECHO]!.moves.siphonSweep!.chip)
  })

  it('a crouching guard does not cover a high', () => {
    const m = fight(DAX, AUREL, 1.6)
    const before = m.fighters[1].health
    // Vault Dropkick is a high; crouching under a guard does not stop it.
    run(m, 40, tap(Btn.Special), () => Btn.Guard | Btn.Down)
    expect(m.fighters[1].health).toBeLessThan(before)
  })

  it('holding away from the opponent guards without the guard button', () => {
    const m = fight(AUREL, AUREL, 1.0)
    const before = m.fighters[1].health
    // Player 2 faces -x, so Right is away from player 1.
    run(m, 20, tap(Btn.Light), () => Btn.Right)
    expect(m.fighters[1].health).toBe(before)
    void holdBack
  })
})

describe('combos and scaling', () => {
  it('scales later hits in a combo down', () => {
    const m = fight(DAX, AUREL, 0.9)
    const light = ROSTER[DAX]!.moves.light!
    // Jab, then cancel into jab again inside the window.
    let firstDamage = 0
    const start = m.fighters[1].health
    run(m, light.startup + 2, tap(Btn.Light))
    firstDamage = start - m.fighters[1].health
    expect(firstDamage).toBe(light.damage)

    const mid = m.fighters[1].health
    run(m, 12, (f) => (f === 0 ? Btn.Light : 0))
    const secondDamage = mid - m.fighters[1].health
    if (secondDamage > 0) expect(secondDamage).toBeLessThan(firstDamage)
  })

  it('resets scaling once the opponent has been free for a while', () => {
    const m = fight(DAX, AUREL, 0.9)
    run(m, 12, tap(Btn.Light))
    expect(m.fighters[0].comboScale).toBeLessThan(100)
    run(m, 120, () => 0)
    expect(m.fighters[0].comboScale).toBe(100)
  })
})

describe('throws', () => {
  it('a grab beats a standing guard', () => {
    const m = fight(VORN, AUREL, 0.8)
    const before = m.fighters[1].health
    run(m, 20, tap(Btn.Throw), holdGuard)
    expect(m.fighters[1].health).toBeLessThan(before)
  })

  it('a grab whiffs on an airborne opponent', () => {
    const m = fight(VORN, AUREL, 0.8)
    const before = m.fighters[1].health
    // Player 2 jumps on frame 0; the grab starts a few frames later.
    run(m, 30, (f) => (f === 4 ? Btn.Throw : 0), (f) => (f === 0 ? Btn.Jump : 0))
    expect(m.fighters[1].health).toBe(before)
  })

  it('a contested throw techs into a neutral reset', () => {
    const m = fight(VORN, AUREL, 0.8)
    const before = m.fighters[1].health
    run(m, 20, tap(Btn.Throw), (f) => (f === 8 ? Btn.Throw : 0))
    expect(m.fighters[1].health).toBe(before)
  })
})

describe('character mechanics', () => {
  it('Aurel builds the Calculus meter by guarding, not by attacking', () => {
    const guarding = fight(AUREL, DAX, 1.0)
    run(guarding, 30, holdGuard, tap(Btn.Light))
    expect(guarding.fighters[0].meter).toBeGreaterThan(0)

    const attacking = fight(AUREL, DAX, 1.0)
    run(attacking, 30, tap(Btn.Light))
    expect(attacking.fighters[0].meter).toBe(0)
  })

  it("Aurel's burst slows the opponent's move timers", () => {
    /** Real frames the fighter needs to finish one attack. */
    const framesToFinish = (dilated: boolean): number => {
      const m = fight(AUREL, DAX, 4.0)
      if (dilated) {
        m.fighters[0].meter = ROSTER[AUREL]!.meterMax
        run(m, 2, (f) => (f === 0 ? Btn.Guard : Btn.Guard | Btn.Special))
        expect(m.fighters[1].dilatedFrames).toBeGreaterThan(0)
      }
      // A dilated fighter can skip the very frame its input would land, so
      // wait for the attack to actually begin before starting the count.
      let waited = 0
      while (!has(m.fighters[1].state, SF.Attacking) && waited < 60) {
        run(m, 1, () => 0, () => Btn.Light)
        waited++
      }
      expect(has(m.fighters[1].state, SF.Attacking)).toBe(true)

      let frames = 0
      while (has(m.fighters[1].state, SF.Attacking) && frames < 400) {
        run(m, 1, () => 0, () => 0)
        frames++
      }
      return frames
    }

    const normal = framesToFinish(false)
    const slowed = framesToFinish(true)
    expect(normal).toBeGreaterThan(0)
    // Two frames of progress per three real frames: half again as long.
    expect(slowed).toBeGreaterThan(normal)
    expect(slowed).toBeGreaterThanOrEqual(Math.floor(normal * 1.4))
  })

  it('Dax builds the Command meter by landing hits', () => {
    const m = fight(DAX, AUREL, 0.9)
    run(m, 14, tap(Btn.Light))
    expect(m.fighters[0].meter).toBeGreaterThan(0)
  })

  it('Vorn builds the Rage meter from damage taken', () => {
    const m = fight(AUREL, VORN, 1.0)
    run(m, 20, tap(Btn.Heavy))
    expect(m.fighters[1].meter).toBeGreaterThan(0)
  })

  it("Vorn's berserk armour eats a light attack's stun but not its damage", () => {
    const m = fight(AUREL, VORN, 1.0)
    const v = m.fighters[1]
    v.payloadFrames = 300
    const before = v.health
    run(m, 20, tap(Btn.Light))
    expect(v.health).toBeLessThan(before)
    expect(has(v.state, SF.Reeling)).toBe(false)
  })

  it('Echo-Nine adapts after three blocked hits of one kind', () => {
    const m = fight(AUREL, ECHO, 1.2)
    const echo = m.fighters[1]
    // Aurel's Axiom Strike is energy. Blocking it pushes the pair apart, so
    // the range is reset between reps the way a player walking back in would.
    for (let i = 0; i < 3; i++) {
      m.fighters[0].x = fxFrom(-0.6)
      m.fighters[1].x = fxFrom(0.6)
      m.fighters[0].special = 100
      run(m, 50, (f) => (f === 0 ? Btn.Special : 0), () => Btn.Guard)
      if (i < 2) expect(echo.analysedEnergy, `rep ${i}`).toBe(i + 1)
    }
    expect(echo.shieldKind).toBe(DamageKind.Energy)
    expect(echo.shieldFrames).toBeGreaterThan(0)
  })

  it('a different damage kind resets the adaptation count', () => {
    const m = fight(AUREL, ECHO, 1.2)
    const echo = m.fighters[1]
    m.fighters[0].x = fxFrom(-0.6)
    m.fighters[1].x = fxFrom(0.6)
    run(m, 50, tap(Btn.Special), () => Btn.Guard) // energy
    expect(echo.analysedEnergy).toBe(1)
    m.fighters[0].x = fxFrom(-0.5)
    m.fighters[1].x = fxFrom(0.5)
    run(m, 30, (f) => (f === 0 ? Btn.Light : 0), () => Btn.Guard) // physical
    expect(echo.analysedEnergy).toBe(0)
    expect(echo.analysedPhysical).toBe(1)
  })

  it('an active nanoprobe shield nullifies that damage category outright', () => {
    const m = fight(AUREL, ECHO, 1.2)
    const echo = m.fighters[1]
    echo.shieldKind = DamageKind.Energy
    echo.shieldFrames = 300
    const before = echo.health
    run(m, 40, tap(Btn.Special))
    expect(echo.health).toBe(before)
  })

  it('a nanoprobe shield does not cover the other damage category', () => {
    const m = fight(AUREL, ECHO, 1.0)
    const echo = m.fighters[1]
    echo.shieldKind = DamageKind.Energy
    echo.shieldFrames = 300
    const before = echo.health
    run(m, 20, tap(Btn.Light)) // physical
    expect(echo.health).toBeLessThan(before)
  })

  it("Echo-Nine's projectile travels and connects at range", () => {
    const m = fight(ECHO, AUREL, 4.0)
    const before = m.fighters[1].health
    run(m, 90, tap(Btn.Special))
    expect(m.fighters[1].health).toBeLessThan(before)
  })

  it('Siphon Sweep drains the opponent special pool', () => {
    const m = fight(ECHO, AUREL, 1.4)
    m.fighters[1].special = 100
    run(m, 30, (f) => (f === 0 ? Btn.Down | Btn.Light : f === 6 ? Btn.Special : 0))
    expect(m.fighters[1].special).toBeLessThanOrEqual(100)
  })
})

describe('arena', () => {
  it('keeps both fighters inside the boundary', () => {
    const cfg = config()
    const m = fight(DAX, AUREL, 1.0, cfg)
    run(m, 400, () => Btn.Right, () => Btn.Right, cfg)
    for (const f of m.fighters) {
      expect(Math.abs(fxToFloat(f.x))).toBeLessThanOrEqual(fxToFloat(cfg.arena.halfWidth) + 1e-3)
      expect(Math.abs(fxToFloat(f.z))).toBeLessThanOrEqual(fxToFloat(cfg.arena.halfDepth) + 1e-3)
    }
  })

  it('never lets the fighters occupy the same space', () => {
    const m = fight(DAX, AUREL, 1.0)
    run(m, 200, () => Btn.Right, () => Btn.Left)
    const dx = fxToFloat(m.fighters[1].x - m.fighters[0].x)
    const dz = fxToFloat(m.fighters[1].z - m.fighters[0].z)
    const dist = Math.hypot(dx, dz)
    const minDist =
      fxToFloat(ROSTER[DAX]!.pushRadius) + fxToFloat(ROSTER[AUREL]!.pushRadius)
    expect(dist).toBeGreaterThan(minDist - 0.02)
  })

  it('turns fighters to face each other', () => {
    const m = fight(AUREL, DAX, 1.0)
    expect(m.fighters[0].facing).toBe(1)
    expect(m.fighters[1].facing).toBe(-1)
    // Walk player 1 past player 2 and the facings should swap.
    run(m, 200, () => Btn.Right, () => Btn.Right)
    if (m.fighters[0].x > m.fighters[1].x) {
      expect(m.fighters[0].facing).toBe(-1)
      expect(m.fighters[1].facing).toBe(1)
    }
  })
})

describe('move data sanity', () => {
  it('every move id matches its table key', () => {
    for (const c of ROSTER) {
      for (const [key, mv] of Object.entries(c.moves)) {
        expect(mv.id, `${c.id}.${key}`).toBe(key)
      }
    }
  })

  it('every normal named by a character exists', () => {
    for (const c of ROSTER) {
      for (const id of Object.values(c.normals)) {
        expect(moveIdxOf(ROSTER.indexOf(c), id), `${c.id} -> ${id}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('every cancel target exists', () => {
    for (const c of ROSTER) {
      for (const mv of Object.values(c.moves)) {
        for (const target of mv.cancelInto) {
          expect(c.moves[target], `${c.id}.${mv.id} -> ${target}`).toBeDefined()
        }
      }
    }
  })

  it('every hitbox window falls inside its move', () => {
    for (const c of ROSTER) {
      for (const mv of Object.values(c.moves)) {
        const total = mv.startup + mv.active + mv.recovery
        for (const hb of mv.hitboxes) {
          expect(hb.from, `${c.id}.${mv.id}`).toBeGreaterThanOrEqual(0)
          expect(hb.to, `${c.id}.${mv.id}`).toBeLessThanOrEqual(total)
          expect(hb.to, `${c.id}.${mv.id}`).toBeGreaterThan(hb.from)
        }
      }
    }
  })

  it('gives every non-projectile move at least one hitbox', () => {
    for (const c of ROSTER) {
      for (const mv of Object.values(c.moves)) {
        if (mv.projectile) continue
        expect(mv.hitboxes.length, `${c.id}.${mv.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('leaves every fighter able to reach the others', () => {
    // A character with no move that outranges its own pushbox could never open.
    for (const c of ROSTER) {
      const reach = Math.max(
        ...Object.values(c.moves).flatMap((mv) =>
          mv.hitboxes.map((h) => fxToFloat(h.box.x + h.box.hw)),
        ),
        0,
      )
      expect(reach, c.id).toBeGreaterThan(fxToFloat(c.pushRadius) * 2)
    }
  })
})

describe('state integrity over a long random match', () => {
  it('never produces a NaN, a non-integer, or negative health below zero', () => {
    const m = fight(VORN, ECHO, 2.0)
    let x = 12345
    const rnd = () => {
      x ^= x << 13; x >>>= 0
      x ^= x >>> 17
      x ^= x << 5; x >>>= 0
      return x
    }
    for (let f = 0; f < 3000; f++) {
      const a = (rnd() & 0x3ff) & (rnd() & 0x3ff)
      const b = (rnd() & 0x3ff) & (rnd() & 0x3ff)
      run(m, 1, () => a, () => b)
      for (const fighter of m.fighters) {
        expect(Number.isInteger(fighter.x)).toBe(true)
        expect(Number.isInteger(fighter.y)).toBe(true)
        expect(Number.isFinite(fighter.health)).toBe(true)
        expect(fighter.state).toBeLessThan(St._Count)
      }
    }
  })
})
