/**
 * Impact sparks, projectile bodies, and screen shake.
 *
 * Every effect is pooled. Allocating a particle system on impact is the
 * classic way to turn a clean 60 FPS into a stutter on exactly the frames the
 * player cares most about, so nothing here allocates after construction.
 */

import * as THREE from 'three'
import { DamageKind } from '../core/defs'
import { fxToFloat } from '../core/fx'
import type { HitEvent, MatchState } from '../core/state'
import { glowMaterial } from './toon'

const SPARKS = 48
const SHARDS_PER_HIT = 10

interface Spark {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
}

export interface Effects {
  group: THREE.Group
  /** Spawns the visuals for this frame's hits. */
  emit(events: readonly HitEvent[]): void
  syncProjectiles(state: MatchState): void
  update(dt: number): void
  /** Camera offset to add this frame, in world units. */
  shakeOffset(): THREE.Vector3
}

export function buildEffects(): Effects {
  const group = new THREE.Group()

  const physicalMat = glowMaterial(0xffd479)
  const energyMat = glowMaterial(0x8be9ff)
  const blockMat = glowMaterial(0xa0b4c8)
  const parryMat = glowMaterial(0xffffff)
  const shardGeo = new THREE.TetrahedronGeometry(0.075)

  const sparks: Spark[] = []
  for (let i = 0; i < SPARKS; i++) {
    const mesh = new THREE.Mesh(shardGeo, physicalMat)
    mesh.visible = false
    group.add(mesh)
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 })
  }

  // Ring flash for parries and blocks; one is plenty since they never stack.
  // Kept thin and additive so it reads as an impact flash — a thick, opaque
  // disc just hides the fighters at the moment the player is trying to read
  // whether the hit was blocked.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.46, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  group.add(ring)
  let ringLife = 0

  const projectileGeo = new THREE.CapsuleGeometry(0.13, 0.34, 4, 8)
  const projectiles: THREE.Mesh[] = []
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(projectileGeo, energyMat)
    p.rotation.z = Math.PI / 2
    p.visible = false
    group.add(p)
    projectiles.push(p)
  }

  let shake = 0
  const shakeVec = new THREE.Vector3()
  // Deterministic-looking jitter without touching Math.random on the sim path.
  let shakePhase = 0

  let cursor = 0
  function takeSpark(): Spark {
    const s = sparks[cursor]!
    cursor = (cursor + 1) % SPARKS
    return s
  }

  return {
    group,

    emit(events) {
      for (const e of events) {
        const x = fxToFloat(e.x)
        const y = fxToFloat(e.y)
        const z = fxToFloat(e.z)

        const mat = e.parried ? parryMat : e.blocked ? blockMat : e.kind === DamageKind.Energy ? energyMat : physicalMat
        const count = e.blocked ? 4 : e.counter ? SHARDS_PER_HIT + 5 : SHARDS_PER_HIT

        for (let i = 0; i < count; i++) {
          const s = takeSpark()
          s.mesh.material = mat
          s.mesh.position.set(x, y, z)
          s.mesh.visible = true
          // Fan the shards outward with a cheap deterministic spread.
          const a = (i / count) * Math.PI * 2 + shakePhase
          const speed = (e.blocked ? 1.6 : 3.4) * (0.6 + ((i * 37) % 10) / 14)
          s.vx = Math.cos(a) * speed
          s.vy = Math.abs(Math.sin(a)) * speed * 0.9 + 1.2
          s.vz = Math.sin(a * 1.7) * speed * 0.5
          s.maxLife = e.blocked ? 0.22 : 0.4
          s.life = s.maxLife
        }
        shakePhase += 0.7

        if (e.parried || e.blocked) {
          ring.position.set(x, y, z)
          ringLife = 0.25
        }

        // Shake scales with what actually landed, so chip damage does not
        // rattle the camera as hard as a counter-hit heavy.
        const strength = e.parried ? 0.10 : e.blocked ? 0.03 : Math.min(0.22, 0.03 + e.damage / 700)
        shake = Math.max(shake, strength)
      }
    },

    syncProjectiles(state) {
      state.projectiles.forEach((p, i) => {
        const mesh = projectiles[i]
        if (!mesh) return
        mesh.visible = p.active === 1
        if (p.active === 1) {
          mesh.position.set(fxToFloat(p.x), fxToFloat(p.y), fxToFloat(p.z))
          mesh.scale.setScalar(1 + 0.12 * Math.sin(p.life * 0.6))
        }
      })
    },

    update(dt) {
      for (const s of sparks) {
        if (s.life <= 0) continue
        s.life -= dt
        if (s.life <= 0) {
          s.mesh.visible = false
          continue
        }
        s.mesh.position.x += s.vx * dt
        s.mesh.position.y += s.vy * dt
        s.mesh.position.z += s.vz * dt
        s.vy -= 11 * dt
        const k = s.life / s.maxLife
        s.mesh.scale.setScalar(0.4 + k * 0.9)
        s.mesh.rotation.x += dt * 9
        s.mesh.rotation.y += dt * 7
      }

      if (ringLife > 0) {
        ringLife -= dt
        const k = Math.max(0, ringLife / 0.25)
        const mat = ring.material as THREE.MeshBasicMaterial
        mat.opacity = k * 0.55
        ring.scale.setScalar(0.7 + (1 - k) * 0.9)
      } else {
        ;(ring.material as THREE.MeshBasicMaterial).opacity = 0
      }

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 0.9)
        shakePhase += dt * 60
        shakeVec.set(
          Math.sin(shakePhase * 2.3) * shake,
          Math.cos(shakePhase * 3.1) * shake * 0.7,
          Math.sin(shakePhase * 1.7) * shake * 0.4,
        )
      } else {
        shakeVec.set(0, 0, 0)
      }
    },

    shakeOffset() {
      return shakeVec
    },
  }
}
