/**
 * Renderer, camera rig, and the bridge from sim state to scene graph.
 *
 * Rendering interpolates between the previous and current simulated frames.
 * The sim runs on a fixed 60 Hz tick and the display may be 60, 120, or 144 Hz;
 * without interpolation the mismatch shows up as judder that looks exactly like
 * dropped frames.
 */

import * as THREE from 'three'
import type { ArenaDef } from '../core/defs'
import { fxToFloat } from '../core/fx'
import { SF, has } from '../core/fsm'
import { moveOf, characterAt } from '../data/roster'
import type { MatchState } from '../core/state'
import { buildArena, type ArenaView } from './arena'
import { buildFighter, type FighterView } from './fighter'
import { buildEffects, type Effects } from './effects'

interface Transform {
  x: number
  y: number
  z: number
  facing: number
}

export class View {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  private arena: ArenaView
  private fighters: FighterView[] = []
  private effects: Effects
  private prev: Transform[] = []
  private cur: Transform[] = []
  private debug = false
  private debugBoxes: THREE.Box3Helper[] = []
  private readonly arenaHalfWidth: number
  private readonly camTarget = new THREE.Vector3()
  private readonly camPos = new THREE.Vector3(0, 3.2, 8.5)

  constructor(canvas: HTMLCanvasElement, arenaDef: ArenaDef, charIndices: readonly number[]) {
    this.arenaHalfWidth = arenaDef.halfWidth
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setClearColor(arenaDef.fogColor)
    // Capped at 2: beyond that the pixel cost buys nothing visible and is the
    // most common reason a 60 FPS target quietly becomes a 40 FPS one.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene.fog = new THREE.Fog(arenaDef.fogColor, 12, 30)
    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 120)

    this.arena = buildArena(arenaDef)
    this.scene.add(this.arena.group)

    for (const idx of charIndices) {
      const view = buildFighter(characterAt(idx).def)
      this.fighters.push(view)
      this.scene.add(view.group)
      this.prev.push({ x: 0, y: 0, z: 0, facing: 1 })
      this.cur.push({ x: 0, y: 0, z: 0, facing: 1 })
    }

    this.effects = buildEffects()
    this.scene.add(this.effects.group)

