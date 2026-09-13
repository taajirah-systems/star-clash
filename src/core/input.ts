/**
 * Input abstraction.
 *
 * Devices produce a 16-bit bitmask per frame and nothing else. Keeping a frame
 * of input to a single integer is what makes rollback affordable: a second of
 * input history for two players is 240 bytes, cheap to buffer, hash, and ship
 * over the wire.
 */

export const enum Btn {
  None = 0,
  Light = 1 << 0,
  Heavy = 1 << 1,
  Special = 1 << 2,
  Throw = 1 << 3,
  Jump = 1 << 4,
  Guard = 1 << 5,
  Up = 1 << 6,
  Down = 1 << 7,
  Left = 1 << 8,
  Right = 1 << 9,
}

export type InputFrame = number

export const DIRECTION_MASK = Btn.Up | Btn.Down | Btn.Left | Btn.Right
export const ATTACK_MASK = Btn.Light | Btn.Heavy | Btn.Special | Btn.Throw

export function held(frame: InputFrame, b: Btn): boolean {
  return (frame & b) !== 0
}

/** True on the frame a button goes down, not while it stays down. */
export function pressed(cur: InputFrame, prev: InputFrame, b: Btn): boolean {
  return (cur & b) !== 0 && (prev & b) === 0
}

export function released(cur: InputFrame, prev: InputFrame, b: Btn): boolean {
  return (cur & b) === 0 && (prev & b) !== 0
}

/**
 * Facing-relative direction. `facing` is +1 when the character looks toward
 * increasing X. Everything downstream reasons in forward/back so that move
 * tables do not have to be mirrored.
 */
export interface Dir {
  forward: boolean
  back: boolean
  /** Sidestep toward -Z. */
  stepLeft: boolean
  /** Sidestep toward +Z. */
  stepRight: boolean
}

export function resolveDir(frame: InputFrame, facing: 1 | -1): Dir {
  const right = held(frame, Btn.Right)
  const left = held(frame, Btn.Left)
  return {
    forward: facing === 1 ? right : left,
    back: facing === 1 ? left : right,
    stepLeft: held(frame, Btn.Up),
    stepRight: held(frame, Btn.Down),
  }
}

/**
 * Ring buffer of recent input frames.
 *
 * Sized generously so that a rollback of up to ROLLBACK_WINDOW frames can
 * replay from real inputs rather than from a repeated last-known frame.
 */
export const INPUT_HISTORY = 128

export class InputBuffer {
  private readonly frames = new Uint16Array(INPUT_HISTORY)
  private head = 0

  push(f: InputFrame): void {
    this.head = (this.head + 1) % INPUT_HISTORY
    this.frames[this.head] = f & 0xffff
  }

  /** `back` of 0 is the current frame, 1 the previous, and so on. */
  at(back: number): InputFrame {
    if (back < 0 || back >= INPUT_HISTORY) return 0
    const i = (this.head - back + INPUT_HISTORY * 2) % INPUT_HISTORY
    return this.frames[i] ?? 0
  }

  get current(): InputFrame {
    return this.at(0)
  }

  get previous(): InputFrame {
    return this.at(1)
  }

  /**
   * Double-tap detection for dashes: the direction is down now, was released
   * within the window, and was down before that.
   */
  doubleTapped(b: Btn, window = 12): boolean {
    if (!pressed(this.current, this.previous, b)) return false
    let sawRelease = false
    for (let i = 1; i < window; i++) {
      const f = this.at(i)
      if ((f & b) === 0) sawRelease = true
      else if (sawRelease) return true
    }
    return false
  }

  serialize(): Uint16Array {
    return this.frames.slice()
  }

  restore(data: Uint16Array, head: number): void {
    this.frames.set(data)
    this.head = head
  }

  get headIndex(): number {
    return this.head
  }
}

/** A device that can be polled for the current frame's bitmask. */
export interface InputSource {
  poll(): InputFrame
  dispose?(): void
}

