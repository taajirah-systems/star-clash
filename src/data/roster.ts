/**
 * Roster and arena tables, plus the id->index maps the sim uses.
 *
 * The sim never holds a MoveDef reference in state — it holds an integer index
 * into these frozen arrays, so a snapshot stays a bag of numbers and a rollback
 * cannot resurrect a stale object.
 */

import type { CharacterDef, MoveDef, ArenaDef } from '../core/defs'
import { fxFrom } from '../core/fx'
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
}

function compile(def: CharacterDef): CompiledCharacter {
  const ids = Object.keys(def.moves).sort()
  const moveList = ids.map((id) => def.moves[id]!)
  const moveIndex = new Map<string, number>()
  ids.forEach((id, i) => moveIndex.set(id, i))
  return { def, moveList, moveIndex }
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

export const ARENAS: readonly ArenaDef[] = Object.freeze([
  {
    id: 'observation-deck',
    name: 'Observation Deck',
    halfWidth: fxFrom(7.0),
    halfDepth: fxFrom(4.2),
    breakables: [
      { x: fxFrom(-5.4), z: fxFrom(-2.6), hw: fxFrom(0.6), hd: fxFrom(0.5), integrity: 100 },
      { x: fxFrom(5.4), z: fxFrom(-2.6), hw: fxFrom(0.6), hd: fxFrom(0.5), integrity: 100 },
      { x: fxFrom(-5.4), z: fxFrom(2.6), hw: fxFrom(0.6), hd: fxFrom(0.5), integrity: 100 },
      { x: fxFrom(5.4), z: fxFrom(2.6), hw: fxFrom(0.6), hd: fxFrom(0.5), integrity: 100 },
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
