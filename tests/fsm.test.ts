import { describe, it, expect } from 'vitest'
import { St, SF, has, isIn, flags, stateName } from '../src/core/fsm'

describe('hierarchical state machine', () => {
  it('inherits flags from ancestors', () => {
    // Declared only on Grounded, must reach every child.
    expect(has(St.Idle, SF.Grounded)).toBe(true)
    expect(has(St.WalkForward, SF.Grounded)).toBe(true)
    expect(has(St.GuardCrouch, SF.Grounded)).toBe(true)
    // Declared only on Airborne.
    expect(has(St.JumpRise, SF.Gravity)).toBe(true)
    expect(has(St.AttackAir, SF.Gravity)).toBe(true)
  })

  it('lets a child strip a flag its parent granted', () => {
    expect(has(St.Grounded, SF.Actionable)).toBe(true)
    expect(has(St.AttackGround, SF.Actionable)).toBe(false)
    expect(has(St.DashBack, SF.Actionable)).toBe(false)
  })

  it('answers ancestry queries', () => {
    expect(isIn(St.HitStun, St.Reeling)).toBe(true)
    expect(isIn(St.Juggle, St.Reeling)).toBe(true)
    expect(isIn(St.Juggle, St.Grounded)).toBe(false)
    expect(isIn(St.Idle, St.Root)).toBe(true)
  })

  it('never leaves a fighter both grounded and airborne', () => {
    for (let s = 0 as St; s < St._Count; s++) {
      const f = flags(s)
      const grounded = (f & SF.Grounded) !== 0
      const airborne = (f & SF.Airborne) !== 0
      expect(grounded && airborne, `${stateName(s)} is both grounded and airborne`).toBe(false)
    }
  })

  it('never leaves a fighter able to act while reeling', () => {
    for (let s = 0 as St; s < St._Count; s++) {
      if (!has(s, SF.Reeling)) continue
      expect(has(s, SF.Actionable), `${stateName(s)} can act while reeling`).toBe(false)
    }
  })

  it('makes juggle airborne and ungrabbable', () => {
    expect(has(St.Juggle, SF.Airborne)).toBe(true)
    expect(has(St.Juggle, SF.Grabbable)).toBe(false)
    expect(has(St.Idle, SF.Grabbable)).toBe(true)
  })
})
