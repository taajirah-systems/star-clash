/**
 * The deterministic simulation step.
 *
 * `advanceFrame` is the only function that mutates match state, it takes the
 * frame's inputs as an argument rather than polling any device, and it touches
 * no clock, no Math.random, and no float. Those four properties together are
 * what make the same inputs replay to the same frame on another machine, which
 * is the precondition for rollback netcode and for the tests in tests/.
 */

import {
  fxFrom, fxMul, fxDiv, fxAbs, fxClamp, fxLen2, fxInt, FX_ONE, type Fx,
} from './fx'
import { St, SF, has, isIn } from './fsm'
import { Btn, held, pressed, resolveDir, type InputFrame } from './input'
import {
  Guard, DamageKind, Reaction, MoveFlag, totalFrames,
  type MoveDef, type CharacterDef, type ArenaDef,
} from './defs'
import { characterAt, moveOf, moveIdxOf } from '../data/roster'
import {
  Phase,
  type MatchState, type FighterState,
} from './state'
import { toWorld, overlaps, overlapCenter, boxScratchA, boxScratchB } from './collision'

const HITSTOP_LIGHT = 5
const HITSTOP_HEAVY = 9
const HITSTOP_PARRY = 12

const PARRY_WINDOW = 7
const THROW_TECH_WINDOW = 6
const DASH_FRAMES = 16
const SIDESTEP_FRAMES = 20
const WAKEUP_FRAMES = 22
const KNOCKDOWN_FRAMES = 30
const INTRO_FRAMES = 90
const KO_FRAMES = 90
const ROUND_END_FRAMES = 120

const COMBO_SCALE_STEP = 12
const COMBO_SCALE_FLOOR = 34
const COMBO_RESET_FRAMES = 30
const COUNTER_NUM = 5
const COUNTER_DEN = 4
const MAX_JUGGLE = 4

const CHIP_KO_FLOOR = 1

export interface SimConfig {
  arena: ArenaDef
  roundsToWin: number
  /** Training mode: health and meters refill, rounds never end. */
  training: boolean
}

const spark = { x: 0 as Fx, y: 0 as Fx, z: 0 as Fx }

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function defOf(f: FighterState): CharacterDef {
  return characterAt(f.charIndex).def
}

function currentMove(f: FighterState): MoveDef | null {
  return moveOf(f.charIndex, f.moveIndex)
}

/**
 * `force` re-enters a state the fighter is already in, restarting its frame
 * counter. Without it, an idle fighter whose intent resolves to Idle every
 * frame would sit at stateFrame 0 forever — and anything measuring how long
 * they have been there would never fire. Re-hitting someone already in stun
 * does need the restart, so those call sites pass force.
 */
function setState(f: FighterState, s: St, duration = 0, force = false): void {
  if (f.state === s && !force) {
    f.stateDuration = duration
    return
  }
  f.state = s
  f.stateFrame = 0
  f.stateDuration = duration
  if (!has(s, SF.Attacking)) {
    f.moveIndex = -1
    f.moveFrame = 0
    f.moveHasConnected = 0
    f.cancelArmed = 0
  }
}

function startMove(f: FighterState, moveIdx: number, airborne: boolean): boolean {
  const m = moveOf(f.charIndex, moveIdx)
  if (!m) return false
  if (m.cost > 0) {
    if (f.special < m.cost) return false
    f.special -= m.cost
  }
  f.moveIndex = moveIdx
  f.moveFrame = 0
  f.moveHasConnected = 0
  f.cancelArmed = 0
  f.state = airborne ? St.AttackAir : (m.flags & MoveFlag.Grab) !== 0 ? St.ThrowStartup : St.AttackGround
  f.stateFrame = 0
  f.stateDuration = 0
  return true
}

/**
 * Recovery is shortened while Dax's rally is up. Applied here rather than at
 * authoring time so the buff shows in every move including future ones.
 */
function effectiveTotal(f: FighterState, m: MoveDef): number {
  const d = defOf(f)
  if (f.payloadFrames > 0 && d.meterPayload.kind === 'rally') {
    return Math.max(m.startup + m.active + 1, totalFrames(m) - d.meterPayload.recoveryCut)
  }
  return totalFrames(m)
}

function speedScale(f: FighterState, v: Fx): Fx {
  const d = defOf(f)
  if (f.payloadFrames > 0 && d.meterPayload.kind === 'rally') {
    return fxDiv(fxMul(v, fxInt(d.meterPayload.speedNum)), fxInt(d.meterPayload.speedDen))
  }
  return v
}

/**
 * Time dilation makes a fighter skip frames rather than run at a fractional
 * rate. Skipping keeps every timer an integer, which keeps the sim exactly
 * reproducible — a fractional frame counter would need a float or a second
 * accumulator per timer.
 */
