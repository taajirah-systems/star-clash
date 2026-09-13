/**
 * Static definitions: frame data, move tables, character stats, arenas.
 *
 * Everything in this file is immutable and shared between both fighters and
 * every rollback re-simulation. Nothing here is ever snapshotted — if a value
 * changes during a match it belongs in state.ts instead.
 */

import type { Fx } from './fx'
import { fxFrom } from './fx'

export const TICK_HZ = 60
/** Frames the sim can be asked to re-run after a late input arrives. */
export const ROLLBACK_WINDOW = 8

export const enum Guard {
  /** Blockable standing only — crouching ducks it. */
  High,
  /** Blockable standing or crouching. */
  Mid,
  /** Must be blocked crouching. */
  Low,
  /** Beats every guard. */
  Unblockable,
  /** Command grab: beats guard, loses to airborne and to throw-break. */
  Command,
}

/**
 * Damage category. Echo-Nine's adaptation keys off this, and it also decides
 * which hit spark and impact sound play.
 */
export const enum DamageKind {
  Physical,
  Energy,
}

export const enum Reaction {
  /** Standard standing hitstun. */
  Stand,
  /** Loses balance — longer stun, cannot be cancelled out of. */
  Stagger,
  /** Sent airborne; juggle state until landing. */
  Launch,
  /** Straight to the floor, wakeup required. */
  Knockdown,
  /** Held in place, no pushback — the paralysis on a nerve-pinch style grab. */
  Paralyze,
}

export const enum MoveFlag {
  None = 0,
  /** Ignores light-attack interrupts while active. */
  SuperArmor = 1 << 0,
  /** Spawns a projectile instead of a melee box. */
  Projectile = 1 << 1,
  /** Grab: whiffs on airborne opponents, breakable on the first 5 frames. */
  Grab = 1 << 2,
  /** Travels a long distance forward; used by the AI to gauge range. */
  Lunge = 1 << 3,
  /** Drains the opponent's special meter on connect. */
  Siphon = 1 << 4,
  /** Can be blocked but still deals chip damage. */
  Chip = 1 << 5,
  /** Knocks the opponent into breakable scenery on a wall hit. */
  WallSplat = 1 << 6,
}

/**
 * Axis-aligned box in the fighter's own facing-relative space.
 * +x is forward, +y is up, +z is the fighter's right.
 */
export interface Box {
  x: Fx
  y: Fx
  z: Fx
  /** Half-extents. */
  hw: Fx
  hh: Fx
  hd: Fx
}

export function box(x: number, y: number, z: number, hw: number, hh: number, hd: number): Box {
  return { x: fxFrom(x), y: fxFrom(y), z: fxFrom(z), hw: fxFrom(hw), hh: fxFrom(hh), hd: fxFrom(hd) }
}

/** A hitbox and the frames of the move on which it is live. */
export interface HitboxSpec {
  box: Box
  /** Inclusive, measured from frame 0 of the move. */
  from: number
  /** Exclusive. */
  to: number
}

export interface MoveDef {
  id: string
  name: string

  /** Frames before the first hitbox appears. */
  startup: number
  /** Frames the hitboxes stay live. */
  active: number
  /** Frames after the last active frame before the fighter is free. */
  recovery: number

  damage: number
  /** Damage dealt through a correct block. */
  chip: number
  hitstun: number
  blockstun: number

  guard: Guard
  kind: DamageKind
  reaction: Reaction
  flags: MoveFlag

  hitboxes: HitboxSpec[]

  /** Forward movement applied per frame while the move runs. */
  advance: Fx
  /** Frames over which `advance` applies, from frame 0. */
  advanceFrames: number

  /** Horizontal and vertical impulse applied to the victim on hit. */
  pushbackHit: Fx
  pushbackBlock: Fx
  launchY: Fx

  /** Special-meter cost. Moves the fighter cannot afford simply do not start. */
  cost: number
  meterOnHit: number
  meterOnBlock: number
  meterOnWhiff: number

  /** Moves this one may be cancelled into, and the window in which that is legal. */
  cancelInto: readonly string[]
  cancelFrom: number
  cancelTo: number

  /** Projectile parameters, read only when MoveFlag.Projectile is set. */
  projectile?: {
    speed: Fx
    lifetime: number
    box: Box
  }
}

