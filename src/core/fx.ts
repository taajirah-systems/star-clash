/**
 * Q16.16 fixed-point arithmetic.
 *
 * The simulation must produce bit-identical results on every machine so that
 * rollback netcode can re-simulate a frame and land on the same state. IEEE
 * floats do not guarantee that across platforms once transcendentals or
 * different instruction orderings get involved, so every quantity the sim
 * touches — positions, velocities, damage scaling — is an integer here.
 *
 * All values are plain JS numbers holding an integer in [-2^31, 2^31).
 */

export type Fx = number

export const FX_SHIFT = 16
export const FX_ONE: Fx = 1 << FX_SHIFT
export const FX_HALF: Fx = FX_ONE >> 1
export const FX_ZERO: Fx = 0

/** Whole number -> fixed. */
export function fxInt(n: number): Fx {
  return (n << FX_SHIFT) | 0
}

/**
 * Float -> fixed. Only legal at authoring time (parsing frame-data tables);
 * never call this inside the tick, or a float sneaks into the sim.
 */
export function fxFrom(n: number): Fx {
  return Math.round(n * FX_ONE) | 0
}

/** Fixed -> float. Rendering and debug output only. */
export function fxToFloat(a: Fx): number {
  return a / FX_ONE
}

/** Truncating fixed -> whole number, toward zero. */
export function fxTrunc(a: Fx): number {
  return a >= 0 ? a >> FX_SHIFT : -((-a) >> FX_SHIFT)
}

export function fxMul(a: Fx, b: Fx): Fx {
  // Split BOTH operands into 16-bit halves. Splitting only one of them and
  // multiplying by the full other operand overflows 32 bits — Math.imul then
  // silently wraps and the product comes back short by whole units.
  //
  //   a*b >> 16  ==  ah*bh<<16  +  ah*bl  +  al*bh  +  (al*bl >>> 16)
  //
  // The first three terms are taken mod 2^32 by Math.imul, which is harmless
  // because the result itself is an int32. The last is exact: al and bl are
  // unsigned 16-bit, so al*bl < 2^32 and stays inside a double.
  const ah = a >> FX_SHIFT
  const al = a & 0xffff
  const bh = b >> FX_SHIFT
  const bl = b & 0xffff
  return (
    (Math.imul(ah, bh) << FX_SHIFT) +
    Math.imul(ah, bl) +
    Math.imul(al, bh) +
    ((al * bl) >>> FX_SHIFT)
  ) | 0
}

export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) return a >= 0 ? 0x7fffffff : -0x7fffffff
  return Math.trunc((a * FX_ONE) / b) | 0
}

export function fxAbs(a: Fx): Fx {
  return a < 0 ? -a : a
}

export function fxSign(a: Fx): -1 | 0 | 1 {
  return a === 0 ? 0 : a < 0 ? -1 : 1
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b
}

export function fxClamp(v: Fx, lo: Fx, hi: Fx): Fx {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Integer square root of a fixed value, via Newton's method on integers.
 * Deterministic where Math.sqrt is merely near-universally consistent.
 */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0
  // sqrt(a / ONE) * ONE == sqrt(a * ONE). `n` is at most 2^47, exact in a
  // double, and x is at most ~2^23.5 so x*x stays exact too.
  const n = a * FX_ONE

  // Math.sqrt is only a seed here. Newton's method on integers can settle into
  // a two-cycle, so the loop is followed by an exact correction that pins the
  // answer to the largest x with x*x <= n. That final step is what makes the
  // result independent of how the platform rounded the seed.
  let x = Math.floor(Math.sqrt(n))
  for (let i = 0; i < 6; i++) {
    const next = Math.floor((x + Math.floor(n / x)) / 2)
    if (next === x) break
    x = next
  }
  while (x > 0 && x * x > n) x--
  while ((x + 1) * (x + 1) <= n) x++
  return x | 0
}

/** Length of a 2D fixed vector. */
export function fxLen2(x: Fx, z: Fx): Fx {
  const ax = fxAbs(x)
  const az = fxAbs(z)
  if (ax === 0) return az
  if (az === 0) return ax
  return fxSqrt(fxMul(ax, ax) + fxMul(az, az))
}

/** Linear interpolation, t in [0, FX_ONE]. Render-side only. */
export function fxLerp(a: Fx, b: Fx, t: Fx): Fx {
  return a + fxMul(b - a, t)
}
