import { describe, it, expect } from 'vitest'
import { KEYMAP_P1, KEYMAP_P2, type KeyMap } from '../src/core/input'

const ACTIONS = ['up', 'down', 'left', 'right', 'light', 'heavy', 'special', 'throw', 'jump', 'guard'] as const

/** Keys a compact laptop keyboard does not physically have. */
function isMissingOnLaptop(code: string): boolean {
  return code.startsWith('Numpad')
}

function allCodes(map: KeyMap): string[] {
  return ACTIONS.flatMap((a) => [...map[a]])
}

describe('key bindings', () => {
  it('binds every action for both players', () => {
    for (const [name, map] of [['P1', KEYMAP_P1], ['P2', KEYMAP_P2]] as const) {
      for (const action of ACTIONS) {
        expect(map[action].length, `${name}.${action} has no binding`).toBeGreaterThan(0)
      }
    }
  })

  it('gives every action a key that exists on a laptop keyboard', () => {
    // The bug this guards against: player two was bound to Numpad1-6, which a
    // MacBook does not have, so that player could not attack at all.
    for (const [name, map] of [['P1', KEYMAP_P1], ['P2', KEYMAP_P2]] as const) {
      for (const action of ACTIONS) {
        const usable = map[action].filter((c) => !isMissingOnLaptop(c))
        expect(
          usable.length,
          `${name}.${action} is only bound to keys a laptop does not have: ${map[action].join(', ')}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('never binds one key to two actions for the same player', () => {
    for (const [name, map] of [['P1', KEYMAP_P1], ['P2', KEYMAP_P2]] as const) {
      const seen = new Map<string, string>()
      for (const action of ACTIONS) {
        for (const code of map[action]) {
          const prior = seen.get(code)
          expect(prior, `${name}: ${code} is bound to both ${prior} and ${action}`).toBeUndefined()
          seen.set(code, action)
        }
      }
    }
  })

  it('never shares a key between the two players', () => {
    const p1 = new Set(allCodes(KEYMAP_P1))
    for (const code of allCodes(KEYMAP_P2)) {
      expect(p1.has(code), `${code} is bound for both players`).toBe(false)
    }
  })

  it('keeps the UI shortcut keys clear of both players controls', () => {
    // B toggles hitboxes, N the perf readout, M the mode cycle.
    const bound = new Set([...allCodes(KEYMAP_P1), ...allCodes(KEYMAP_P2)])
    for (const code of ['KeyB', 'KeyN', 'KeyM']) {
      expect(bound.has(code), `${code} is a UI shortcut but also a game control`).toBe(false)
    }
  })
})
