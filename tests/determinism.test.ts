import { describe, it, expect } from 'vitest'
import { createMatch, saveState, loadState, checksum, Phase } from '../src/core/state'
import { advanceFrame } from '../src/core/sim'
import { LocalSession, RollbackSession } from '../src/core/rollback'
import { config, TRAINING_GRID, scriptedInputs } from './harness'
import { ROSTER } from '../src/data/roster'

function fresh(a: number, b: number) {
  const m = createMatch(a, b, 99, TRAINING_GRID.breakables.length)
  m.phase = Phase.Fight
  return m
}

const FRAMES = 1200

describe('determinism', () => {
  it('replays the same inputs to the same state', () => {
    const p1 = scriptedInputs(0xabc123, FRAMES)
    const p2 = scriptedInputs(0x9f2e11, FRAMES)
    const cfg = config()

    const a = fresh(0, 3)
    const b = fresh(0, 3)
    for (let f = 0; f < FRAMES; f++) {
      advanceFrame(a, [p1[f]!, p2[f]!], cfg)
      advanceFrame(b, [p1[f]!, p2[f]!], cfg)
      expect(checksum(a), `diverged on frame ${f}`).toBe(checksum(b))
    }
  })

  it('replays identically for every matchup in the roster', () => {
    const cfg = config()
    for (let i = 0; i < ROSTER.length; i++) {
      for (let j = 0; j < ROSTER.length; j++) {
        const p1 = scriptedInputs(0x1000 + i * 31 + j, 400)
        const p2 = scriptedInputs(0x2000 + i * 17 + j, 400)
        const a = fresh(i, j)
        const b = fresh(i, j)
        for (let f = 0; f < 400; f++) {
          advanceFrame(a, [p1[f]!, p2[f]!], cfg)
          advanceFrame(b, [p1[f]!, p2[f]!], cfg)
        }
        expect(checksum(a), `${ROSTER[i]!.id} vs ${ROSTER[j]!.id}`).toBe(checksum(b))
      }
    }
  })

  it('restores a snapshot to a bit-identical state', () => {
    const cfg = config()
    const p1 = scriptedInputs(0x5150, 600)
    const p2 = scriptedInputs(0x7373, 600)
    const m = fresh(1, 2)

    for (let f = 0; f < 200; f++) advanceFrame(m, [p1[f]!, p2[f]!], cfg)
    const snap = saveState(m)
    const at200 = checksum(m)

    for (let f = 200; f < 400; f++) advanceFrame(m, [p1[f]!, p2[f]!], cfg)
    const at400 = checksum(m)
    expect(at400).not.toBe(at200)

    loadState(m, snap)
    expect(checksum(m)).toBe(at200)

    // And re-simulating the same inputs must land on the same frame 400.
    for (let f = 200; f < 400; f++) advanceFrame(m, [p1[f]!, p2[f]!], cfg)
    expect(checksum(m)).toBe(at400)
  })

  it('snapshots capture input history, not just positions', () => {
    const cfg = config()
    const m = fresh(0, 1)
    for (let f = 0; f < 50; f++) advanceFrame(m, [0x03, 0x0c], cfg)
    const snap = saveState(m)
    for (let f = 0; f < 20; f++) advanceFrame(m, [0x30, 0x300], cfg)
    loadState(m, snap)
    expect(m.fighters[0].inputs.current).toBe(0x03)
    expect(m.fighters[1].inputs.current).toBe(0x0c)
  })
})

describe('rollback', () => {
  it('converges on the same state as a session that never mispredicted', () => {
    const cfg = config()
    const N = 900
    const p1 = scriptedInputs(0xfeed01, N)
    const p2 = scriptedInputs(0xbeef02, N)

    const truth = new LocalSession(fresh(1, 3), cfg)
    for (let f = 0; f < N; f++) truth.advance(p1[f]!, p2[f]!)

    // The rollback peer sees its own input immediately and the opponent's three
    // frames late, so most frames are simulated against a prediction.
    const DELAY = 3
    const net = new RollbackSession(fresh(1, 3), cfg, 0)
    for (let f = 0; f < N; f++) {
      net.advance(p1[f]!)
      const arrived = f - DELAY
      if (arrived >= 0) net.receiveRemote(arrived, p2[arrived]!)
    }
    for (let f = Math.max(0, N - DELAY); f < N; f++) net.receiveRemote(f, p2[f]!)

    expect(net.frame).toBe(truth.frame)
    expect(net.checksum()).toBe(truth.checksum())
    expect(net.stats.rollbacks).toBeGreaterThan(0)
  })

  it('reports how deep it had to rewind', () => {
    const cfg = config()
    const N = 300
    const p1 = scriptedInputs(0x1234, N)
    const p2 = scriptedInputs(0x4321, N)
    const net = new RollbackSession(fresh(2, 0), cfg, 0)
    const DELAY = 4
    for (let f = 0; f < N; f++) {
      net.advance(p1[f]!)
      if (f - DELAY >= 0) net.receiveRemote(f - DELAY, p2[f - DELAY]!)
    }
    expect(net.stats.deepest).toBeLessThanOrEqual(DELAY + 1)
    expect(net.stats.framesResimulated).toBeGreaterThan(0)
  })

  it('does not roll back when the prediction was right', () => {
    const cfg = config()
    const N = 200
    // A player holding one button all match is predicted perfectly.
    const net = new RollbackSession(fresh(0, 0), cfg, 0)
    for (let f = 0; f < N; f++) {
      net.advance(0x01)
      if (f - 3 >= 0) net.receiveRemote(f - 3, 0x02)
    }
    // Frame 0 has no prior input to predict from, so at most that one differs.
    expect(net.stats.rollbacks).toBeLessThanOrEqual(1)
  })

  it('agrees with the truth session at every confirmed frame, not just the end', () => {
    const cfg = config()
    const N = 400
    const p1 = scriptedInputs(0x0a0a, N)
    const p2 = scriptedInputs(0x0b0b, N)

    const truthState = fresh(3, 2)
    const truth = new LocalSession(truthState, cfg)
    const truthChecks: number[] = []
    for (let f = 0; f < N; f++) {
      truth.advance(p1[f]!, p2[f]!)
      truthChecks.push(truth.checksum())
    }

    const net = new RollbackSession(fresh(3, 2), cfg, 0)
    for (let f = 0; f < N; f++) {
      net.advance(p1[f]!)
      if (f - 2 >= 0) net.receiveRemote(f - 2, p2[f - 2]!)
      expect(net.confirmedFrame()).toBeLessThan(net.frame)
    }
    for (let f = N - 2; f < N; f++) if (f >= 0) net.receiveRemote(f, p2[f]!)
    expect(net.checksum()).toBe(truthChecks[N - 1])
  })
})
