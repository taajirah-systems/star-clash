/**
 * Mutable match state and its snapshot/restore pair.
 *
 * Save and load are written out field by field rather than via structuredClone.
 * That is deliberate: a field the sim mutates but this file forgets to copy is
 * a rollback desync, and desyncs are close to undebuggable after the fact. An
 * explicit list can be read against the struct and audited. It is also far
 * cheaper — rollback may re-save state every single frame.
 */

import { fxFrom, type Fx } from './fx'
import { St } from './fsm'
import { InputBuffer, type InputFrame } from './input'
import type { DamageKind } from './defs'

export const MAX_PROJECTILES = 8
export const MAX_BREAKABLES = 12

export const enum Phase {
  Intro,
  Fight,
  KO,
  RoundEnd,
  MatchEnd,
}

export interface ProjectileState {
  active: 0 | 1
  owner: 0 | 1
  x: Fx
  y: Fx
  z: Fx
  vx: Fx
  life: number
  /** Index into the owner's move list, for damage lookup. */
  moveIndex: number
}

export interface FighterState {
  /** Index into the match roster. */
  charIndex: number
  slot: 0 | 1

  x: Fx
  y: Fx
  z: Fx
  vx: Fx
  vy: Fx
  vz: Fx
  facing: 1 | -1

  state: St
  stateFrame: number
  /** 0 means "until something else changes it". */
  stateDuration: number

  /** Index into the character's ordered move list; -1 when not attacking. */
  moveIndex: number
  moveFrame: number
  /**
   * Bitmask of which of the current move's hitbox windows have already
   * connected. A bitmask rather than a boolean so that a multi-hit move like
   * Glaive Storm lands each of its three arcs exactly once.
   */
  moveHasConnected: number
  /** Set while the current move is inside its cancel window and has connected. */
  cancelArmed: 0 | 1

  health: number
  /** Signature meter, 0..meterMax. */
  meter: number
  /** Special-move resource, 0..specialMax. */
  special: number

  comboCount: number
  /** Damage scaling numerator over 100; drops as a combo extends. */
  comboScale: number
  /**
   * Consecutive frames the opponent has spent out of stun. A combo ends when
   * the victim is free, not when the attacker happens to stand still, so this
   * counts the victim's freedom rather than the attacker's idleness.
   */
  comboIdle: number
  juggleCount: number

  /** Frames remaining on this fighter's own activated payload. */
  payloadFrames: number
  /** Frames this fighter is slowed by an opponent's time dilation. */
  dilatedFrames: number
  /**
   * Dilation expressed as an exact rational (num/den of frames allowed) plus
   * an integer accumulator. A float rate would drift between peers; this
   * cannot.
   */
  dilationRateNum: number
  dilationRateDen: number
  dilationAccum: number

  /** Echo-Nine adaptation counters. */
  analysedPhysical: number
  analysedEnergy: number
  /** -1 when no shield is up, otherwise the immune DamageKind. */
  shieldKind: number
  shieldFrames: number

  /** Frames left in which a throw can be teched. */
  throwTechWindow: number
  /** Frames left in which an incoming attack is parried rather than blocked. */
  parryWindow: number

  /** Guard held last frame; used to detect fresh guards for the guard meter. */
  wasGuarding: 0 | 1

  inputs: InputBuffer
}

export interface HitEvent {
  attacker: 0 | 1
  x: Fx
  y: Fx
  z: Fx
  damage: number
  kind: DamageKind
  blocked: boolean
  parried: boolean
  counter: boolean
}

export interface MatchState {
  frame: number
  phase: Phase
  phaseFrame: number

  round: number
  roundTimerFrames: number
  roundsWon: [number, number]

  /** Global freeze on impact — both fighters and projectiles stop. */
  hitstop: number

  fighters: [FighterState, FighterState]
  projectiles: ProjectileState[]
  breakableIntegrity: number[]

  rng: number

  /** Regenerated every tick for the renderer; never trusted across a rollback. */
  events: HitEvent[]
}

