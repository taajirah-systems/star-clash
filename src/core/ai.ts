/**
 * CPU opponent.
 *
 * The AI emits an InputFrame and nothing else. It never writes to match state,
 * never calls into the sim, and never reads a field a player could not see on
 * screen. That is the whole design constraint: because its output goes through
 * the same path as a pad, it is structurally incapable of doing something a
 * human could not — no instant turnarounds, no cancelling out of recovery, no
 * reacting on the frame a hitbox spawns unless its reaction budget allows it.
 *
 * It is also deterministic. Given the same match states in the same order it
 * produces the same inputs, so an AI match replays exactly like a human one.
 */

import { fxAbs, fxFrom, type Fx } from './fx'
import { St, SF, has } from './fsm'
import { Btn, type InputFrame } from './input'
import { MoveFlag, type MoveDef } from './defs'
import { characterAt, moveOf, moveIdxOf, reachOfMove } from '../data/roster'
import type { FighterState, MatchState } from './state'

export const enum Difficulty {
  Rookie,
  Veteran,
  Elite,
}

interface Tuning {
  /** Frames between decisions. This is the reaction time. */
  think: number
  /** 0..100 chance of guarding an attack it has recognised. */
  block: number
  /** 0..100 chance of taking a punish it has recognised. */
  punish: number
  /** 0..100 bias toward closing distance rather than waiting. */
  aggression: number
  /** 0..100 chance of spending meter when it is available. */
  resourceUse: number
  /** 0..100 chance of going for a throw against a blocking opponent. */
  throwMixup: number
}

const TUNING: Record<Difficulty, Tuning> = {
  [Difficulty.Rookie]: { think: 20, block: 35, punish: 20, aggression: 45, resourceUse: 25, throwMixup: 10 },
  [Difficulty.Veteran]: { think: 11, block: 65, punish: 55, aggression: 62, resourceUse: 60, throwMixup: 28 },
  [Difficulty.Elite]: { think: 5, block: 88, punish: 85, aggression: 78, resourceUse: 88, throwMixup: 45 },
}

export function difficultyName(d: Difficulty): string {
  return d === Difficulty.Rookie ? 'ROOKIE' : d === Difficulty.Veteran ? 'VETERAN' : 'ELITE'
}

/** Slack added to a move's reach before the AI calls itself "in range". */
const RANGE_SLOP = fxFrom(0.34)
/** Depth misalignment beyond which most hitboxes miss and it should realign. */
const Z_TOLERANCE = fxFrom(0.30)

export class Ai {
  private rng: number
  private planInput: InputFrame = 0
  private planTail: InputFrame = 0
  private planFrames = 0
  /** Frames at the head of a plan during which buttons are actually held. */
  private pulseFrames = 0
  private planAge = 0
  /** Frames since the last chance to react to something new. */
  private sinceReact = 0

  constructor(
    readonly slot: 0 | 1,
    private difficulty: Difficulty = Difficulty.Veteran,
    seed = 0x51ed2701,
  ) {
    this.rng = (seed ^ (slot * 0x9e3779b9)) >>> 0
  }

  setDifficulty(d: Difficulty): void {
    this.difficulty = d
  }

  /** Deterministic 0..99. */
  private roll(): number {
    let x = this.rng
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    this.rng = x
    return x % 100
  }

  private chance(pct: number): boolean {
    return this.roll() < pct
  }

  think(m: MatchState): InputFrame {
    const self = m.fighters[this.slot]
    const opp = m.fighters[this.slot === 0 ? 1 : 0]
    const t = TUNING[this.difficulty]

    this.sinceReact++

    // A running plan can be abandoned to deal with an incoming attack.
    //
    // Without this, a faster reaction time bought nothing: committing to a
    // 22-frame heavy meant ignoring the world for 22 frames, so the top tier
    // ate more damage than the bottom one despite thinking four times as
    // often. The check is rate-limited to the tier's reaction cadence, so a
    // Rookie still cannot guard on the frame a hitbox appears.
    let interrupt = false
    if (this.planFrames > 0 && this.sinceReact >= t.think) {
      this.sinceReact = 0
      if (has(self.state, SF.Actionable)) {
        const gap = fxAbs(opp.x - self.x)
        if (incomingThreat(opp, gap) && this.chance(t.block)) interrupt = true
      }
    }

    // Hold the current plan out. Buttons only fire at the head of it, so the
    // sim sees one rising edge per decision rather than a held button.
    if (this.planFrames > 0 && !interrupt) {
      this.planFrames--
      this.planAge++
      return this.planAge <= this.pulseFrames ? this.planInput : this.planTail
    }

    const next = this.decide(self, opp, t)
    this.planInput = next.input
    this.planTail = next.tail
    this.planFrames = Math.max(1, next.frames) - 1
    this.pulseFrames = next.pulse
    this.planAge = 1
    return this.pulseFrames >= 1 ? next.input : next.tail
  }

