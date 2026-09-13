/**
 * Roster and arena tables, plus the id->index maps the sim uses.
 *
 * The sim never holds a MoveDef reference in state — it holds an integer index
 * into these frozen arrays, so a snapshot stays a bag of numbers and a rollback
 * cannot resurrect a stale object.
 */

import type { CharacterDef, MoveDef, ArenaDef } from '../core/defs'
import { fxFrom, type Fx } from '../core/fx'
import { AUREL } from './characters/aurel'
import { DAX } from './characters/dax'
import { VORN } from './characters/vorn'
import { ECHO } from './characters/echo'

export const ROSTER: readonly CharacterDef[] = Object.freeze([AUREL, DAX, VORN, ECHO])

export interface CompiledCharacter {
  def: CharacterDef
  /** Stable, ordered move list. Index is what the sim stores. */
  moveList: readonly MoveDef[]
  /** move id -> index into moveList. */
  moveIndex: ReadonlyMap<string, number>
  /**
   * Furthest forward point each move's hitboxes reach, including any ground
   * the move covers while advancing. Precomputed because the AI asks this
   * question every time it decides whether it is in range, and it is a pure
   * function of frame data.
   */
  reach: readonly Fx[]
}

function reachOf(m: MoveDef): Fx {
  let best: Fx = 0
  for (const hb of m.hitboxes) {
    const tip = hb.box.x + hb.box.hw
    if (tip > best) best = tip
  }
  // A lunge closes distance before the hitbox appears, so its effective range
  // is much longer than its boxes suggest.
  if (m.advance > 0) best += m.advance * m.advanceFrames
  // A projectile threatens the whole arena.
  if (m.projectile) best = fxFrom(14)
  return best
}

function compile(def: CharacterDef): CompiledCharacter {
  const ids = Object.keys(def.moves).sort()
  const moveList = ids.map((id) => def.moves[id]!)
  const moveIndex = new Map<string, number>()
  ids.forEach((id, i) => moveIndex.set(id, i))
  return { def, moveList, moveIndex, reach: moveList.map(reachOf) }
}

export const COMPILED: readonly CompiledCharacter[] = Object.freeze(ROSTER.map(compile))

export function characterAt(index: number): CompiledCharacter {
  return COMPILED[index] ?? COMPILED[0]!
}

export function moveOf(index: number, moveIdx: number): MoveDef | null {
  if (moveIdx < 0) return null
  return characterAt(index).moveList[moveIdx] ?? null
}

export function moveIdxOf(charIndex: number, id: string): number {
  return characterAt(charIndex).moveIndex.get(id) ?? -1
}

/** Forward reach of a move by id, in world units. 0 when the move is unknown. */
export function reachOfMove(charIndex: number, id: string): Fx {
  const c = characterAt(charIndex)
  const idx = c.moveIndex.get(id)
  return idx === undefined ? 0 : (c.reach[idx] ?? 0)
}

export const ARENAS: readonly ArenaDef[] = Object.freeze([
  {
    id: 'observation-deck',
    name: 'Observation Deck',
    halfWidth: fxFrom(7.0),
    halfDepth: fxFrom(4.2),
    // Mounted flush against the side walls, where wall-splats actually land.
    // Sitting them further into the play area put them between the camera and
    // a corner exchange, hiding the fighters behind a console.
    breakables: [
      { x: fxFrom(-6.5), z: fxFrom(-2.4), hw: fxFrom(0.42), hd: fxFrom(0.7), integrity: 100 },
      { x: fxFrom(6.5), z: fxFrom(-2.4), hw: fxFrom(0.42), hd: fxFrom(0.7), integrity: 100 },
      { x: fxFrom(-6.5), z: fxFrom(2.4), hw: fxFrom(0.42), hd: fxFrom(0.7), integrity: 100 },
      { x: fxFrom(6.5), z: fxFrom(2.4), hw: fxFrom(0.42), hd: fxFrom(0.7), integrity: 100 },
    ],
    fogColor: 0x070b16,
    floorColor: 0x141d2e,
    gridColor: 0x2f4f7a,
  },
  {
    id: 'training-grid',
    name: 'Training Grid',
    halfWidth: fxFrom(7.0),
    halfDepth: fxFrom(4.2),
    breakables: [],
    fogColor: 0x0a0a0d,
    floorColor: 0x101015,
    gridColor: 0x3a6a3a,
  },
])
