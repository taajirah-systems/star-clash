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
  private readonly camTarget = new THREE.Vector3()
  private readonly camPos = new THREE.Vector3(0, 3.2, 8.5)

  constructor(canvas: HTMLCanvasElement, arenaDef: ArenaDef, charIndices: readonly number[]) {
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
   * they separate, and keep the pair centred. Distance is clamped so a corner
   * exchange never pushes the camera through the arena rail.
   */
  private updateCamera(state: MatchState, alpha: number): void {
    const a = this.lerped(0, alpha)
    const b = this.lerped(1, alpha)
    const midX = (a.x + b.x) / 2
    const midZ = (a.z + b.z) / 2
    const midY = (a.y + b.y) / 2

    const dx = b.x - a.x
    const dz = b.z - a.z
    const sep = Math.hypot(dx, dz)

    // Solve for the distance that actually fits the pair, rather than scaling a
    // magic number by the aspect. Scaling overshoots badly on a tall window: it
    // assumes the full 16:9 width is needed when the fighters only ever occupy
    // the middle of it, and pushes the camera far enough back that they shrink.
    const halfV = Math.tan((this.camera.fov * Math.PI) / 360)
    const halfH = halfV * this.camera.aspect
    const needWidth = sep + 3.0   // both bodies plus breathing room
    const needHeight = 3.6        // tallest fighter plus a juggle's headroom
    const dist = THREE.MathUtils.clamp(
      Math.max(needWidth / 2 / halfH, needHeight / 2 / halfV),
      5.0,
      20,
    )

    // Perpendicular to the line between the fighters, so both stay in profile.
    const len = Math.max(sep, 0.001)
    const px = -dz / len
    const pz = dx / len
    const side = pz >= 0 ? 1 : -1

    const target = this.camTarget.set(midX, midY + 1.15, midZ)
    const want = this.camPos.set(
      midX + px * dist * side,
      midY + 1.55 + dist * 0.16,
      midZ + pz * dist * side,
    )

    this.camera.position.lerp(want, 0.12)
    this.camera.position.add(this.effects.shakeOffset())
    this.camera.lookAt(target)
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