export interface KeyMap {
  up: string
  down: string
  left: string
  right: string
  light: string
  heavy: string
  special: string
  throw: string
  jump: string
  guard: string
}

export const KEYMAP_P1: KeyMap = {
  up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  light: 'KeyJ', heavy: 'KeyK', special: 'KeyL', throw: 'KeyU',
  jump: 'KeyI', guard: 'KeyH',
}

export const KEYMAP_P2: KeyMap = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  light: 'Numpad1', heavy: 'Numpad2', special: 'Numpad3', throw: 'Numpad4',
  jump: 'Numpad5', guard: 'Numpad6',
}

export class KeyboardSource implements InputSource {
  private readonly down = new Set<string>()
  private readonly onDown = (e: KeyboardEvent) => {
    this.down.add(e.code)
    // Arrow keys and space scroll the page otherwise.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
  }
  private readonly onUp = (e: KeyboardEvent) => this.down.delete(e.code)
  /**
   * The browser does not deliver keyup for a key that was still down when the
   * window lost focus, so without this an alt-tab mid-match leaves the fighter
   * walking into the corner forever.
   */
  private readonly onBlur = () => this.down.clear()

  constructor(private readonly map: KeyMap) {
    window.addEventListener('keydown', this.onDown)
    window.addEventListener('keyup', this.onUp)
    window.addEventListener('blur', this.onBlur)
  }

  poll(): InputFrame {
    const m = this.map
    let f = 0
    if (this.down.has(m.up)) f |= Btn.Up
    if (this.down.has(m.down)) f |= Btn.Down
    if (this.down.has(m.left)) f |= Btn.Left
    if (this.down.has(m.right)) f |= Btn.Right
    if (this.down.has(m.light)) f |= Btn.Light
    if (this.down.has(m.heavy)) f |= Btn.Heavy
    if (this.down.has(m.special)) f |= Btn.Special
    if (this.down.has(m.throw)) f |= Btn.Throw
    if (this.down.has(m.jump)) f |= Btn.Jump
    if (this.down.has(m.guard)) f |= Btn.Guard
    return f
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown)
    window.removeEventListener('keyup', this.onUp)
    window.removeEventListener('blur', this.onBlur)
  }
}

/**
 * Gamepad and arcade stick. Sticks are quantized to a deadzone-gated digital
 * cross so that a stick and a keyboard produce byte-identical input frames —
 * a requirement if replays and netcode are to stay device-agnostic.
 */
export class GamepadSource implements InputSource {
  constructor(private readonly index = 0, private readonly deadzone = 0.4) {}

  poll(): InputFrame {
    const pads = navigator.getGamepads?.() ?? []
    const pad = pads[this.index]
    if (!pad) return 0
    let f = 0
    const ax = pad.axes[0] ?? 0
    const ay = pad.axes[1] ?? 0
    if (ax < -this.deadzone) f |= Btn.Left
    if (ax > this.deadzone) f |= Btn.Right
    if (ay < -this.deadzone) f |= Btn.Up
    if (ay > this.deadzone) f |= Btn.Down
    const b = pad.buttons
    if (b[12]?.pressed) f |= Btn.Up
    if (b[13]?.pressed) f |= Btn.Down
    if (b[14]?.pressed) f |= Btn.Left
    if (b[15]?.pressed) f |= Btn.Right
    if (b[0]?.pressed) f |= Btn.Light
    if (b[1]?.pressed) f |= Btn.Heavy
    if (b[2]?.pressed) f |= Btn.Special
    if (b[3]?.pressed) f |= Btn.Throw
    if (b[5]?.pressed) f |= Btn.Jump
    if (b[4]?.pressed || b[6]?.pressed) f |= Btn.Guard
    return f
  }
}

/** Merges several devices so a player can switch pad/keyboard mid-match. */
export class CompositeSource implements InputSource {
  constructor(private readonly sources: InputSource[]) {}
  poll(): InputFrame {
    let f = 0
    for (const s of this.sources) f |= s.poll()
    return f
  }
  dispose(): void {
    for (const s of this.sources) s.dispose?.()
  }
}
