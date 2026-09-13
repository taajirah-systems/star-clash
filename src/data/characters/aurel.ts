/**
 * Aurel Vance — "The Calculus"
 * Concord xenologist. Precision counter-attacker.
 *
 * Archetype note: Aurel is the only fighter whose signature meter fills purely
 * from defence, so the whole kit is built to make holding guard survivable —
 * a fast mid to check approaches and a guard-breaking grab so that the
 * opponent cannot simply block back once Aurel takes their turn.
 */

import { box, move, Guard, DamageKind, Reaction, MoveFlag, type CharacterDef } from '../../core/defs'
import { fxFrom } from '../../core/fx'

const moves = {
  light: move({
    id: 'light', name: 'Precision Jab',
    startup: 7, active: 3, recovery: 10,
    damage: 34, hitstun: 15, blockstun: 10,
    guard: Guard.Mid,
    hitboxes: [{ box: box(0.72, 1.32, 0, 0.30, 0.18, 0.22), from: 7, to: 10 }],
    cancelInto: ['heavy', 'axiomStrike', 'neuralClasp'],
    cancelFrom: 7, cancelTo: 16,
    meterOnHit: 3,
  }),

  heavy: move({
    id: 'heavy', name: 'Descending Chop',
    startup: 14, active: 4, recovery: 20,
    damage: 78, hitstun: 22, blockstun: 15,
    guard: Guard.Mid, reaction: Reaction.Stagger,
    hitboxes: [{ box: box(0.80, 1.15, 0, 0.34, 0.42, 0.24), from: 14, to: 18 }],
    pushbackHit: fxFrom(0.16), pushbackBlock: fxFrom(0.20),
    cancelInto: ['axiomStrike'],
    cancelFrom: 14, cancelTo: 26,
  }),

  crouchLight: move({
    id: 'crouchLight', name: 'Low Sweep Check',
    startup: 8, active: 3, recovery: 12,
    damage: 28, hitstun: 14, blockstun: 9,
    guard: Guard.Low,
    hitboxes: [{ box: box(0.66, 0.28, 0, 0.32, 0.20, 0.22), from: 8, to: 11 }],
    cancelInto: ['axiomStrike'],
    cancelFrom: 8, cancelTo: 16,
  }),

  airLight: move({
    id: 'airLight', name: 'Falling Edge',
    startup: 9, active: 6, recovery: 12,
    damage: 46, hitstun: 18, blockstun: 12,
    guard: Guard.High,
    hitboxes: [{ box: box(0.52, 0.80, 0, 0.30, 0.34, 0.24), from: 9, to: 15 }],
  }),

  throw: move({
    id: 'throw', name: 'Redirect',
    startup: 8, active: 3, recovery: 24,
    damage: 62, hitstun: 34, blockstun: 0,
    guard: Guard.Command, flags: MoveFlag.Grab,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.52, 1.05, 0, 0.34, 0.50, 0.28), from: 8, to: 11 }],
    pushbackHit: fxFrom(0.34),
  }),

  /**
   * Command grab that beats guard outright. This is the answer to an opponent
   * who has learned to sit on block against a counter-attacker.
   */
  neuralClasp: move({
    id: 'neuralClasp', name: 'Neural Clasp',
    startup: 12, active: 3, recovery: 28,
    damage: 70, hitstun: 60, blockstun: 0,
    guard: Guard.Command, flags: MoveFlag.Grab,
    reaction: Reaction.Paralyze,
    kind: DamageKind.Physical,
    hitboxes: [{ box: box(0.58, 1.10, 0, 0.34, 0.48, 0.28), from: 12, to: 15 }],
    pushbackHit: 0,
    cost: 25,
    meterOnHit: 0,
  }),

  /** Mid-range kinetic palm thrust with a localised shockwave. */
  axiomStrike: move({
    id: 'axiomStrike', name: 'Axiom Strike',
    startup: 16, active: 5, recovery: 22,
    damage: 92, chip: 12, hitstun: 26, blockstun: 18,
    guard: Guard.Mid, kind: DamageKind.Energy,
    flags: MoveFlag.Chip | MoveFlag.WallSplat,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(1.05, 1.15, 0, 0.52, 0.44, 0.34), from: 16, to: 21 }],
    advance: fxFrom(0.028), advanceFrames: 16,
    pushbackHit: fxFrom(0.42), pushbackBlock: fxFrom(0.26),
    cost: 35,
  }),
}

export const AUREL: CharacterDef = {
  id: 'aurel',
  name: 'Aurel Vance',
  title: 'The Calculus',
  archetype: 'Precision / Counter-attacker',
  color: 0x2f6fb8,
  accent: 0x9fd8ff,

  health: 1000,
  walkForward: fxFrom(0.042),
  walkBack: fxFrom(0.036),
  sidestep: fxFrom(0.052),
  dashForward: fxFrom(0.115),
  dashBack: fxFrom(0.105),
  jumpImpulse: fxFrom(0.265),
  gravity: fxFrom(0.0205),
  pushRadius: fxFrom(0.34),
  height: fxFrom(1.82),

  stats: { power: 6, speed: 6, defense: 9, range: 7 },

  meterRule: { kind: 'guard', perBlock: 9, perParry: 26 },
  meterMax: 100,
  meterPayload: { kind: 'timeDilation', frames: 300, opponentRateNum: 2, opponentRateDen: 3 },

  specialMax: 100,

  hurtbox: box(0, 0.91, 0, 0.30, 0.91, 0.30),
  crouchHurtbox: box(0, 0.56, 0, 0.33, 0.56, 0.32),

  moves,
  normals: {
    light: 'light', heavy: 'heavy', special: 'axiomStrike', crouchSpecial: 'neuralClasp', throw: 'throw',
    crouchLight: 'crouchLight', airLight: 'airLight',
  },
}
