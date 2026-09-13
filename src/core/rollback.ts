/**
 * Rollback session.
 *
 * Local versus play does not need any of this, but the whole simulation was
 * written to make it possible, and an unexercised rollback path is a rollback
 * path that does not work. `LocalSession` and `RollbackSession` present the
 * same surface, so the game loop is identical either way and the netcode path
 * is covered by the same tests as local play.
 *
 * Prediction is GGPO's: assume a missing remote input repeats the last one we
 * saw. When the real input arrives and disagrees, restore the snapshot for that
 * frame and re-simulate forward. Because `advanceFrame` is pure with respect to
 * (state, inputs), the re-simulation lands exactly where the remote peer did.
 */

import { ROLLBACK_WINDOW } from './defs'
import { advanceFrame, type SimConfig } from './sim'
import {
  saveState, loadState, checksum,
  type MatchState, type Snapshot,
} from './state'
import type { InputFrame } from './input'

export interface Session {
  readonly state: MatchState
  readonly frame: number
  advance(local: InputFrame, remote?: InputFrame): void
  checksum(): number
}

/** Same-machine play: no prediction, no snapshots, no rollback. */
export class LocalSession implements Session {
  constructor(
    readonly state: MatchState,
    private readonly cfg: SimConfig,
  ) {}

  get frame(): number {
    return this.state.frame
  }

  advance(p1: InputFrame, p2: InputFrame = 0): void {
    advanceFrame(this.state, [p1, p2], this.cfg)
  }

  checksum(): number {
    return checksum(this.state)
  }
}

const RING = ROLLBACK_WINDOW + 4

interface Slot {
  frame: number
  input: InputFrame
  confirmed: boolean
}

class InputQueue {
  private readonly slots: Slot[] = []
  private lastConfirmed: InputFrame = 0
  private lastConfirmedFrame = -1

  constructor() {
    for (let i = 0; i < RING; i++) this.slots.push({ frame: -1, input: 0, confirmed: false })
  }

  private slot(frame: number): Slot {
    return this.slots[((frame % RING) + RING) % RING]!
  }

  /** Records a real input. Returns true if it contradicts what was predicted. */
  confirm(frame: number, input: InputFrame): boolean {
    const s = this.slot(frame)
    const mispredicted = s.frame === frame && !s.confirmed && s.input !== input
    s.frame = frame
    s.input = input
    s.confirmed = true

    if (frame >= this.lastConfirmedFrame) {
      this.lastConfirmed = input
      this.lastConfirmedFrame = frame
      // Every later frame that is still a guess was guessed from the input we
      // just replaced, so those guesses are stale. Dropping them makes the
      // re-simulation predict from the corrected input instead — without this
      // one late packet causes a rollback per frame until the peer catches up,
      // because each stale prediction mispredicts all over again.
      if (mispredicted) this.invalidatePredictionsAfter(frame)
    }
    return mispredicted
  }

  private invalidatePredictionsAfter(frame: number): void {
    for (const s of this.slots) {
      if (s.frame > frame && !s.confirmed) s.frame = -1
    }
  }

  /** Reads the input for a frame, predicting when it has not arrived. */
  get(frame: number): InputFrame {
    const s = this.slot(frame)
    if (s.frame === frame) return s.input
    s.frame = frame
    s.input = this.lastConfirmed
    s.confirmed = false
    return s.input
  }

  isConfirmed(frame: number): boolean {
    const s = this.slot(frame)
    return s.frame === frame && s.confirmed
  }
}

export interface RollbackStats {
  rollbacks: number
  framesResimulated: number
  deepest: number
}

export class RollbackSession implements Session {
  private readonly snapshots = new Map<number, Snapshot>()
  private readonly queues: [InputQueue, InputQueue] = [new InputQueue(), new InputQueue()]
  readonly stats: RollbackStats = { rollbacks: 0, framesResimulated: 0, deepest: 0 }

  constructor(
    readonly state: MatchState,
    private readonly cfg: SimConfig,
    private readonly localPlayer: 0 | 1 = 0,
  ) {}

  get frame(): number {
    return this.state.frame
  }

  /**
   * Feeds a remote input that arrived late. If it disagrees with the
   * prediction already simulated, the session rewinds and replays.
   */
  receiveRemote(frame: number, input: InputFrame): void {
    const remote: 0 | 1 = this.localPlayer === 0 ? 1 : 0
    if (frame >= this.state.frame) {
      this.queues[remote].confirm(frame, input)
      return
    }
    const mispredicted = this.queues[remote].confirm(frame, input)
    if (!mispredicted) return
    this.rollbackTo(frame)
  }

  private rollbackTo(frame: number): void {
    const snap = this.snapshots.get(frame)
    if (!snap) return // Older than the window; nothing can be done but drift.
    const target = this.state.frame
    loadState(this.state, snap)

    const depth = target - frame
    this.stats.rollbacks++
    this.stats.framesResimulated += depth
    if (depth > this.stats.deepest) this.stats.deepest = depth

    for (let f = frame; f < target; f++) {
      this.simulateOne(f)
    }
  }

  private simulateOne(frame: number): void {
    this.snapshots.set(frame, saveState(this.state))
    const a = this.queues[0].get(frame)
    const b = this.queues[1].get(frame)
    advanceFrame(this.state, [a, b], this.cfg)
    // Keep only the window; anything older can never be rolled back to.
    const cutoff = frame - RING
    if (this.snapshots.has(cutoff)) this.snapshots.delete(cutoff)
  }

  advance(local: InputFrame, remote?: InputFrame): void {
    const frame = this.state.frame
    this.queues[this.localPlayer].confirm(frame, local)
    if (remote !== undefined) {
      this.queues[this.localPlayer === 0 ? 1 : 0].confirm(frame, remote)
    }
    this.simulateOne(frame)
  }

  /** Highest frame for which both players' inputs are known to be real. */
  confirmedFrame(): number {
    let f = this.state.frame - 1
    while (f >= 0 && f > this.state.frame - RING) {
      if (this.queues[0].isConfirmed(f) && this.queues[1].isConfirmed(f)) return f
      f--
    }
    return -1
  }

  checksum(): number {
    return checksum(this.state)
  }
}
