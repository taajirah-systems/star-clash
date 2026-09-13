import { describe, it, expect } from 'vitest'
import { solveCameraFraming, WALL_MARGIN } from '../src/render/view'
import { ARENAS } from '../src/data/roster'
import { fxToFloat } from '../src/core/fx'

const HALF_W = fxToFloat(ARENAS[0]!.halfWidth)
const HALF_D = fxToFloat(ARENAS[0]!.halfDepth)

/** Viewport shapes the camera has to cope with, from ultrawide to portrait. */
const ASPECTS = [2.4, 1.78, 1.33, 1.0, 0.85, 0.6]

function frame(ax: number, az: number, bx: number, bz: number, aspect: number) {
  return solveCameraFraming({
    ax, az, bx, bz, midY: 0, aspect, fovDegrees: 48, arenaHalfWidth: HALF_W,
  })
}

/** Every position a pair of fighters can actually reach, on a coarse grid. */
function* positions(): Generator<[number, number, number, number]> {
  const xs = [-HALF_W, -HALF_W + 0.7, -3, 0, 3, HALF_W - 0.7, HALF_W]
  const zs = [-HALF_D, 0, HALF_D]
  for (const ax of xs) for (const az of zs) for (const bx of xs) for (const bz of zs) {
    yield [ax, az, bx, bz]
  }
}

describe('camera framing', () => {
  it('never places the camera outside the side walls', () => {
    for (const aspect of ASPECTS) {
      for (const [ax, az, bx, bz] of positions()) {
        const shot = frame(ax, az, bx, bz, aspect)
        expect(
          Math.abs(shot.x),
          `camera at x=${shot.x.toFixed(2)} is past the wall (aspect ${aspect}, fighters ${ax}/${bx})`,
        ).toBeLessThanOrEqual(HALF_W)
      }
    }
  })

  it('never frames the camera closer to a wall than the margin allows', () => {
    for (const [ax, az, bx, bz] of positions()) {
      const shot = frame(ax, az, bx, bz, 1.78)
      expect(Math.abs(shot.targetX)).toBeLessThanOrEqual(HALF_W - WALL_MARGIN + 1e-9)
    }
  })

  it('keeps both fighters inside the horizontal view at every aspect', () => {
    for (const aspect of ASPECTS) {
      for (const [ax, az, bx, bz] of positions()) {
        const shot = frame(ax, az, bx, bz, aspect)
        // Distance of each fighter from the view axis, measured in the plane
        // perpendicular to the camera's forward direction.
        const fwdX = shot.targetX - shot.x
        const fwdZ = shot.targetZ - shot.z
        const len = Math.hypot(fwdX, fwdZ) || 1
        const rightX = -fwdZ / len
        const rightZ = fwdX / len
        for (const [fx, fz] of [[ax, az], [bx, bz]] as const) {
          const lateral = Math.abs((fx - shot.x) * rightX + (fz - shot.z) * rightZ)
          // Half a body width of tolerance beyond the fighter's own centre.
          expect(
            lateral,
            `fighter at ${fx}/${fz} is ${lateral.toFixed(2)} off-axis but the view only reaches ${shot.halfViewWidth.toFixed(2)} (aspect ${aspect})`,
          ).toBeLessThanOrEqual(shot.halfViewWidth)
        }
      }
    }
  })

  it('keeps the camera above the arena floor and looking slightly down', () => {
    for (const [ax, az, bx, bz] of positions()) {
      const shot = frame(ax, az, bx, bz, 1.78)
      expect(shot.y).toBeGreaterThan(1.5)
      expect(shot.y).toBeGreaterThan(shot.targetY)
    }
  })

  it('backs off as the fighters separate and closes in as they meet', () => {
    const near = frame(-0.4, 0, 0.4, 0, 1.78)
    const far = frame(-6, 0, 6, 0, 1.78)
    expect(far.distance).toBeGreaterThan(near.distance)
  })

  it('pulls back rather than cropping on a narrow window', () => {
    const wide = frame(-2, 0, 2, 0, 2.4)
    const tall = frame(-2, 0, 2, 0, 0.6)
    expect(tall.distance).toBeGreaterThan(wide.distance)
  })

  it('does not swing onto the X axis when the fighters line up on depth', () => {
    // The failure that put the camera behind a wall: fighters stacked along Z
    // make the perpendicular point along X.
    const shot = frame(0, -3, 0, 3, 1.78)
    const dirX = Math.abs(shot.x - shot.targetX)
    const dirZ = Math.abs(shot.z - shot.targetZ)
    expect(dirZ, 'camera should stay in front of the action, not beside it').toBeGreaterThan(dirX)
  })

  it('produces finite numbers when the fighters occupy the same point', () => {
    const shot = frame(1, 1, 1, 1, 1.78)
    for (const v of [shot.x, shot.y, shot.z, shot.targetX, shot.targetY, shot.targetZ, shot.distance]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})