function tickAllowed(f: FighterState): boolean {
  if (f.dilatedFrames <= 0) return true
  const opp = f.dilationRateNum
  const den = f.dilationRateDen
  if (den <= 0) return true
  f.dilationAccum += opp
  if (f.dilationAccum >= den) {
    f.dilationAccum -= den
    return true
  }
  return false
}

function addMeter(f: FighterState, amount: number): void {
  const max = defOf(f).meterMax
  f.meter = Math.min(max, f.meter + amount)
}

function addSpecial(f: FighterState, amount: number): void {
  f.special = Math.max(0, Math.min(defOf(f).specialMax, f.special + amount))
}

function guardCovers(g: Guard, crouching: boolean): boolean {
  switch (g) {
    case Guard.High: return !crouching
    case Guard.Mid: return true
    case Guard.Low: return crouching
    default: return false
  }
}

/* ------------------------------------------------------------------ */
/* Intent                                                               */
/* ------------------------------------------------------------------ */

/**
 * Reads a frame of input into an action, if the fighter is allowed one.
 * Split out from the mutation below so the AI and the replay tests can drive
 * a fighter through exactly the same path a pad does.
 */
function applyIntent(m: MatchState, f: FighterState, cfg: SimConfig): void {
  const cur = f.inputs.current
  const prev = f.inputs.previous
  const d = defOf(f)
  const dir = resolveDir(cur, f.facing)

  // Signature meter burst: hold guard, tap special. Echo-Nine's adaptation is
  // automatic and deliberately has no manual activation.
  if (
    d.meterPayload.kind !== 'adaptShield' &&
    f.meter >= d.meterMax &&
    held(cur, Btn.Guard) &&
    pressed(cur, prev, Btn.Special)
  ) {
    f.meter = 0
    activatePayload(m, f)
    return
  }

  if (!has(f.state, SF.Actionable)) {
    // A connected move inside its cancel window may still be interrupted.
    tryCancel(f, cur, prev)
    return
  }

  const airborne = has(f.state, SF.Airborne)
  const n = d.normals

  if (airborne) {
    if (pressed(cur, prev, Btn.Light) || pressed(cur, prev, Btn.Heavy)) {
      startMove(f, moveIdxOf(f.charIndex, n.airLight), true)
    }
    return
  }

  // Attacks take priority over movement on the frame they are pressed.
  if (pressed(cur, prev, Btn.Throw)) {
    if (startMove(f, moveIdxOf(f.charIndex, n.throw), false)) return
  }
  if (pressed(cur, prev, Btn.Special)) {
    const id = held(cur, Btn.Down) ? n.crouchSpecial : n.special
    if (startMove(f, moveIdxOf(f.charIndex, id), false)) return
  }
  if (pressed(cur, prev, Btn.Heavy)) {
    if (startMove(f, moveIdxOf(f.charIndex, n.heavy), false)) return
  }
  if (pressed(cur, prev, Btn.Light)) {
    const id = has(f.state, SF.Crouching) ? n.crouchLight : n.light
    if (startMove(f, moveIdxOf(f.charIndex, id), false)) return
  }

  if (pressed(cur, prev, Btn.Jump)) {
    f.vy = speedScale(f, d.jumpImpulse)
    if (dir.forward) f.vx = fxMul(speedScale(f, d.walkForward), fxInt(3)) * f.facing
    else if (dir.back) f.vx = -fxMul(speedScale(f, d.walkBack), fxInt(3)) * f.facing
    else f.vx = 0
    setState(f, St.JumpRise)
    return
  }

  // A fresh guard tap opens a parry window; holding guard just blocks.
  const guardHeld = held(cur, Btn.Guard) || dir.back
  if (guardHeld) {
    if (pressed(cur, prev, Btn.Guard) && f.parryWindow === 0 && f.wasGuarding === 0) {
      f.parryWindow = PARRY_WINDOW
      setState(f, St.Parry, PARRY_WINDOW)
      return
    }
    setState(f, held(cur, Btn.Down) ? St.GuardCrouch : St.GuardStand)
    f.wasGuarding = 1
    return
  }
  f.wasGuarding = 0

  if (f.inputs.doubleTapped(f.facing === 1 ? Btn.Right : Btn.Left)) {
    setState(f, St.DashForward, DASH_FRAMES)
    return
  }
  if (f.inputs.doubleTapped(f.facing === 1 ? Btn.Left : Btn.Right)) {
    setState(f, St.DashBack, DASH_FRAMES)
    return
  }

  if (held(cur, Btn.Down) && !dir.forward && !dir.back) {
    setState(f, St.Crouch)
    return
  }
  if (dir.stepLeft) { setState(f, St.SidestepLeft, SIDESTEP_FRAMES); return }
  if (dir.stepRight) { setState(f, St.SidestepRight, SIDESTEP_FRAMES); return }
  if (dir.forward) { setState(f, St.WalkForward); return }
  if (dir.back) { setState(f, St.WalkBack); return }

  void cfg
  setState(f, St.Idle)
}