/**
 * Partial move authoring. Every field a move does not care about gets a sane
 * default, which keeps the character tables readable — a jab should not have
 * to declare that it spawns no projectile.
 */
export type MoveSpec = Pick<MoveDef, 'id' | 'name' | 'startup' | 'active' | 'recovery' | 'damage' | 'hitboxes'> &
  Partial<MoveDef>

export function move(spec: MoveSpec): MoveDef {
  return {
    chip: 0,
    hitstun: 16,
    blockstun: 10,
    guard: Guard.Mid,
    kind: DamageKind.Physical,
    reaction: Reaction.Stand,
    flags: MoveFlag.None,
    advance: 0,
    advanceFrames: 0,
    pushbackHit: fxFrom(0.10),
    pushbackBlock: fxFrom(0.14),
    launchY: 0,
    cost: 0,
    meterOnHit: 6,
    meterOnBlock: 2,
    meterOnWhiff: 1,
    cancelInto: [],
    cancelFrom: 0,
    cancelTo: 0,
    ...spec,
  }
}

export function totalFrames(m: MoveDef): number {
  return m.startup + m.active + m.recovery
}

/* ------------------------------------------------------------------ */
/* Character-unique resource mechanics                                  */
/* ------------------------------------------------------------------ */

/**
 * How a fighter's signature meter fills. Kept as data rather than a callback
 * so a character can be described entirely by a table and so the AI can reason
 * about what it is trying to build.
 */
export type MeterRule =
  /** Fills on successful guards and parries. */
  | { kind: 'guard'; perBlock: number; perParry: number }
  /** Fills on forward pressure and consecutive hits. */
  | { kind: 'offense'; perHit: number; perComboStep: number; perForwardFrame: number }
  /** Fills on damage received. */
  | { kind: 'punished'; perDamage: number }
  /** Fills passively while analysing; the payload is handled by `adaptation`. */
  | { kind: 'adaptive'; perBlockedHit: number }

/** What spending a full meter does. */
export type MeterPayload =
  /** Slows the opponent's move timers and marks their counter windows. */
  | { kind: 'timeDilation'; frames: number; opponentRateNum: number; opponentRateDen: number }
  /** Speed and recovery buff. */
  | { kind: 'rally'; frames: number; speedNum: number; speedDen: number; recoveryCut: number }
  /** Super armor against light attacks, multiplied heavy damage. */
  | { kind: 'berserk'; frames: number; armorAgainstDamageUpTo: number; heavyDamageNum: number; heavyDamageDen: number }
  /** Immunity to whichever damage kind was analysed. */
  | { kind: 'adaptShield'; frames: number; hitsToAnalyse: number }

export interface CharacterDef {
  id: string
  name: string
  title: string
  archetype: string
  /** Display colour, also used for the placeholder mesh and HUD accents. */
  color: number
  accent: number

  health: number
  walkForward: Fx
  walkBack: Fx
  sidestep: Fx
  dashForward: Fx
  dashBack: Fx
  jumpImpulse: Fx
  gravity: Fx
  /** Cylinder the fighters cannot overlap. */
  pushRadius: Fx
  height: Fx

  /** Star-chart values for the select screen, 0..10. Cosmetic. */
  stats: { power: number; speed: number; defense: number; range: number }

  meterRule: MeterRule
  meterMax: number
  meterPayload: MeterPayload

  /** Special-meter pool spent by `cost` moves, separate from the signature meter. */
  specialMax: number

  hurtbox: Box
  crouchHurtbox: Box

  moves: Record<string, MoveDef>
  /**
   * Button -> move id for the neutral ground game. Both of a character's
   * signature moves are reachable from a button: the standing special and the
   * crouching one. Leaving the second reachable only through a cancel would
   * make half the roster's kit unusable in neutral.
   */
  normals: {
    light: string
    heavy: string
    special: string
    crouchSpecial: string
    throw: string
    crouchLight: string
    airLight: string
  }
}

export interface Breakable {
  x: Fx
  z: Fx
  hw: Fx
  hd: Fx
  /** Damage the object absorbs before shattering. */
  integrity: number
}

export interface ArenaDef {
  id: string
  name: string
  /** Half-extents of the play space on X and Z. */
  halfWidth: Fx
  halfDepth: Fx
  breakables: Breakable[]
  fogColor: number
  floorColor: number
  gridColor: number
}
