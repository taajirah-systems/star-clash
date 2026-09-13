/**
 * Placeholder fighter rig and its posing.
 *
 * These are primitives, not authored models — the point is that the combat is
 * readable without an art pipeline. Poses are driven straight from the sim's
 * state and move progress rather than from an animation clip, so a change to
 * frame data is visible immediately and the silhouette never disagrees with
 * the hitboxes.
 */

import * as THREE from 'three'
import type { CharacterDef, MoveDef } from '../core/defs'
import { Guard } from '../core/defs'
import { St, SF, has } from '../core/fsm'
import { fxToFloat } from '../core/fx'
import { toonMaterial, withOutline } from './toon'

export interface FighterView {
  group: THREE.Group
  setPose(
    state: St,
    stateFrame: number,
    move: MoveDef | null,
    moveFrame: number,
    payloadActive: boolean,
    shieldActive: boolean,
  ): void
  dispose(): void
}

interface Rig {
  root: THREE.Group
  body: THREE.Group
  torso: THREE.Mesh
  head: THREE.Mesh
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  aura: THREE.Mesh
  shield: THREE.Mesh
}

function limb(length: number, radius: number, color: number): THREE.Group {
  const pivot = new THREE.Group()
  const mesh = withOutline(
    new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 8), toonMaterial(color)),
    0.022,
  )
  // Hangs from the pivot, so rotating the pivot swings the limb from its joint.
  mesh.position.y = -length / 2
  pivot.add(mesh)
  return pivot
}

export function buildFighter(def: CharacterDef): FighterView {
  const h = fxToFloat(def.height)
  const shoulder = h * 0.80
  const hip = h * 0.50

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const torso = withOutline(
    new THREE.Mesh(new THREE.CapsuleGeometry(h * 0.15, h * 0.30, 6, 10), toonMaterial(def.color)),
  )
  torso.position.y = (shoulder + hip) / 2

  const head = withOutline(
    new THREE.Mesh(new THREE.SphereGeometry(h * 0.115, 14, 12), toonMaterial(def.accent)),
  )
  head.position.y = h * 0.92

  const armL = limb(h * 0.36, h * 0.048, def.color)
  const armR = limb(h * 0.36, h * 0.048, def.accent)
  armL.position.set(0, shoulder, -h * 0.16)
  armR.position.set(0, shoulder, h * 0.16)

  const legL = limb(h * 0.48, h * 0.058, def.color)
  const legR = limb(h * 0.48, h * 0.058, def.color)
  legL.position.set(0, hip, -h * 0.09)
  legR.position.set(0, hip, h * 0.09)

  // Ring on the floor: coloured while a signature payload is running.
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(h * 0.24, h * 0.34, 24),
    new THREE.MeshBasicMaterial({ color: def.accent, transparent: true, opacity: 0 }),
  )
  aura.rotation.x = -Math.PI / 2
  aura.position.y = 0.02

  // Hex bubble for Echo-Nine's nanoprobe shield.
  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(h * 0.55, 1),
    new THREE.MeshBasicMaterial({ color: def.accent, wireframe: true, transparent: true, opacity: 0 }),
  )
  shield.position.y = h * 0.55

  body.add(torso, head, armL, armR, legL, legR)
  root.add(aura, shield)

  const rig: Rig = { root, body, torso, head, armL, armR, legL, legR, aura, shield }

  return {
    group: root,
    setPose(state, stateFrame, move, moveFrame, payloadActive, shieldActive) {
      pose(rig, def, state, stateFrame, move, moveFrame)
      const auraMat = rig.aura.material as THREE.MeshBasicMaterial
      auraMat.opacity = payloadActive ? 0.35 + 0.25 * Math.sin(stateFrame * 0.25) : 0
      const shieldMat = rig.shield.material as THREE.MeshBasicMaterial
      shieldMat.opacity = shieldActive ? 0.30 + 0.12 * Math.sin(stateFrame * 0.2) : 0
      rig.shield.rotation.y += shieldActive ? 0.02 : 0
    },
    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
    },
  }
}

/** 0..1 progress through a move's three phases. */
function phaseOf(move: MoveDef, frame: number): { wind: number; strike: number; back: number } {
  const s = move.startup
  const a = move.active
  const total = s + a + move.recovery
  if (frame < s) return { wind: s === 0 ? 1 : frame / s, strike: 0, back: 0 }
  if (frame < s + a) return { wind: 1, strike: a === 0 ? 1 : (frame - s) / a, back: 0 }
  const r = total - s - a
  return { wind: 1, strike: 1, back: r === 0 ? 1 : (frame - s - a) / r }
}

function reset(rig: Rig): void {
  rig.body.position.set(0, 0, 0)
  rig.body.rotation.set(0, 0, 0)
  rig.armL.rotation.set(0, 0, 0)
  rig.armR.rotation.set(0, 0, 0)
  rig.legL.rotation.set(0, 0, 0)
  rig.legR.rotation.set(0, 0, 0)
  rig.head.rotation.set(0, 0, 0)
}

