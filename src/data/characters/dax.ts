/**
 * Dax Corren — "The Vanguard"
 * Concord captain. Rushdown / momentum leader.
 *
 * Dax's meter rewards moving forward, so the frame data is tuned so that the
 * safest thing he can do is keep taking his turn: fast normals with generous
 * cancel windows and a lunge that closes the round's worth of ground he needs.
 */

import { box, move, Guard, Reaction, MoveFlag, type CharacterDef } from '../../core/defs'
import { fxFrom } from '../../core/fx'

const moves = {
  light: move({
    id: 'light', name: 'Lead Hook',
    startup: 6, active: 3, recovery: 9,
    damage: 32, hitstun: 15, blockstun: 10,
    guard: Guard.Mid,
    hitboxes: [{ box: box(0.68, 1.36, 0, 0.30, 0.18, 0.22), from: 6, to: 9 }],
    cancelInto: ['light', 'heavy', 'cadenceRush', 'vaultKick'],
    cancelFrom: 6, cancelTo: 15,
    meterOnHit: 8,
  }),

  heavy: move({
    id: 'heavy', name: 'Shoulder Cross',
    startup: 12, active: 4, recovery: 18,
    damage: 74, hitstun: 21, blockstun: 14,
    guard: Guard.Mid,
    hitboxes: [{ box: box(0.82, 1.22, 0, 0.36, 0.32, 0.26), from: 12, to: 16 }],
    advance: fxFrom(0.022), advanceFrames: 12,
    pushbackHit: fxFrom(0.18), pushbackBlock: fxFrom(0.22),
    cancelInto: ['cadenceRush'],
    cancelFrom: 12, cancelTo: 24,
    meterOnHit: 10,
  }),

  crouchLight: move({
    id: 'crouchLight', name: 'Boot Scrape',
    startup: 7, active: 3, recovery: 11,
    damage: 26, hitstun: 13, blockstun: 9,
    guard: Guard.Low,
    hitboxes: [{ box: box(0.62, 0.26, 0, 0.32, 0.18, 0.22), from: 7, to: 10 }],
    cancelInto: ['light', 'cadenceRush'],
    cancelFrom: 7, cancelTo: 15,
    meterOnHit: 8,
  }),

  airLight: move({
    id: 'airLight', name: 'Dive Knee',
    startup: 8, active: 6, recovery: 11,
    damage: 48, hitstun: 18, blockstun: 12,
    guard: Guard.High,
    hitboxes: [{ box: box(0.50, 0.76, 0, 0.30, 0.32, 0.24), from: 8, to: 14 }],
    meterOnHit: 8,
  }),

  throw: move({
    id: 'throw', name: 'Collar Toss',
    startup: 8, active: 3, recovery: 24,
    damage: 66, hitstun: 34, blockstun: 0,
    guard: Guard.Command, flags: MoveFlag.Grab,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.52, 1.05, 0, 0.34, 0.50, 0.28), from: 8, to: 11 }],
    pushbackHit: fxFrom(0.40),
    meterOnHit: 12,
  }),

  /** Cross-arena lunging aerial. The tool that turns a read into a round. */
  vaultKick: move({
    id: 'vaultKick', name: 'Vault Dropkick',
    startup: 14, active: 8, recovery: 26,
    damage: 96, chip: 10, hitstun: 26, blockstun: 16,
    guard: Guard.High,
    flags: MoveFlag.Lunge | MoveFlag.Chip | MoveFlag.WallSplat,
    reaction: Reaction.Knockdown,
    hitboxes: [{ box: box(0.72, 1.00, 0, 0.44, 0.34, 0.28), from: 14, to: 22 }],
    advance: fxFrom(0.145), advanceFrames: 22,
    pushbackHit: fxFrom(0.46), pushbackBlock: fxFrom(0.30),
    cost: 30,
    meterOnHit: 14,
  }),

  /**
   * Unorthodox brawling string. The stagger on the last hit is what buys Dax
   * his next turn, which is the entire point of the archetype.
   */
  cadenceRush: move({
    id: 'cadenceRush', name: 'Cadence Rush',
    startup: 10, active: 20, recovery: 22,
    damage: 30, chip: 6, hitstun: 18, blockstun: 13,
    guard: Guard.Mid,
    flags: MoveFlag.Chip,
    reaction: Reaction.Stagger,
    hitboxes: [
      { box: box(0.70, 1.30, 0, 0.32, 0.20, 0.24), from: 10, to: 13 },
      { box: box(0.74, 1.05, 0, 0.34, 0.24, 0.24), from: 16, to: 19 },
      { box: box(0.86, 1.18, 0, 0.40, 0.34, 0.26), from: 25, to: 30 },
    ],
    advance: fxFrom(0.030), advanceFrames: 26,
    pushbackHit: fxFrom(0.12), pushbackBlock: fxFrom(0.18),
    cost: 25,
    meterOnHit: 9,
  }),
}

export const DAX: CharacterDef = {
  id: 'dax',
  name: 'Dax Corren',
  title: 'The Vanguard',
  archetype: 'Rushdown / Momentum Leader',
  color: 0xc9a227,
  accent: 0xffe58a,

  health: 1000,
  walkForward: fxFrom(0.050),
  walkBack: fxFrom(0.036),
  sidestep: fxFrom(0.054),
  dashForward: fxFrom(0.135),
  dashBack: fxFrom(0.100),
  jumpImpulse: fxFrom(0.270),
  gravity: fxFrom(0.0205),
  pushRadius: fxFrom(0.34),
  height: fxFrom(1.80),

  stats: { power: 7, speed: 9, defense: 6, range: 6 },

  meterRule: { kind: 'offense', perHit: 5, perComboStep: 4, perForwardFrame: 1 },
  meterMax: 120,
  meterPayload: { kind: 'rally', frames: 480, speedNum: 5, speedDen: 4, recoveryCut: 3 },

  specialMax: 100,

  hurtbox: box(0, 0.90, 0, 0.31, 0.90, 0.30),
  crouchHurtbox: box(0, 0.55, 0, 0.34, 0.55, 0.32),

  moves,
  normals: {
    light: 'light', heavy: 'heavy', special: 'vaultKick', crouchSpecial: 'cadenceRush', throw: 'throw',
    crouchLight: 'crouchLight', airLight: 'airLight',
  },
}
