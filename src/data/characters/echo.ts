/**
 * Echo-Nine — "The Reclaimed"
 * Severed from the Weave collective. Setplay / zone control.
 *
 * Echo-Nine wins by making the opponent commit to one damage category and then
 * turning it off. Everything else in the kit exists to force that commitment:
 * a projectile that punishes patience and a meter-draining low that punishes
 * the special-move answer to the projectile.
 */

import { box, move, Guard, DamageKind, Reaction, MoveFlag, type CharacterDef } from '../../core/defs'
import { fxFrom } from '../../core/fx'

const moves = {
  light: move({
    id: 'light', name: 'Servo Jab',
    startup: 7, active: 3, recovery: 11,
    damage: 30, hitstun: 15, blockstun: 10,
    guard: Guard.Mid,
    hitboxes: [{ box: box(0.70, 1.30, 0, 0.30, 0.18, 0.22), from: 7, to: 10 }],
    cancelInto: ['heavy', 'naniteLance', 'siphonSweep'],
    cancelFrom: 7, cancelTo: 17,
  }),

  heavy: move({
    id: 'heavy', name: 'Arc Backhand',
    startup: 13, active: 4, recovery: 19,
    damage: 70, hitstun: 22, blockstun: 15,
    guard: Guard.Mid, kind: DamageKind.Energy,
    hitboxes: [{ box: box(0.84, 1.20, 0, 0.38, 0.30, 0.26), from: 13, to: 17 }],
    pushbackHit: fxFrom(0.22), pushbackBlock: fxFrom(0.24),
    cancelInto: ['naniteLance'],
    cancelFrom: 13, cancelTo: 26,
  }),

  crouchLight: move({
    id: 'crouchLight', name: 'Low Servo',
    startup: 8, active: 3, recovery: 12,
    damage: 26, hitstun: 14, blockstun: 9,
    guard: Guard.Low,
    hitboxes: [{ box: box(0.64, 0.26, 0, 0.32, 0.18, 0.22), from: 8, to: 11 }],
    cancelInto: ['siphonSweep', 'naniteLance'],
    cancelFrom: 8, cancelTo: 16,
  }),

  airLight: move({
    id: 'airLight', name: 'Descent Cut',
    startup: 9, active: 6, recovery: 12,
    damage: 44, hitstun: 18, blockstun: 12,
    guard: Guard.High, kind: DamageKind.Energy,
    hitboxes: [{ box: box(0.50, 0.78, 0, 0.30, 0.32, 0.24), from: 9, to: 15 }],
  }),

  throw: move({
    id: 'throw', name: 'Tether Pull',
    startup: 8, active: 3, recovery: 25,
    damage: 60, hitstun: 34, blockstun: 0,
    guard: Guard.Command, flags: MoveFlag.Grab,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.52, 1.05, 0, 0.34, 0.50, 0.28), from: 8, to: 11 }],
    pushbackHit: fxFrom(0.30),
  }),

  /** Projectile disruption wave from the hand apparatus. */
  naniteLance: move({
    id: 'naniteLance', name: 'Nanite Lance',
    startup: 15, active: 2, recovery: 26,
    damage: 64, chip: 12, hitstun: 22, blockstun: 16,
    guard: Guard.Mid, kind: DamageKind.Energy,
    flags: MoveFlag.Projectile | MoveFlag.Chip,
    reaction: Reaction.Stand,
    // The move itself has no melee box; the spawned projectile carries the hit.
    hitboxes: [],
    pushbackHit: fxFrom(0.24), pushbackBlock: fxFrom(0.20),
    cost: 25,
    projectile: {
      speed: fxFrom(0.155),
      lifetime: 110,
      box: box(0, 0, 0, 0.24, 0.20, 0.20),
    },
  }),

  /** Low sweep that drains a slice of the opponent's special pool. */
  siphonSweep: move({
    id: 'siphonSweep', name: 'Siphon Sweep',
    startup: 13, active: 5, recovery: 24,
    damage: 56, chip: 8, hitstun: 24, blockstun: 14,
    guard: Guard.Low, kind: DamageKind.Physical,
    flags: MoveFlag.Siphon | MoveFlag.Chip,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.88, 0.24, 0, 0.46, 0.20, 0.28), from: 13, to: 18 }],
    advance: fxFrom(0.024), advanceFrames: 14,
    pushbackHit: fxFrom(0.30), pushbackBlock: fxFrom(0.22),
    cost: 25,
  }),
}

export const ECHO: CharacterDef = {
  id: 'echo',
  name: 'Echo-Nine',
  title: 'The Reclaimed',
  archetype: 'Setplay / Zone Control',
  color: 0x4b8f6d,
  accent: 0x9dffcf,

  health: 950,
  walkForward: fxFrom(0.040),
  walkBack: fxFrom(0.040),
  sidestep: fxFrom(0.050),
  dashForward: fxFrom(0.110),
  dashBack: fxFrom(0.112),
  jumpImpulse: fxFrom(0.262),
  gravity: fxFrom(0.0200),
  pushRadius: fxFrom(0.33),
  height: fxFrom(1.78),

  stats: { power: 6, speed: 7, defense: 7, range: 10 },

  meterRule: { kind: 'adaptive', perBlockedHit: 34 },
  meterMax: 100,
  meterPayload: { kind: 'adaptShield', frames: 360, hitsToAnalyse: 3 },

  specialMax: 100,

  hurtbox: box(0, 0.89, 0, 0.30, 0.89, 0.30),
  crouchHurtbox: box(0, 0.55, 0, 0.33, 0.55, 0.32),

  moves,
  normals: {
    light: 'light', heavy: 'heavy', special: 'naniteLance', crouchSpecial: 'siphonSweep', throw: 'throw',
    crouchLight: 'crouchLight', airLight: 'airLight',
  },
}