function pose(
  rig: Rig,
  def: CharacterDef,
  state: St,
  stateFrame: number,
  move: MoveDef | null,
  moveFrame: number,
): void {
  reset(rig)
  const t = stateFrame

  if (has(state, SF.Attacking) && move) {
    const { wind, strike, back } = phaseOf(move, moveFrame)
    // Wind up away from the target, snap through, then settle.
    const extend = strike > 0 && back === 0 ? 1 : back > 0 ? 1 - back : -0.35 * wind
    const low = move.guard === Guard.Low
    const high = move.guard === Guard.High

    if (low) {
      rig.legR.rotation.z = -1.5 * extend
      rig.body.rotation.z = 0.35 * extend
      rig.body.position.y = -0.28 * Math.max(extend, 0)
      rig.armL.rotation.z = 0.6
    } else if (high) {
      rig.legR.rotation.z = -2.1 * extend
      rig.body.rotation.z = -0.5 * extend
      rig.body.position.y = 0.15 * Math.max(extend, 0)
    } else {
      rig.armR.rotation.z = -1.85 * extend
      rig.armL.rotation.z = 0.55 * extend
      rig.body.rotation.y = -0.35 * extend
      rig.legL.rotation.z = 0.25 * extend
    }
    // A brief forward lean sells the commitment on the active frames.
    rig.body.position.x = 0.10 * Math.max(strike - back, 0)
    return
  }

  switch (state) {
    case St.Idle: {
      const bob = Math.sin(t * 0.11) * 0.018
      rig.body.position.y = bob
      rig.armL.rotation.z = 0.22 + bob
      rig.armR.rotation.z = -0.22 - bob
      break
    }
    case St.WalkForward:
    case St.WalkBack: {
      const swing = Math.sin(t * 0.28) * 0.55
      rig.legL.rotation.z = swing
      rig.legR.rotation.z = -swing
      rig.armL.rotation.z = -swing * 0.6
      rig.armR.rotation.z = swing * 0.6
      break
    }
    case St.SidestepLeft:
    case St.SidestepRight: {
      const lean = state === St.SidestepLeft ? -0.28 : 0.28
      rig.body.rotation.x = lean
      rig.legL.rotation.x = -lean
      rig.legR.rotation.x = lean
      break
    }
    case St.DashForward:
    case St.DashBack: {
      const dir = state === St.DashForward ? 1 : -1
      rig.body.rotation.y = -0.45 * dir
      rig.body.position.y = -0.06
      rig.legL.rotation.z = 0.8 * dir
      rig.legR.rotation.z = -0.5 * dir
      break
    }
    case St.Crouch:
      rig.body.position.y = -fxToFloat(def.height) * 0.22
      rig.legL.rotation.z = 0.7
      rig.legR.rotation.z = -0.7
      break
    case St.GuardStand:
    case St.BlockStun:
      rig.armL.rotation.z = -1.35
      rig.armR.rotation.z = -1.15
      rig.body.rotation.y = -0.5
      rig.body.position.x = -0.05
      break
    case St.GuardCrouch:
      rig.body.position.y = -fxToFloat(def.height) * 0.22
      rig.armL.rotation.z = -1.35
      rig.armR.rotation.z = -1.15
      rig.body.rotation.y = -0.5
      break
    case St.Parry:
      rig.armR.rotation.z = -2.0
      rig.body.rotation.y = -0.7
      break
    case St.MeterBurst:
      rig.armL.rotation.z = 1.9
      rig.armR.rotation.z = -1.9
      rig.body.position.y = 0.10
      break
    case St.JumpRise:
    case St.AirRecovery:
      rig.legL.rotation.z = 0.9
      rig.legR.rotation.z = 0.5
      rig.armL.rotation.z = 1.1
      rig.armR.rotation.z = -1.1
      break
    case St.JumpFall:
      rig.legL.rotation.z = 0.35
      rig.legR.rotation.z = 0.15
      rig.armL.rotation.z = 0.8
      rig.armR.rotation.z = -0.8
      break
    case St.HitStun:
    case St.Stagger: {
      const shake = Math.sin(t * 1.7) * 0.06
      rig.body.rotation.y = 0.55 + shake
      rig.body.position.x = -0.14
      rig.head.rotation.z = 0.4
      rig.armL.rotation.z = 0.9
      rig.armR.rotation.z = -0.3
      break
    }
    case St.Paralyzed:
      rig.body.rotation.z = 0.12
      rig.armL.rotation.z = 0.15
      rig.armR.rotation.z = -0.15
      rig.head.rotation.z = 0.25
      break
    case St.Juggle:
      rig.body.rotation.z = Math.min(1.2, t * 0.09)
      rig.legL.rotation.z = 0.7
      rig.armR.rotation.z = -1.4
      break
    case St.Knockdown:
    case St.Defeated:
      rig.body.rotation.z = Math.PI / 2
      rig.body.position.y = -fxToFloat(def.height) * 0.42
      break
    case St.Wakeup:
      rig.body.rotation.z = (Math.PI / 2) * (1 - Math.min(1, t / 18))
      rig.body.position.y = -fxToFloat(def.height) * 0.42 * (1 - Math.min(1, t / 18))
      break
    default:
      break
  }
}
