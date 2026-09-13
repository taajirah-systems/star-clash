/**
 * Box transforms and overlap tests.
 *
 * Boxes are authored in facing-relative space. A fighter turning around is a
 * 180-degree rotation about Y, not a mirror, so both x and z negate — get that
 * wrong and every sidestep-punish box lands on the opposite side of the body.
 */

import type { Fx } from './fx'
import type { Box } from './defs'

export interface WorldBox {
  minX: Fx
  maxX: Fx
  minY: Fx
  maxY: Fx
  minZ: Fx
  maxZ: Fx
}

const scratchA: WorldBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }
const scratchB: WorldBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }

export function toWorld(
  b: Box,
  ox: Fx,
  oy: Fx,
  oz: Fx,
  facing: 1 | -1,
  out: WorldBox,
): WorldBox {
  const cx = ox + facing * b.x
  const cz = oz + facing * b.z
  const cy = oy + b.y
  out.minX = cx - b.hw
  out.maxX = cx + b.hw
  out.minY = cy - b.hh
  out.maxY = cy + b.hh
  out.minZ = cz - b.hd
  out.maxZ = cz + b.hd
  return out
}

export function overlaps(a: WorldBox, b: WorldBox): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ
  )
}

/** Convenience overlap of two facing-relative boxes without allocating. */
export function boxesOverlap(
  a: Box, ax: Fx, ay: Fx, az: Fx, af: 1 | -1,
  b: Box, bx: Fx, by: Fx, bz: Fx, bf: 1 | -1,
): boolean {
  toWorld(a, ax, ay, az, af, scratchA)
  toWorld(b, bx, by, bz, bf, scratchB)
  return overlaps(scratchA, scratchB)
}

/** Midpoint of the intersection, used to place hit sparks. */
export function overlapCenter(a: WorldBox, b: WorldBox, out: { x: Fx; y: Fx; z: Fx }): void {
  const minX = a.minX > b.minX ? a.minX : b.minX
  const maxX = a.maxX < b.maxX ? a.maxX : b.maxX
  const minY = a.minY > b.minY ? a.minY : b.minY
  const maxY = a.maxY < b.maxY ? a.maxY : b.maxY
  const minZ = a.minZ > b.minZ ? a.minZ : b.minZ
  const maxZ = a.maxZ < b.maxZ ? a.maxZ : b.maxZ
  out.x = (minX + maxX) >> 1
  out.y = (minY + maxY) >> 1
  out.z = (minZ + maxZ) >> 1
}

export { scratchA as boxScratchA, scratchB as boxScratchB }