/**
 * Combo cancellation: a move that has connected may be interrupted inside its
 * declared window by any move it lists. Requiring a connect is what stops
 * cancels from turning whiffed strings into safe pressure.
 */
function tryCancel(f: FighterState, cur: InputFrame, prev: InputFrame): void {
  const m = currentMove(f)
  if (!m || f.cancelArmed === 0) return
  if (f.moveFrame < m.cancelFrom || f.moveFrame > m.cancelTo) return
  if (m.cancelInto.length === 0) return

  const d = defOf(f)
  const n = d.normals
  let wanted = ''
  if (pressed(cur, prev, Btn.Special)) wanted = held(cur, Btn.Down) ? n.crouchSpecial : n.special
  else if (pressed(cur, prev, Btn.Heavy)) wanted = n.heavy
  else if (pressed(cur, prev, Btn.Light)) wanted = has(f.state, SF.Crouching) ? n.crouchLight : n.light
  else if (pressed(cur, prev, Btn.Throw)) wanted = n.throw
  if (!wanted) return

  // The move table may also name a special directly (Aurel's jab -> Axiom).
  let target = wanted
  if (!m.cancelInto.includes(target)) {
    const alt = m.cancelInto.find((id) => id === wanted)
    if (!alt) {
      // Allow cancelling into a listed special via the special button.
      if (pressed(cur, prev, Btn.Special)) {
        const listed = m.cancelInto.find((id) => (d.moves[id]?.cost ?? 0) > 0)
        if (!listed) return
        target = listed
      } else return
    }
  }
  const idx = moveIdxOf(f.charIndex, target)
  if (idx < 0) return
  startMove(f, idx, has(f.state, SF.Airborne))
}

function activatePayload(m: MatchState, f: FighterState): void {
  const d = defOf(f)
  const p = d.meterPayload
  const opp = m.fighters[f.slot === 0 ? 1 : 0]
  switch (p.kind) {
    case 'timeDilation':
      opp.dilatedFrames = p.frames
      opp.dilationRateNum = p.opponentRateNum
      opp.dilationRateDen = p.opponentRateDen
      opp.dilationAccum = 0
      f.payloadFrames = p.frames
      break
    case 'rally':
    case 'berserk':
      f.payloadFrames = p.frames
      break
    case 'adaptShield':
      f.payloadFrames = p.frames
      break
  }
  setState(f, St.MeterBurst, 24)
}

/* ------------------------------------------------------------------ */
/* Movement and physics                                                 */
/* ------------------------------------------------------------------ */

function applyMovement(f: FighterState, arena: ArenaDef): void {
  const d = defOf(f)
  const m = currentMove(f)

  if (m && has(f.state, SF.Attacking) && f.moveFrame < m.advanceFrames && m.advance !== 0) {
    f.x += f.facing * speedScale(f, m.advance)
  }

  if (has(f.state, SF.Mobile)) {
    switch (f.state) {
      case St.WalkForward: f.x += f.facing * speedScale(f, d.walkForward); break
      case St.WalkBack: f.x -= f.facing * speedScale(f, d.walkBack); break
      case St.SidestepLeft: f.z -= speedScale(f, d.sidestep); break
      case St.SidestepRight: f.z += speedScale(f, d.sidestep); break
      case St.DashForward: f.x += f.facing * speedScale(f, d.dashForward); break
      case St.DashBack: f.x -= f.facing * speedScale(f, d.dashBack); break
      default: break
    }
  }

  if (has(f.state, SF.Gravity)) {
    f.vy -= d.gravity
    f.y += f.vy
    f.x += f.vx
    f.z += f.vz
    if (f.y <= 0) {
      f.y = 0
      f.vy = 0
      f.vx = 0
      f.vz = 0
      if (isIn(f.state, St.Reeling)) setState(f, St.Knockdown, KNOCKDOWN_FRAMES)
      else setState(f, St.Idle)
      f.juggleCount = 0
    }
  } else {
    // Grounded knockback decays rather than stopping dead, so a blocked heavy
    // still visibly shoves the defender.
    f.x += f.vx
    f.z += f.vz
    f.vx = f.vx - (f.vx >> 3)
    f.vz = f.vz - (f.vz >> 3)
    if (fxAbs(f.vx) < fxFrom(0.001)) f.vx = 0
    if (fxAbs(f.vz) < fxFrom(0.001)) f.vz = 0
  }

  f.x = fxClamp(f.x, -arena.halfWidth, arena.halfWidth)
  f.z = fxClamp(f.z, -arena.halfDepth, arena.halfDepth)
}