  reset(): void {
    this.planInput = 0
    this.planTail = 0
    this.planFrames = 0
    this.pulseFrames = 0
    this.planAge = 0
    this.sinceReact = 0
  }

  /* ---------------------------------------------------------------- */

  private decide(self: FighterState, opp: FighterState, t: Tuning): Plan {
    if (self.state === St.Defeated) return hold(t.think)

    // Locked into a move or a stun: commit to a short hold so the next
    // decision lands on the frame control comes back.
    //
    // Planning a 22-frame attack here was the single worst thing the AI did.
    // It spent most of the match unable to act, burned its whole reaction
    // budget on a plan it could not execute, and by the time it was free the
    // plan was stale — so it never once held guard against an incoming attack,
    // at any difficulty. Re-deciding the instant it recovers is what makes the
    // defensive branch reachable at all.
    // Guard is held through recovery where the tier is disciplined enough,
    // so it is already up the frame control returns rather than a beat late.
    if (!has(self.state, SF.Actionable)) return hold(2, this.chance(t.block) ? Btn.Guard : 0)

    const def = characterAt(self.charIndex).def
    const gap = fxAbs(opp.x - self.x)
    const zGap = fxAbs(opp.z - self.z)
    const toward = opp.x >= self.x ? Btn.Right : Btn.Left
    const away = toward === Btn.Right ? Btn.Left : Btn.Right

    /* --- Defence: is something coming that will reach me? --- */
    const threat = incomingThreat(opp, gap)
    if (threat && this.chance(t.block)) {
      // Crouch-guard a low, stand-guard anything else. Held a little past the
      // last active frame so the guard is already up when the hitbox arrives
      // and does not drop one frame early.
      const low = threat.guard === 2 /* Guard.Low */
      const guard = Btn.Guard | (low ? Btn.Down : 0)
      return { input: guard, frames: threat.framesLeft + 6, pulse: 0, tail: guard }
    }

    /* --- Punish: opponent is recovering or stunned and I can reach --- */
    const oppHelpless = has(opp.state, SF.Reeling) || inRecovery(opp)
    if (oppHelpless && this.chance(t.punish)) {
      const heavy = def.normals.heavy
      const special = def.normals.special
      const canSpecial = self.special >= (def.moves[special]?.cost ?? 0)
      if (canSpecial && this.inRange(self, special, gap) && this.chance(t.resourceUse)) {
        return press(Btn.Special, 26)
      }
      if (this.inRange(self, heavy, gap)) return press(Btn.Heavy, 22)
      if (this.inRange(self, def.normals.light, gap)) return press(Btn.Light, 14)
    }

    /* --- Spend a full signature meter --- */
    if (
      self.meter >= def.meterMax &&
      self.payloadFrames === 0 &&
      def.meterRule.kind !== 'adaptive' &&
      this.chance(t.resourceUse)
    ) {
      return { input: Btn.Guard | Btn.Special, frames: 10, pulse: 4, tail: Btn.Guard }
    }

    /* --- Realign on the depth axis, or a sidestep will make everything whiff --- */
    if (zGap > Z_TOLERANCE) {
      const step = opp.z > self.z ? Btn.Down : Btn.Up
      return move(step, 8)
    }

    /* --- Anti-air --- */
    if (has(opp.state, SF.Airborne) && gap < reachOfMove(self.charIndex, def.normals.heavy) + RANGE_SLOP) {
      return press(Btn.Heavy, 20)
    }

    /* --- Offence --- */
    if (opp.state === St.GuardStand || opp.state === St.GuardCrouch || opp.state === St.BlockStun) {
      // Guard beats strikes, so mix in throws and lows to open them up.
      if (this.inRange(self, def.normals.throw, gap) && this.chance(t.throwMixup)) {
        return press(Btn.Throw, 24)
      }
      if (this.inRange(self, def.normals.crouchLight, gap)) {
        return { input: Btn.Down | Btn.Light, frames: 16, pulse: 3, tail: Btn.Guard }
      }
    }

    const light = def.normals.light
    const heavy = def.normals.heavy
    if (this.inRange(self, light, gap)) {
      // Prefer the faster button when close; occasionally commit to a heavy.
      if (this.inRange(self, heavy, gap) && this.chance(30)) return press(Btn.Heavy, 22)
      return press(Btn.Light, 14)
    }

    const special = def.normals.special
    if (
      this.inRange(self, special, gap) &&
      self.special >= (def.moves[special]?.cost ?? 0) &&
      this.chance(t.resourceUse)
    ) {
      return press(Btn.Special, 28)
    }

    /* --- Approach or wait --- */
    // Advancing into an attack that is already in motion is how an aggressive
    // tier ends up taking more damage than a passive one, even when it blocks
    // well; hold position until the swing resolves.
    if (has(opp.state, SF.Attacking)) return hold(Math.max(2, t.think >> 1), Btn.Guard)

    if (this.chance(t.aggression)) {
      // A dash is two taps; the plan emits the direction, releases, then taps
      // again, which is exactly what the sim's double-tap detector expects.
      if (gap > fxFrom(3.0) && this.chance(40)) return move(toward, 14)
      return move(toward, t.think)
    }
    if (this.chance(20)) return move(away, t.think)
    return hold(t.think)
  }