export function createFighter(charIndex: number, slot: 0 | 1, x: Fx, facing: 1 | -1): FighterState {
  return {
    charIndex,
    slot,
    x,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing,
    state: St.Idle,
    stateFrame: 0,
    stateDuration: 0,
    moveIndex: -1,
    moveFrame: 0,
    moveHasConnected: 0,
    cancelArmed: 0,
    health: 1000,
    meter: 0,
    special: 0,
    comboCount: 0,
    comboScale: 100,
    comboIdle: 0,
    juggleCount: 0,
    payloadFrames: 0,
    dilatedFrames: 0,
    dilationRateNum: 1,
    dilationRateDen: 1,
    dilationAccum: 0,
    analysedPhysical: 0,
    analysedEnergy: 0,
    shieldKind: -1,
    shieldFrames: 0,
    throwTechWindow: 0,
    parryWindow: 0,
    wasGuarding: 0,
    inputs: new InputBuffer(),
  }
}

export function createMatch(
  charA: number,
  charB: number,
  roundSeconds: number,
  breakableCount: number,
  seed = 0x2f6e2b1,
): MatchState {
  const projectiles: ProjectileState[] = []
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    projectiles.push({ active: 0, owner: 0, x: 0, y: 0, z: 0, vx: 0, life: 0, moveIndex: -1 })
  }
  return {
    frame: 0,
    phase: Phase.Intro,
    phaseFrame: 0,
    round: 1,
    roundTimerFrames: roundSeconds * 60,
    roundsWon: [0, 0],
    hitstop: 0,
    fighters: [
      createFighter(charA, 0, fxFrom(-2.2), 1),
      createFighter(charB, 1, fxFrom(2.2), -1),
    ],
    projectiles,
    breakableIntegrity: new Array(breakableCount).fill(100),
    rng: seed >>> 0,
    events: [],
  }
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                            */
/* ------------------------------------------------------------------ */

export interface Snapshot {
  frame: number
  phase: Phase
  phaseFrame: number
  round: number
  roundTimerFrames: number
  roundsWon: [number, number]
  hitstop: number
  rng: number
  fighters: FighterSnapshot[]
  projectiles: ProjectileState[]
  breakableIntegrity: number[]
}

type FighterSnapshot = Omit<FighterState, 'inputs'> & {
  inputData: Uint16Array
  inputHead: number
}

function saveFighter(f: FighterState): FighterSnapshot {
  return {
    charIndex: f.charIndex,
    slot: f.slot,
    x: f.x, y: f.y, z: f.z,
    vx: f.vx, vy: f.vy, vz: f.vz,
    facing: f.facing,
    state: f.state,
    stateFrame: f.stateFrame,
    stateDuration: f.stateDuration,
    moveIndex: f.moveIndex,
    moveFrame: f.moveFrame,
    moveHasConnected: f.moveHasConnected,
    cancelArmed: f.cancelArmed,
    health: f.health,
    meter: f.meter,
    special: f.special,
    comboCount: f.comboCount,
    comboScale: f.comboScale,
    comboIdle: f.comboIdle,
    juggleCount: f.juggleCount,
    payloadFrames: f.payloadFrames,
    dilatedFrames: f.dilatedFrames,
    dilationRateNum: f.dilationRateNum,
    dilationRateDen: f.dilationRateDen,
    dilationAccum: f.dilationAccum,
    analysedPhysical: f.analysedPhysical,
    analysedEnergy: f.analysedEnergy,
    shieldKind: f.shieldKind,
    shieldFrames: f.shieldFrames,
    throwTechWindow: f.throwTechWindow,
    parryWindow: f.parryWindow,
    wasGuarding: f.wasGuarding,
    inputHead: f.inputs.headIndex,
    inputData: f.inputs.serialize(),
  }
}

function loadFighter(f: FighterState, s: FighterSnapshot): void {
  f.charIndex = s.charIndex
  f.slot = s.slot
  f.x = s.x; f.y = s.y; f.z = s.z
  f.vx = s.vx; f.vy = s.vy; f.vz = s.vz
  f.facing = s.facing
  f.state = s.state
  f.stateFrame = s.stateFrame
  f.stateDuration = s.stateDuration
  f.moveIndex = s.moveIndex
  f.moveFrame = s.moveFrame
  f.moveHasConnected = s.moveHasConnected
  f.cancelArmed = s.cancelArmed
  f.health = s.health
  f.meter = s.meter
  f.special = s.special
  f.comboCount = s.comboCount
  f.comboScale = s.comboScale
  f.comboIdle = s.comboIdle
  f.juggleCount = s.juggleCount
  f.payloadFrames = s.payloadFrames
  f.dilatedFrames = s.dilatedFrames
  f.dilationRateNum = s.dilationRateNum
  f.dilationRateDen = s.dilationRateDen
  f.dilationAccum = s.dilationAccum
  f.analysedPhysical = s.analysedPhysical
  f.analysedEnergy = s.analysedEnergy
  f.shieldKind = s.shieldKind
  f.shieldFrames = s.shieldFrames
  f.throwTechWindow = s.throwTechWindow
  f.parryWindow = s.parryWindow
  f.wasGuarding = s.wasGuarding
  f.inputs.restore(s.inputData, s.inputHead)
}