/** Cylindrical pushboxes, separated symmetrically so neither side gains ground. */
function separate(a: FighterState, b: FighterState, arena: ArenaDef): void {
  if (has(a.state, SF.Airborne) && has(b.state, SF.Airborne)) return
  const da = defOf(a)
  const db = defOf(b)
  const minDist = da.pushRadius + db.pushRadius
  let dx = b.x - a.x
  let dz = b.z - a.z
  let dist = fxLen2(dx, dz)
  if (dist >= minDist) return
  if (dist === 0) {
    dx = FX_ONE
    dz = 0
    dist = FX_ONE
  }
  const push = (minDist - dist) >> 1
  const nx = fxDiv(dx, dist)
  const nz = fxDiv(dz, dist)
  a.x -= fxMul(nx, push)
  a.z -= fxMul(nz, push)
  b.x += fxMul(nx, push)
  b.z += fxMul(nz, push)
  a.x = fxClamp(a.x, -arena.halfWidth, arena.halfWidth)
  b.x = fxClamp(b.x, -arena.halfWidth, arena.halfWidth)
  a.z = fxClamp(a.z, -arena.halfDepth, arena.halfDepth)
  b.z = fxClamp(b.z, -arena.halfDepth, arena.halfDepth)
}

/* ------------------------------------------------------------------ */
/* Hit resolution                                                       */
/* ------------------------------------------------------------------ */

function hurtboxOf(f: FighterState) {
  const d = defOf(f)
  return has(f.state, SF.Crouching) ? d.crouchHurtbox : d.hurtbox
}

function damageAfterModifiers(attacker: FighterState, m: MoveDef, base: number): number {
  const d = defOf(attacker)
  let dmg = base
  if (attacker.payloadFrames > 0 && d.meterPayload.kind === 'berserk' && m.id === d.normals.heavy) {
    dmg = Math.floor((dmg * d.meterPayload.heavyDamageNum) / d.meterPayload.heavyDamageDen)
  }
  return dmg
}

/**
 * Vorn's berserk armour and Echo-Nine's adaptation both cancel an incoming hit,
 * but they differ: armour eats the stun and takes the damage, the shield takes
 * neither. Handled here so the difference lives in one place.
 */
function absorbs(victim: FighterState, m: MoveDef, dmg: number): 'armor' | 'shield' | null {
  const d = defOf(victim)
  if (victim.shieldFrames > 0 && victim.shieldKind === (m.kind as number)) return 'shield'
  if (
    victim.payloadFrames > 0 &&
    d.meterPayload.kind === 'berserk' &&
    dmg <= d.meterPayload.armorAgainstDamageUpTo &&
    (m.flags & MoveFlag.Grab) === 0
  ) return 'armor'
  return null
}

function registerAnalysis(victim: FighterState, kind: DamageKind): void {
  const d = defOf(victim)
  if (d.meterPayload.kind !== 'adaptShield') return
  if (kind === DamageKind.Physical) {
    victim.analysedPhysical++
    victim.analysedEnergy = 0
  } else {
    victim.analysedEnergy++
    victim.analysedPhysical = 0
  }
  const need = d.meterPayload.hitsToAnalyse
  const count = kind === DamageKind.Physical ? victim.analysedPhysical : victim.analysedEnergy
  victim.meter = Math.min(d.meterMax, Math.floor((count * d.meterMax) / need))
  if (count >= need) {
    victim.shieldKind = kind as number
    victim.shieldFrames = d.meterPayload.frames
    victim.analysedPhysical = 0
    victim.analysedEnergy = 0
    victim.meter = 0
  }
}

function onGuardMeter(victim: FighterState, parried: boolean): void {
  const rule = defOf(victim).meterRule
  if (rule.kind === 'guard') addMeter(victim, parried ? rule.perParry : rule.perBlock)
}

function applyReaction(victim: FighterState, m: MoveDef, hitstun: number): void {
  switch (m.reaction) {
    case Reaction.Launch:
      victim.vy = m.launchY
      victim.juggleCount++
      setState(victim, St.Juggle, 0, true)
      break
    case Reaction.Knockdown:
      if (has(victim.state, SF.Airborne)) setState(victim, St.Juggle, 0, true)
      else setState(victim, St.Knockdown, KNOCKDOWN_FRAMES, true)
      break
    case Reaction.Stagger:
      setState(victim, St.Stagger, hitstun + 8, true)
      break
    case Reaction.Paralyze:
      setState(victim, St.Paralyzed, hitstun, true)
      break
    default:
      if (has(victim.state, SF.Airborne)) setState(victim, St.Juggle, 0, true)
      else setState(victim, St.HitStun, hitstun, true)
      break
  }
}

