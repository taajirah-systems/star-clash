import { describe, it, expect } from 'vitest'
import { fxFrom, fxInt, fxMul, fxDiv, fxSqrt, fxToFloat, fxLen2, FX_ONE } from '../src/core/fx'

describe('fixed-point arithmetic', () => {
  it('round-trips whole numbers exactly', () => {
    for (let i = -100; i <= 100; i++) {
      expect(fxToFloat(fxInt(i))).toBe(i)
    }
  })

  it('multiplies without drifting from the float result', () => {
    const cases: [number, number][] = [[1.5, 2], [0.25, 0.25], [-3.75, 1.5], [12.5, -0.4]]
    for (const [a, b] of cases) {
      const got = fxToFloat(fxMul(fxFrom(a), fxFrom(b)))
      expect(Math.abs(got - a * b)).toBeLessThan(1e-4)
    }
  })

  it('divides without drifting from the float result', () => {
    const cases: [number, number][] = [[3, 2], [-9, 4], [0.5, 0.25], [7.5, 1.25]]
    for (const [a, b] of cases) {
      const got = fxToFloat(fxDiv(fxFrom(a), fxFrom(b)))
      expect(Math.abs(got - a / b)).toBeLessThan(1e-3)
    }
  })

  it('never divides by zero into a NaN', () => {
    expect(Number.isFinite(fxDiv(fxFrom(1), 0))).toBe(true)
    expect(Number.isFinite(fxDiv(fxFrom(-1), 0))).toBe(true)
  })

  it('takes square roots as exact integers', () => {
    for (const v of [0, 1, 2, 4, 9, 16.5, 100]) {
      const got = fxToFloat(fxSqrt(fxFrom(v)))
      expect(Math.abs(got - Math.sqrt(v))).toBeLessThan(2e-3)
    }
  })

  it('measures 2D length', () => {
    expect(Math.abs(fxToFloat(fxLen2(fxFrom(3), fxFrom(4))) - 5)).toBeLessThan(2e-3)
    expect(fxLen2(0, fxFrom(2))).toBe(fxFrom(2))
    expect(fxLen2(fxFrom(2), 0)).toBe(fxFrom(2))
  })

  it('keeps every result an integer, so no float can leak into the sim', () => {
    const vals = [fxMul(fxFrom(1.5), fxFrom(2.5)), fxDiv(fxFrom(7), fxFrom(3)), fxSqrt(fxFrom(2)), FX_ONE]
    for (const v of vals) expect(Number.isInteger(v)).toBe(true)
  })
})