export function saveState(m: MatchState): Snapshot {
  return {
    frame: m.frame,
    phase: m.phase,
    phaseFrame: m.phaseFrame,
    round: m.round,
    roundTimerFrames: m.roundTimerFrames,
    roundsWon: [m.roundsWon[0], m.roundsWon[1]],
    hitstop: m.hitstop,
    rng: m.rng,
    fighters: [saveFighter(m.fighters[0]), saveFighter(m.fighters[1])],
    projectiles: m.projectiles.map((p) => ({ ...p })),
    breakableIntegrity: m.breakableIntegrity.slice(),
  }
}

export function loadState(m: MatchState, s: Snapshot): void {
  m.frame = s.frame
  m.phase = s.phase
  m.phaseFrame = s.phaseFrame
  m.round = s.round
  m.roundTimerFrames = s.roundTimerFrames
  m.roundsWon[0] = s.roundsWon[0]
  m.roundsWon[1] = s.roundsWon[1]
  m.hitstop = s.hitstop
  m.rng = s.rng
  loadFighter(m.fighters[0], s.fighters[0]!)
  loadFighter(m.fighters[1], s.fighters[1]!)
  for (let i = 0; i < m.projectiles.length; i++) {
    const src = s.projectiles[i]!
    const dst = m.projectiles[i]!
    dst.active = src.active; dst.owner = src.owner
    dst.x = src.x; dst.y = src.y; dst.z = src.z
    dst.vx = src.vx; dst.life = src.life; dst.moveIndex = src.moveIndex
  }
  for (let i = 0; i < m.breakableIntegrity.length; i++) {
    m.breakableIntegrity[i] = s.breakableIntegrity[i]!
  }
  // Visual events are derived, not authoritative. Anything a rollback replays
  // will re-emit them, so carrying stale ones over would double up hit sparks.
  m.events.length = 0
}

/**
 * Order-independent checksum over the fields that decide the outcome.
 * Two peers comparing this per frame detect a desync on the frame it happens
 * rather than several seconds later when the health bars visibly disagree.
 */
export function checksum(m: MatchState): number {
  let h = 0x811c9dc5
  const mix = (v: number) => {
    h ^= v | 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  mix(m.frame); mix(m.phase); mix(m.hitstop); mix(m.rng)
  mix(m.roundTimerFrames); mix(m.roundsWon[0]); mix(m.roundsWon[1])
  for (const f of m.fighters) {
    mix(f.x); mix(f.y); mix(f.z)
    mix(f.vx); mix(f.vy); mix(f.vz)
    mix(f.facing); mix(f.state); mix(f.stateFrame); mix(f.stateDuration)
    mix(f.moveIndex); mix(f.moveFrame); mix(f.moveHasConnected); mix(f.cancelArmed)
    mix(f.health); mix(f.meter); mix(f.special)
    mix(f.comboCount); mix(f.comboScale); mix(f.comboIdle); mix(f.juggleCount)
    mix(f.payloadFrames); mix(f.dilatedFrames)
    mix(f.dilationRateNum); mix(f.dilationRateDen); mix(f.dilationAccum)
    mix(f.analysedPhysical); mix(f.analysedEnergy); mix(f.shieldKind); mix(f.shieldFrames)
    mix(f.throwTechWindow); mix(f.parryWindow); mix(f.wasGuarding)
  }
  for (const p of m.projectiles) {
    mix(p.active); mix(p.owner); mix(p.x); mix(p.y); mix(p.z); mix(p.vx); mix(p.life); mix(p.moveIndex)
  }
  for (const b of m.breakableIntegrity) mix(b)
  return h >>> 0
}

/** Deterministic 32-bit PRNG. Used only for cosmetic scatter, never for outcomes. */
export function nextRandom(m: MatchState): number {
  let x = m.rng >>> 0
  x ^= x << 13; x >>>= 0
  x ^= x >>> 17
  x ^= x << 5; x >>>= 0
  m.rng = x
  return x
}

export type { InputFrame }