/** Returns true when the attack connected in some form. */
function resolveHit(
  m: MatchState,
  attacker: FighterState,
  victim: FighterState,
  mv: MoveDef,
  cfg: SimConfig,
  contactX: Fx, contactY: Fx, contactZ: Fx,
): boolean {
  const isGrab = (mv.flags & MoveFlag.Grab) !== 0

  // Grabs miss airborne opponents outright, which is the counterplay to a
  // command grab and the reason jump exists as a defensive option.
  if (isGrab && !has(victim.state, SF.Grabbable)) return false

  const crouching = has(victim.state, SF.Crouching)
  const guarding = has(victim.state, SF.Guarding) && guardCovers(mv.guard, crouching)
  const parried = victim.parryWindow > 0 && guardCovers(mv.guard, crouching) && !isGrab

  // Throw tech: the victim contesting with their own throw button inside the
  // window trades the grab for a neutral reset instead of eating it.
  if (isGrab) {
    let tapped = false
    for (let i = 0; i < THROW_TECH_WINDOW; i++) {
      if (pressed(victim.inputs.at(i), victim.inputs.at(i + 1), Btn.Throw)) { tapped = true; break }
    }
    if (tapped && !has(victim.state, SF.Reeling)) {
      attacker.vx = -attacker.facing * fxFrom(0.22)
      victim.vx = attacker.facing * fxFrom(0.22)
      setState(attacker, St.Idle)
      setState(victim, St.Idle)
      m.hitstop = HITSTOP_LIGHT
      victim.throwTechWindow = 0
      m.events.push({
        attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
        damage: 0, kind: mv.kind, blocked: true, parried: false, counter: false,
      })
      return true
    }
  }

  let dmg = damageAfterModifiers(attacker, mv, mv.damage)

  if (parried) {
    onGuardMeter(victim, true)
    victim.parryWindow = 0
    m.hitstop = HITSTOP_PARRY
    // The attacker eats the remainder of their move as recovery.
    attacker.moveFrame = Math.max(attacker.moveFrame, mv.startup + mv.active)
    setState(victim, St.GuardStand)
    m.events.push({
      attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
      damage: 0, kind: mv.kind, blocked: true, parried: true, counter: false,
    })
    return true
  }

  const absorbed = absorbs(victim, mv, dmg)
  if (absorbed === 'shield') {
    m.hitstop = HITSTOP_LIGHT
    m.events.push({
      attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
      damage: 0, kind: mv.kind, blocked: true, parried: false, counter: false,
    })
    return true
  }

  if (guarding) {
    const chip = (mv.flags & MoveFlag.Chip) !== 0 ? mv.chip : 0
    if (chip > 0) victim.health = Math.max(CHIP_KO_FLOOR, victim.health - chip)
    victim.vx = attacker.facing * mv.pushbackBlock
    attacker.vx = -attacker.facing * (mv.pushbackBlock >> 1)
    setState(victim, St.BlockStun, mv.blockstun, true)
    onGuardMeter(victim, false)
    registerAnalysis(victim, mv.kind)
    addMeter(attacker, meterForAttacker(attacker, mv, 'block'))
    addSpecial(attacker, mv.meterOnBlock)
    m.hitstop = HITSTOP_LIGHT
    m.events.push({
      attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
      damage: chip, kind: mv.kind, blocked: true, parried: false, counter: false,
    })
    return true
  }

  // Counter hit: catching the victim in the startup of their own attack.
  const counter = has(victim.state, SF.Attacking) &&
    (() => {
      const vm = currentMove(victim)
      return vm !== null && victim.moveFrame < vm.startup
    })()

  if (counter) dmg = Math.floor((dmg * COUNTER_NUM) / COUNTER_DEN)

  if (absorbed === 'armor') {
    // Armour takes the damage but refuses the stun, so Vorn keeps swinging.
    const armorDamage = Math.floor((dmg * 3) / 4)
    victim.health -= armorDamage
    const armorRule = defOf(victim).meterRule
    if (armorRule.kind === 'punished') addMeter(victim, armorDamage * armorRule.perDamage)
    m.hitstop = HITSTOP_LIGHT
    m.events.push({
      attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
      damage: dmg, kind: mv.kind, blocked: false, parried: false, counter,
    })
    if (victim.health <= 0) knockOut(m, victim, cfg)
    return true
  }

  // Combo scaling. Applied off the attacker's running combo so that a fresh
  // opening always pays full price.
  const scaled = Math.max(1, Math.floor((dmg * attacker.comboScale) / 100))
  victim.health -= scaled

  const rule = defOf(victim).meterRule
  if (rule.kind === 'punished') addMeter(victim, scaled * rule.perDamage)

  attacker.comboCount++
  attacker.comboScale = Math.max(COMBO_SCALE_FLOOR, attacker.comboScale - COMBO_SCALE_STEP)
  addMeter(attacker, meterForAttacker(attacker, mv, 'hit'))
  addSpecial(attacker, mv.meterOnHit)

  if ((mv.flags & MoveFlag.Siphon) !== 0) {
    addSpecial(victim, -20)
  }

  const hitstun = mv.hitstun + (counter ? 6 : 0)
  victim.vx = attacker.facing * mv.pushbackHit
  if (victim.juggleCount < MAX_JUGGLE) applyReaction(victim, mv, hitstun)
  else setState(victim, St.Knockdown, KNOCKDOWN_FRAMES)

  victim.parryWindow = 0
  victim.wasGuarding = 0

  // Wall splat: driving the victim into the boundary adds damage and takes a
  // chunk out of whatever scenery is standing there.
  if ((mv.flags & MoveFlag.WallSplat) !== 0) {
    const atWall = fxAbs(victim.x) >= cfg.arena.halfWidth - fxFrom(0.35)
    if (atWall) {
      victim.health -= Math.floor(scaled / 4)
      shatterNearest(m, cfg, victim.x, victim.z, 60)
      setState(victim, St.Knockdown, KNOCKDOWN_FRAMES, true)
    }
  }

  m.hitstop = scaled >= 60 ? HITSTOP_HEAVY : HITSTOP_LIGHT
  m.events.push({
    attacker: attacker.slot, x: contactX, y: contactY, z: contactZ,
    damage: scaled, kind: mv.kind, blocked: false, parried: false, counter,
  })

  if (victim.health <= 0) knockOut(m, victim, cfg)
  return true
}