  private inRange(self: FighterState, moveId: string, gap: Fx): boolean {
    const r = reachOfMove(self.charIndex, moveId)
    return r > 0 && gap <= r + RANGE_SLOP
  }
}

interface Plan {
  input: InputFrame
  frames: number
  /** Frames at the head of the plan during which buttons are held. */
  pulse: number
  /** Emitted for the rest of the plan, once the pulse is over. */
  tail: InputFrame
}

/**
 * An attack, followed by guard for the rest of the plan.
 *
 * The tail is what stops the AI from mashing. Without it, the instant a move's
 * recovery ended the AI attacked again — 80% attack uptime, never once holding
 * guard, and completely open between swings. Returning to block after taking
 * a turn is what a competent player does, and it is also what makes the
 * defensive branch reachable, since a mashing AI is almost never actionable
 * at the moment an attack comes in.
 */
function press(btn: Btn, frames: number): Plan {
  return { input: btn, frames, pulse: 3, tail: Btn.Guard }
}

function hold(frames: number, tail: InputFrame = 0): Plan {
  return { input: tail, frames, pulse: 0, tail }
}

function move(input: InputFrame, frames: number): Plan {
  return { input, frames, pulse: 0, tail: input }
}

/** Is the opponent mid-attack with something that will actually reach? */
function incomingThreat(opp: FighterState, gap: Fx): { guard: number; framesLeft: number } | null {
  if (!has(opp.state, SF.Attacking)) return null
  const mv: MoveDef | null = moveOf(opp.charIndex, opp.moveIndex)
  if (!mv) return null
  // Grabs cannot be blocked, so recognising one as a "threat to guard" would
  // make the AI walk into it holding back.
  if ((mv.flags & MoveFlag.Grab) !== 0) return null
  const last = mv.startup + mv.active
  if (opp.moveFrame > last) return null
  const reach = reachOfMove(opp.charIndex, mv.id)
  if (gap > reach + RANGE_SLOP) return null
  return { guard: mv.guard as number, framesLeft: Math.max(1, last - opp.moveFrame) }
}

/** Opponent is past their active frames and cannot act yet. */
function inRecovery(opp: FighterState): boolean {
  if (!has(opp.state, SF.Attacking)) return false
  const mv = moveOf(opp.charIndex, opp.moveIndex)
  if (!mv) return false
  return opp.moveFrame > mv.startup + mv.active
}

/** Sanity check used by the tests: every character's normals resolve. */
export function aiCanDriveCharacter(charIndex: number): boolean {
  const def = characterAt(charIndex).def
  return Object.values(def.normals).every((id) => moveIdxOf(charIndex, id) >= 0)
}