    for (let i = 0; i < 4; i++) {
      const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xff3366))
      helper.visible = false
      this.debugBoxes.push(helper)
      this.scene.add(helper)
    }

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  setDebug(on: boolean): void {
    this.debug = on
  }

  resize(): void {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /** Called once per simulated tick, before the sim advances. */
  captureFrame(state: MatchState): void {
    for (let i = 0; i < this.fighters.length; i++) {
      const f = state.fighters[i]
      if (!f) continue
      const p = this.prev[i]!
      const c = this.cur[i]!
      p.x = c.x; p.y = c.y; p.z = c.z; p.facing = c.facing
      c.x = fxToFloat(f.x)
      c.y = fxToFloat(f.y)
      c.z = fxToFloat(f.z)
      c.facing = f.facing
    }
  }

  /** `alpha` is the fraction of a tick elapsed since the last sim step. */
  render(state: MatchState, alpha: number, dt: number): void {
    this.effects.emit(state.events)
    this.effects.syncProjectiles(state)
    this.effects.update(dt)

    for (let i = 0; i < this.fighters.length; i++) {
      const f = state.fighters[i]
      const view = this.fighters[i]
      if (!f || !view) continue
      const p = this.prev[i]!
      const c = this.cur[i]!
      view.group.position.set(
        p.x + (c.x - p.x) * alpha,
        p.y + (c.y - p.y) * alpha,
        p.z + (c.z - p.z) * alpha,
      )
      // The rig is authored facing +X (limbs separated along Z), which is the
      // same axis the sim's `facing` uses, so facing +1 needs no rotation at
      // all and facing -1 is a half turn. Snapped rather than lerped: a
      // fighter turning through 180 degrees mid-combo would otherwise be shown
      // in profile on exactly the frames the player needs to read the hit.
      view.group.rotation.y = c.facing === 1 ? 0 : Math.PI

      const mv = moveOf(f.charIndex, f.moveIndex)
      view.setPose(
        f.state,
        f.stateFrame,
        mv,
        f.moveFrame,
        f.payloadFrames > 0,
        f.shieldFrames > 0,
      )
    }

    this.arena.update(state.breakableIntegrity)
    this.updateCamera(state, alpha)
    this.updateDebug(state)
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Tekken-style framing: sit on the axis through both fighters, back off as
   * they separate, and keep the pair centred. The maths lives in
   * `solveCameraFraming` so it can be tested without a WebGL context — it went
   * wrong twice (once behind a wall, once jammed against one), and neither
   * failure was catchable by anything but looking at the screen.
   */
  private updateCamera(state: MatchState, alpha: number): void {
    const a = this.lerped(0, alpha)
    const b = this.lerped(1, alpha)

    const shot = solveCameraFraming({
      ax: a.x, az: a.z, bx: b.x, bz: b.z,
      midY: (a.y + b.y) / 2,
      aspect: this.camera.aspect,
      fovDegrees: this.camera.fov,
      arenaHalfWidth: fxToFloat(this.arenaHalfWidth),
    })

    this.camTarget.set(shot.targetX, shot.targetY, shot.targetZ)
    this.camPos.set(shot.x, shot.y, shot.z)

    this.camera.position.lerp(this.camPos, 0.12)
    this.camera.position.add(this.effects.shakeOffset())
    this.camera.lookAt(this.camTarget)
    void state
  }

  private lerped(i: number, alpha: number): Transform {
    const p = this.prev[i]!
    const c = this.cur[i]!
    return {
      x: p.x + (c.x - p.x) * alpha,
      y: p.y + (c.y - p.y) * alpha,
      z: p.z + (c.z - p.z) * alpha,
      facing: c.facing,
    }
  }

  /** F1 overlay: the boxes the sim is actually using, not an approximation. */
  private updateDebug(state: MatchState): void {
    for (const h of this.debugBoxes) h.visible = false
    if (!this.debug) return
    let slot = 0
    state.fighters.forEach((f) => {
      const def = characterAt(f.charIndex).def
      const hb = has(f.state, SF.Crouching) ? def.crouchHurtbox : def.hurtbox
      const helper = this.debugBoxes[slot++]
      if (helper) {
        setBox(helper, f.x, f.y, f.z, f.facing, hb, 0x33ff88)
      }
      const mv = moveOf(f.charIndex, f.moveIndex)
      if (!mv) return
      for (const spec of mv.hitboxes) {
        if (f.moveFrame < spec.from || f.moveFrame >= spec.to) continue
        const h = this.debugBoxes[slot++]
        if (h) setBox(h, f.x, f.y, f.z, f.facing, spec.box, 0xff3366)
        break
      }
    })
  }

  dispose(): void {
    for (const f of this.fighters) f.dispose()
    this.renderer.dispose()
  }
}

function setBox(
  helper: THREE.Box3Helper,
  ox: number, oy: number, oz: number, facing: number,
  b: { x: number; y: number; z: number; hw: number; hh: number; hd: number },
  color: number,
): void {
  const cx = fxToFloat(ox + facing * b.x)
  const cy = fxToFloat(oy + b.y)
  const cz = fxToFloat(oz + facing * b.z)
  const hw = fxToFloat(b.hw)
  const hh = fxToFloat(b.hh)
  const hd = fxToFloat(b.hd)
  helper.box.min.set(cx - hw, cy - hh, cz - hd)
  helper.box.max.set(cx + hw, cy + hh, cz + hd)
  ;(helper.material as THREE.LineBasicMaterial).color.setHex(color)
  helper.visible = true
  helper.updateMatrixWorld(true)
}

/* ------------------------------------------------------------------ */
/* Camera framing                                                       */
/* ------------------------------------------------------------------ */

export interface FramingInput {
  ax: number
  az: number
  bx: number
  bz: number
  midY: number
  aspect: number
  fovDegrees: number
  arenaHalfWidth: number
}

export interface FramingResult {
  x: number
  y: number
  z: number
  targetX: number
  targetY: number
  targetZ: number
  distance: number
  /** Half-width of the view at the fighters' depth; the tests use it. */
  halfViewWidth: number
}

/** How close to a side wall the camera is allowed to be framed. */
export const WALL_MARGIN = 2.2
/**
 * How far the orbit may swing away from the depth axis. Kept under 45 degrees
 * so the camera is always more in front of the action than beside it.
 */
export const MAX_ORBIT_RADIANS = (40 * Math.PI) / 180
/** Keep the camera itself this far inside the side walls. */
const CAMERA_WALL_CLEARANCE = 0.6
/** Half a body plus a little air, added to the lateral fit. */
const BODY_MARGIN = 0.9
const MAX_DISTANCE = 30

/**
 * Pure camera solve. No three.js state, no side effects — position and
 * look-at from fighter positions and viewport shape alone.
 *
 * Solved iteratively rather than in one shot. The three quantities involved
 * are circular: the orbit angle is limited by how much room the distance
 * leaves before the wall, and the distance needed depends on how far off the
 * view axis the orbit puts the fighters. Placing the camera once and hoping
 * was what produced both of the framing bugs this replaced — a camera behind
 * the wall, and fighters cropped out of shot on a narrow window.
 */
export function solveCameraFraming(input: FramingInput): FramingResult {
  const { ax, az, bx, bz, midY, aspect, fovDegrees, arenaHalfWidth } = input
  const midX = (ax + bx) / 2
  const midZ = (az + bz) / 2
  const dx = bx - ax
  const dz = bz - az
  const sep = Math.hypot(dx, dz)

  // Pull the framing centre away from the side walls. Centring exactly on the
  // fighters parks the camera inches from a wall during a corner exchange, and
  // the wall then sweeps across the frame and hides the fight behind it.
  // Clamping the camera's own position instead jams it against the wall at
  // point-blank range, so the centre is what moves.
  const limit = Math.max(0, arenaHalfWidth - WALL_MARGIN)
  const frameX = Math.min(limit, Math.max(-limit, midX))
  const offset = Math.abs(midX - frameX)

  const halfV = Math.tan((fovDegrees * Math.PI) / 360)
  const halfH = halfV * aspect

  // Perpendicular to the line between the fighters, so both stay in profile —
  // clamped, because a pure perpendicular swings onto the X axis when the
  // fighters line up along Z, which is how the camera ended up outside the
  // arena filming the back of a wall.
  const len = Math.max(sep, 0.001)
  const side = dx / len >= 0 ? 1 : -1
  const angle = Math.min(
    MAX_ORBIT_RADIANS,
    Math.max(-MAX_ORBIT_RADIANS, Math.atan2((-dz / len) * side, (dx / len) * side)),
  )

  const camLimit = Math.max(0.5, arenaHalfWidth - CAMERA_WALL_CLEARANCE)
  let distance = Math.max(5, (sep + 3 + offset * 2) / 2 / halfH, 3.6 / 2 / halfV)

  let x = frameX
  let z = midZ + distance
  let halfViewWidth = distance * halfH

  for (let pass = 0; pass < 6; pass++) {
    // Limit the swing to whatever X room is left before the wall, rather than
    // clamping the finished position — clamping the position moves the camera
    // without moving what it is looking at, which is what jammed it into the
    // corner at point-blank range.
    const hiSin = (camLimit - frameX) / distance
    const loSin = (-camLimit - frameX) / distance
    const sinA = Math.min(1, Math.max(-1, Math.min(hiSin, Math.max(loSin, Math.sin(angle)))))
    const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA))

    x = frameX + sinA * distance
    z = midZ + cosA * side * distance
    halfViewWidth = distance * halfH

    // Measure how far off the view axis the fighters actually ended up, and
    // back off if the frustum does not cover them.
    const fwdX = frameX - x
    const fwdZ = midZ - z
    const fwdLen = Math.hypot(fwdX, fwdZ) || 1
    const rightX = -fwdZ / fwdLen
    const rightZ = fwdX / fwdLen
    let lateral = 0
    for (const [fx, fz] of [[ax, az], [bx, bz]] as const) {
      lateral = Math.max(lateral, Math.abs((fx - x) * rightX + (fz - z) * rightZ))
    }

    const needed = (lateral + BODY_MARGIN) / halfH
    if (needed <= distance + 1e-6 || distance >= MAX_DISTANCE) break
    distance = Math.min(MAX_DISTANCE, needed)
  }

  return {
    x,
    y: midY + 1.55 + distance * 0.16,
    z,
    targetX: frameX,
    targetY: midY + 1.15,
    targetZ: midZ,
    distance,
    halfViewWidth,
  }
}