function meterForAttacker(attacker: FighterState, mv: MoveDef, kind: 'hit' | 'block'): number {
  const rule = defOf(attacker).meterRule
  if (rule.kind !== 'offense') return 0
  if (kind === 'block') return Math.floor(rule.perHit / 2)
  void mv
  return rule.perHit + rule.perComboStep * Math.min(attacker.comboCount, 6)
}

function shatterNearest(m: MatchState, cfg: SimConfig, x: Fx, z: Fx, damage: number): void {
  let best = -1
  let bestDist = fxFrom(2.2)
  cfg.arena.breakables.forEach((b, i) => {
    if ((m.breakableIntegrity[i] ?? 0) <= 0) return
    const dist = fxLen2(b.x - x, b.z - z)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  if (best >= 0) {
    m.breakableIntegrity[best] = Math.max(0, (m.breakableIntegrity[best] ?? 0) - damage)
  }
}

function knockOut(m: MatchState, victim: FighterState, cfg: SimConfig): void {
  victim.health = 0
  if (cfg.training) {
    victim.health = defOf(victim).health
    return
  }
  setState(victim, St.Defeated, 0)
  m.phase = Phase.KO
  m.phaseFrame = 0
}

/* ------------------------------------------------------------------ */
/* Strike and projectile passes                                         */
/* ------------------------------------------------------------------ */

function strikePass(m: MatchState, attacker: FighterState, victim: FighterState, cfg: SimConfig): void {
  if (!has(attacker.state, SF.Attacking)) return
  const mv = currentMove(attacker)
  if (!mv) return
  if (has(victim.state, SF.Invulnerable)) return

  const hb = hurtboxOf(victim)
  toWorld(hb, victim.x, victim.y, victim.z, victim.facing, boxScratchB)

  for (let i = 0; i < mv.hitboxes.length; i++) {
    const spec = mv.hitboxes[i]!
    if (attacker.moveFrame < spec.from || attacker.moveFrame >= spec.to) continue
    const bit = 1 << i
    if ((attacker.moveHasConnected & bit) !== 0) continue

    toWorld(spec.box, attacker.x, attacker.y, attacker.z, attacker.facing, boxScratchA)
    if (!overlaps(boxScratchA, boxScratchB)) continue

    overlapCenter(boxScratchA, boxScratchB, spark)
    attacker.moveHasConnected |= bit
    const connected = resolveHit(m, attacker, victim, mv, cfg, spark.x, spark.y, spark.z)
    if (connected) {
      attacker.cancelArmed = 1
      return
    }
  }
}

function spawnProjectile(m: MatchState, owner: FighterState, mv: MoveDef): void {
  if (!mv.projectile) return
  const slot = m.projectiles.find((p) => p.active === 0)
  if (!slot) return
  slot.active = 1
  slot.owner = owner.slot
  slot.x = owner.x + owner.facing * fxFrom(0.55)
  slot.y = fxFrom(1.15)
  slot.z = owner.z
  slot.vx = owner.facing * mv.projectile.speed
  slot.life = mv.projectile.lifetime
  slot.moveIndex = owner.moveIndex
}

function projectilePass(m: MatchState, cfg: SimConfig): void {
  for (const p of m.projectiles) {
    if (p.active === 0) continue
    p.x += p.vx
    p.life--
    if (p.life <= 0 || fxAbs(p.x) > cfg.arena.halfWidth) {
      p.active = 0
      continue
    }
    const owner = m.fighters[p.owner]
    const victim = m.fighters[p.owner === 0 ? 1 : 0]
    if (has(victim.state, SF.Invulnerable)) continue
    const mv = moveOf(owner.charIndex, p.moveIndex)
    if (!mv?.projectile) { p.active = 0; continue }

    toWorld(mv.projectile.box, p.x, p.y, p.z, 1, boxScratchA)
    toWorld(hurtboxOf(victim), victim.x, victim.y, victim.z, victim.facing, boxScratchB)
    if (!overlaps(boxScratchA, boxScratchB)) continue

    overlapCenter(boxScratchA, boxScratchB, spark)
    // The projectile carries the owner's facing so pushback goes the right way.
    const savedFacing = owner.facing
    owner.facing = p.vx >= 0 ? 1 : -1
    resolveHit(m, owner, victim, mv, cfg, spark.x, spark.y, spark.z)
    owner.facing = savedFacing
    p.active = 0
  }
}

/* ------------------------------------------------------------------ */
/* Per-fighter timers                                                   */
/* ------------------------------------------------------------------ */

function advanceTimers(f: FighterState): void {
  if (f.payloadFrames > 0) f.payloadFrames--
  if (f.shieldFrames > 0) {
    f.shieldFrames--
    if (f.shieldFrames === 0) f.shieldKind = -1
  }
  if (f.dilatedFrames > 0) f.dilatedFrames--
  if (f.parryWindow > 0) {
    f.parryWindow--
    if (f.parryWindow === 0 && f.state === St.Parry) setState(f, St.GuardStand)
  }
  if (f.throwTechWindow > 0) f.throwTechWindow--

}

function advanceStateTimeline(f: FighterState): void {
  f.stateFrame++

  if (has(f.state, SF.Attacking)) {
    const mv = currentMove(f)
    if (mv) {
      f.moveFrame++
      if (f.moveFrame >= effectiveTotal(f, mv)) {
        setState(f, has(f.state, SF.Airborne) ? St.JumpFall : St.Idle)
      }
    } else {
      setState(f, St.Idle)
    }
    return
  }

  if (f.stateDuration > 0 && f.stateFrame >= f.stateDuration) {
    switch (f.state) {
      case St.Knockdown: setState(f, St.Wakeup, WAKEUP_FRAMES); break
      case St.Wakeup:
      case St.HitStun:
      case St.BlockStun:
      case St.Stagger:
      case St.Paralyzed:
      case St.DashForward:
      case St.DashBack:
      case St.SidestepLeft:
      case St.SidestepRight:
      case St.MeterBurst:
      case St.Parry:
      default:
        setState(f, St.Idle)
        break
    }
  }
}

function faceOpponent(f: FighterState, opp: FighterState): void {
  if (has(f.state, SF.Attacking) || has(f.state, SF.Reeling)) return
  const want: 1 | -1 = opp.x >= f.x ? 1 : -1
  f.facing = want
}

/* ------------------------------------------------------------------ */
/* Frame entry point                                                    */
/* ------------------------------------------------------------------ */

export function advanceFrame(
  m: MatchState,
  inputs: readonly [InputFrame, InputFrame],
  cfg: SimConfig,
): void {
  m.events.length = 0

  const [f0, f1] = m.fighters
  f0.inputs.push(inputs[0])
  f1.inputs.push(inputs[1])

  // Hitstop freezes the fighters but not the frame counter, so both peers stay
  // on the same frame number through an impact.
  if (m.hitstop > 0) {
    m.hitstop--
    m.frame++
    return
  }

  m.phaseFrame++

  switch (m.phase) {
    case Phase.Intro:
      if (m.phaseFrame >= INTRO_FRAMES) { m.phase = Phase.Fight; m.phaseFrame = 0 }
      m.frame++
      return
    case Phase.KO:
      if (m.phaseFrame >= KO_FRAMES) { endRound(m, cfg); }
      stepPhysicsOnly(m, cfg)
      m.frame++
      return
    case Phase.RoundEnd:
      if (m.phaseFrame >= ROUND_END_FRAMES) startRound(m, cfg)
      m.frame++
      return
    case Phase.MatchEnd:
      m.frame++
      return
    default:
      break
  }

  if (!cfg.training && m.roundTimerFrames > 0) m.roundTimerFrames--

  // Decided once per fighter per frame, and deliberately applied to the move
  // timeline and movement only — NOT to intent.
  //
  // Gating intent as well looked equivalent but silently ate inputs: a button
  // pressed on a skipped frame never produced a rising edge, so a slowed
  // fighter holding a button would simply never attack. Time dilation is meant
  // to stretch animations, not to drop what the player asked for. Timers stay
  // on real frames too, so "5 seconds" means 5 seconds.
  const acts: [boolean, boolean] = [tickAllowed(f0), tickAllowed(f1)]

  for (const f of m.fighters) {
    const opp = m.fighters[f.slot === 0 ? 1 : 0]
    faceOpponent(f, opp)
    advanceTimers(f)
    applyIntent(m, f, cfg)
  }

  for (const f of m.fighters) {
    if (!acts[f.slot]) continue
    const mv = currentMove(f)
    const wasFrame = f.moveFrame
    advanceStateTimeline(f)
    if (mv?.projectile && wasFrame + 1 === mv.startup && f.moveIndex >= 0) {
      spawnProjectile(m, f, mv)
    }
    applyMovement(f, cfg.arena)
  }

  separate(f0, f1, cfg.arena)

  strikePass(m, f0, f1, cfg)
  strikePass(m, f1, f0, cfg)
  projectilePass(m, cfg)

  // A combo is over when the victim has been free for long enough to act, so
  // the counter tracks the victim's state rather than the attacker's.
  for (const f of m.fighters) {
    const opp = m.fighters[f.slot === 0 ? 1 : 0]
    if (has(opp.state, SF.Reeling)) f.comboIdle = 0
    else f.comboIdle++
    if (f.comboIdle > COMBO_RESET_FRAMES && f.comboCount > 0) {
      f.comboCount = 0
      f.comboScale = 100
    }
  }

  if (cfg.training) {
    for (const f of m.fighters) {
      f.special = defOf(f).specialMax
      if (f.health < defOf(f).health && !has(f.state, SF.Reeling)) {
        f.health = Math.min(defOf(f).health, f.health + 2)
      }
    }
  } else if (m.roundTimerFrames === 0 && m.phase === Phase.Fight) {
    timeOut(m, cfg)
  }

  m.frame++
}

function stepPhysicsOnly(m: MatchState, cfg: SimConfig): void {
  for (const f of m.fighters) {
    f.stateFrame++
    applyMovement(f, cfg.arena)
  }
  for (const p of m.projectiles) p.active = 0
}

function timeOut(m: MatchState, cfg: SimConfig): void {
  const [a, b] = m.fighters
  const ra = a.health / defOf(a).health
  const rb = b.health / defOf(b).health
  if (ra === rb) {
    // A draw awards nothing; the round replays.
    m.phase = Phase.RoundEnd
    m.phaseFrame = 0
    return
  }
  const loser = ra < rb ? a : b
  setState(loser, St.Defeated, 0)
  m.phase = Phase.KO
  m.phaseFrame = 0
  void cfg
}

function endRound(m: MatchState, cfg: SimConfig): void {
  const [a, b] = m.fighters
  if (a.health <= 0 && b.health <= 0) {
    // Double KO: neither side banks the round.
  } else if (a.health <= 0) m.roundsWon[1]++
  else if (b.health <= 0) m.roundsWon[0]++
  else if (a.health < b.health) m.roundsWon[1]++
  else if (b.health < a.health) m.roundsWon[0]++

  if (m.roundsWon[0] >= cfg.roundsToWin || m.roundsWon[1] >= cfg.roundsToWin) {
    m.phase = Phase.MatchEnd
  } else {
    m.phase = Phase.RoundEnd
  }
  m.phaseFrame = 0
}

export function startRound(m: MatchState, cfg: SimConfig): void {
  m.round++
  m.roundTimerFrames = 99 * 60
  m.phase = Phase.Intro
  m.phaseFrame = 0
  m.hitstop = 0
  for (const p of m.projectiles) p.active = 0
  for (let i = 0; i < m.breakableIntegrity.length; i++) m.breakableIntegrity[i] = 100
  m.fighters.forEach((f, i) => {
    const d = defOf(f)
    f.x = i === 0 ? fxFrom(-2.2) : fxFrom(2.2)
    f.y = 0; f.z = 0
    f.vx = 0; f.vy = 0; f.vz = 0
    f.facing = i === 0 ? 1 : -1
    f.health = d.health
    f.meter = 0
    f.special = Math.floor(d.specialMax / 2)
    f.comboCount = 0; f.comboScale = 100; f.comboIdle = 0; f.juggleCount = 0
    f.payloadFrames = 0; f.dilatedFrames = 0; f.dilationAccum = 0
    f.analysedPhysical = 0; f.analysedEnergy = 0
    f.shieldKind = -1; f.shieldFrames = 0
    f.throwTechWindow = 0; f.parryWindow = 0; f.wasGuarding = 0
    setState(f, St.Idle)
  })
  void cfg
}
