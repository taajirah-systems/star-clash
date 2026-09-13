/**
 * Vorn Kalash — "The Ironclad"
 * Verge clan warrior. Heavy brawler / stance breaker.
 *
 * Vorn's meter fills from damage taken, which only pays off if he survives to
 * spend it — hence the largest health pool, the slowest walk, and normals with
 * enough blockstun that a blocked glaive still leaves him his turn.
 */

import { box, move, Guard, Reaction, MoveFlag, type CharacterDef } from '../../core/defs'
import { fxFrom } from '../../core/fx'

const moves = {
  light: move({
    id: 'light', name: 'Gauntlet Backhand',
    startup: 9, active: 3, recovery: 12,
    damage: 40, hitstun: 16, blockstun: 12,
    guard: Guard.Mid,
    hitboxes: [{ box: box(0.80, 1.34, 0, 0.34, 0.20, 0.24), from: 9, to: 12 }],
    pushbackHit: fxFrom(0.14), pushbackBlock: fxFrom(0.18),
    cancelInto: ['heavy', 'glaiveStorm', 'bulwarkCharge'],
    cancelFrom: 9, cancelTo: 19,
  }),

  heavy: move({
    id: 'heavy', name: 'Overhead Cleave',
    startup: 18, active: 5, recovery: 24,
    damage: 105, chip: 14, hitstun: 24, blockstun: 20,
    guard: Guard.Mid,
    flags: MoveFlag.SuperArmor | MoveFlag.Chip,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.95, 1.10, 0, 0.44, 0.60, 0.30), from: 18, to: 23 }],
    pushbackHit: fxFrom(0.30), pushbackBlock: fxFrom(0.26),
    cancelInto: ['glaiveStorm'],
    cancelFrom: 18, cancelTo: 32,
  }),

  crouchLight: move({
    id: 'crouchLight', name: 'Shin Kick',
    startup: 9, active: 3, recovery: 14,
    damage: 32, hitstun: 14, blockstun: 11,
    guard: Guard.Low,
    hitboxes: [{ box: box(0.70, 0.28, 0, 0.34, 0.20, 0.24), from: 9, to: 12 }],
    cancelInto: ['glaiveStorm'],
    cancelFrom: 9, cancelTo: 18,
  }),

  airLight: move({
    id: 'airLight', name: 'Falling Hammer',
    startup: 11, active: 7, recovery: 14,
    damage: 58, hitstun: 20, blockstun: 14,
    guard: Guard.High,
    hitboxes: [{ box: box(0.56, 0.72, 0, 0.34, 0.38, 0.26), from: 11, to: 18 }],
  }),

  throw: move({
    id: 'throw', name: 'Clan Slam',
    startup: 9, active: 3, recovery: 26,
    damage: 82, hitstun: 38, blockstun: 0,
    guard: Guard.Command, flags: MoveFlag.Grab | MoveFlag.WallSplat,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.56, 1.05, 0, 0.36, 0.52, 0.30), from: 9, to: 12 }],
    pushbackHit: fxFrom(0.48),
  }),

  /** Wide-arc double-bladed combo. High block-stun is the whole selling point. */
  glaiveStorm: move({
    id: 'glaiveStorm', name: "Glaive Storm",
    startup: 15, active: 22, recovery: 26,
    damage: 42, chip: 10, hitstun: 20, blockstun: 22,
    guard: Guard.Mid,
    flags: MoveFlag.SuperArmor | MoveFlag.Chip,
    reaction: Reaction.Stagger,
    hitboxes: [
      { box: box(0.95, 1.20, 0.28, 0.52, 0.34, 0.40), from: 15, to: 20 },
      { box: box(0.95, 1.20, -0.28, 0.52, 0.34, 0.40), from: 23, to: 28 },
      { box: box(1.05, 1.05, 0, 0.60, 0.48, 0.46), from: 32, to: 37 },
    ],
    advance: fxFrom(0.016), advanceFrames: 30,
    pushbackHit: fxFrom(0.16), pushbackBlock: fxFrom(0.22),
    cost: 35,
  }),

  /** Long-range shoulder barge; sends the victim into the scenery. */
  bulwarkCharge: move({
    id: 'bulwarkCharge', name: 'Bulwark Charge',
    startup: 16, active: 12, recovery: 30,
    damage: 100, chip: 12, hitstun: 28, blockstun: 18,
    guard: Guard.Mid,
    flags: MoveFlag.SuperArmor | MoveFlag.Lunge | MoveFlag.Chip | MoveFlag.WallSplat,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.66, 1.05, 0, 0.42, 0.52, 0.30), from: 16, to: 28 }],
    advance: fxFrom(0.130), advanceFrames: 28,
    pushbackHit: fxFrom(0.58), pushbackBlock: fxFrom(0.32),
    cost: 30,
  }),
}

export const VORN: CharacterDef = {
  id: 'vorn',
  name: 'Vorn Kalash',
  title: 'The Ironclad',
  archetype: 'Heavy Brawler / Stance Breaker',
  color: 0x8d3a2e,
  accent: 0xff9c6b,

  health: 1180,
  walkForward: fxFrom(0.034),
  walkBack: fxFrom(0.028),
  sidestep: fxFrom(0.040),
  dashForward: fxFrom(0.100),
  dashBack: fxFrom(0.084),
  jumpImpulse: fxFrom(0.250),
  gravity: fxFrom(0.0225),
  pushRadius: fxFrom(0.40),
  height: fxFrom(1.98),

  stats: { power: 10, speed: 3, defense: 8, range: 8 },

  meterRule: { kind: 'punished', perDamage: 1 },
  meterMax: 520,
  meterPayload: {
    kind: 'berserk', frames: 420,
    armorAgainstDamageUpTo: 55,
    heavyDamageNum: 2, heavyDamageDen: 1,
  },

  specialMax: 100,

  hurtbox: box(0, 0.99, 0, 0.36, 0.99, 0.34),
  crouchHurtbox: box(0, 0.62, 0, 0.40, 0.62, 0.36),

  moves,
  normals: {
    light: 'light', heavy: 'heavy', special: 'glaiveStorm', crouchSpecial: 'bulwarkCharge', throw: 'throw',
    crouchLight: 'crouchLight', airLight: 'airLight',
  },
}
