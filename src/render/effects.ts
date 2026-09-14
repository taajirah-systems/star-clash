/**
 * Impact sparks, weapon trails, shockwaves, dust, projectiles, screen shake.
 *
 * Every effect is pooled and every buffer is allocated once. Spawning a
 * particle system on impact is the classic way to turn a clean 60 FPS into a
 * stutter on exactly the frames the player cares most about.
 */

import * as THREE from 'three'
import { DamageKind } from '../core/defs'
import { fxToFloat } from '../core/fx'
import type { HitEvent, MatchState } from '../core/state'
import { glowMaterial } from './toon'

const SPARKS = 96
const SHOCKWAVES = 5
const FLASHES = 5
const DUSTS = 24
/** Samples kept per weapon trail. More is a longer smear. */
const TRAIL_SAMPLES = 14

interface Spark {
  mesh: THREE.Mesh
  vx: number; vy: number; vz: number
  spin: number
  life: number
  maxLife: number
}

interface Timed {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  scale: number
}

export interface Effects {
  group: THREE.Group
  emit(events: readonly HitEvent[]): void
  syncProjectiles(state: MatchState): void
  /**
   * Feeds one fighter's strike point for this frame. `active` false breaks the
   * ribbon so a trail never stretches between two separate swings.
   */
  feedTrail(slot: 0 | 1, point: THREE.Vector3 | null, color: number, cameraPos: THREE.Vector3): void
  dust(x: number, y: number, z: number, dir: number): void
  update(dt: number, camera: THREE.Camera): void
  shakeOffset(): THREE.Vector3
  /** 0..1, decaying — drives chromatic aberration and camera punch. */
  impact(): number
  /** 0..1, decaying — full-screen flash. */
  flash(): number
  flashColor(): number
}

/**
 * A ribbon that follows a point through space.
 *
 * Built as one pre-allocated triangle strip whose vertices are rewritten each
 * frame, rather than as geometry rebuilt per frame — a swing lasts four or
 * five frames and allocating through it would be felt.
 */
class Trail {
  readonly mesh: THREE.Mesh
  private readonly points: THREE.Vector3[] = []
  private readonly positions: Float32Array
  private readonly material: THREE.MeshBasicMaterial
  private broken = true
  /** Last non-degenerate travel direction, so a stalled tip keeps its width. */
  private readonly lastDir = new THREE.Vector3(1, 0, 0)

  constructor() {
    const geo = new THREE.BufferGeometry()
    this.positions = new Float32Array(TRAIL_SAMPLES * 2 * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))

    const index: number[] = []
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geo.setIndex(index)

    // Fades along its length, so the tail dissolves instead of stopping dead.
    const alphas = new Float32Array(TRAIL_SAMPLES * 2)
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const a = 1 - i / (TRAIL_SAMPLES - 1)
      alphas[i * 2] = a
      alphas[i * 2 + 1] = a
    }
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vAlpha = aAlpha;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vAlpha * vAlpha;')
    }

    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  push(p: THREE.Vector3 | null, color: number, camera: THREE.Vector3): void {
    if (!p) {
      this.points.length = 0
      this.broken = true
      this.mesh.visible = false
      return
    }
    this.material.color.setHex(color)
    if (this.broken) {
      // Seed the whole ribbon at the first point so it grows out of the hand
      // rather than snapping in from wherever it was left.
      for (let i = 0; i < TRAIL_SAMPLES; i++) this.points.push(p.clone())
      this.broken = false
    } else {
      this.points.unshift(p.clone())
      if (this.points.length > TRAIL_SAMPLES) this.points.length = TRAIL_SAMPLES
    }
    this.mesh.visible = true
    this.rebuild(camera)
  }

  private rebuild(camera: THREE.Vector3): void {
    const up = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const toCam = new THREE.Vector3()
    for (let i = 0; i < TRAIL_SAMPLES; i++) {
      const p = this.points[Math.min(i, this.points.length - 1)]!
      const next = this.points[Math.min(i + 1, this.points.length - 1)]!
      dir.subVectors(next, p)
      if (dir.lengthSq() < 1e-8) dir.copy(this.lastDir)
      else this.lastDir.copy(dir).normalize()

      // Width is taken across the swing AND across the view direction, so the
      // ribbon always faces the camera. A fixed world-space perpendicular
      // collapses to zero width whenever the swing happens to travel along
      // that axis, which is what turned the trail into a zigzag of slivers.
      toCam.subVectors(camera, p)
      up.crossVectors(dir, toCam)
      if (up.lengthSq() < 1e-10) up.set(0, 1, 0)
      up.normalize()
      const w = 0.075 * (1 - i / TRAIL_SAMPLES) + 0.010
      const o = i * 6
      this.positions[o] = p.x + up.x * w
      this.positions[o + 1] = p.y + up.y * w
      this.positions[o + 2] = p.z + up.z * w
      this.positions[o + 3] = p.x - up.x * w
      this.positions[o + 4] = p.y - up.y * w
      this.positions[o + 5] = p.z - up.z * w
    }
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
  }

  fade(): void {
    if (this.material.opacity > 0) this.material.opacity = 0.85
  }
}

/**
 * Soft radial sprite used for impact flashes.
 *
 * The first version used a bare plane with an additive white material, which
 * is a hard-edged square — at impact scale it read as a white box pasted over
 * the fight and blew out the entire frame.
 */
function softDot(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export function buildEffects(): Effects {
  const group = new THREE.Group()
  const dotTex = softDot()

  const physicalMat = glowMaterial(0xffd479)
  const energyMat = glowMaterial(0x8be9ff)
  const blockMat = glowMaterial(0xb8c8dc, 0.8)
  const parryMat = glowMaterial(0xffffff)

  /* ---- Sparks ---- */
  const shardGeo = new THREE.TetrahedronGeometry(0.07)
  const sparks: Spark[] = []
  for (let i = 0; i < SPARKS; i++) {
    const mesh = new THREE.Mesh(shardGeo, physicalMat)
    mesh.visible = false
    mesh.frustumCulled = false
    group.add(mesh)
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, spin: 0, life: 0, maxLife: 1 })
  }
  let sparkCursor = 0

  /* ---- Shockwave rings ---- */
  const ringGeo = new THREE.RingGeometry(0.30, 0.44, 32)
  const waves: Timed[] = []
  for (let i = 0; i < SHOCKWAVES; i++) {
    const mesh = new THREE.Mesh(ringGeo, glowMaterial(0xffffff, 0))
    mesh.visible = false
    group.add(mesh)
    waves.push({ mesh, life: 0, maxLife: 1, scale: 1 })
  }
  let waveCursor = 0

  /* ---- Impact flashes: a bright cross at the contact point ---- */
  const flashGeo = new THREE.PlaneGeometry(1, 1)
  const flashes: Timed[] = []
  for (let i = 0; i < FLASHES; i++) {
    const mat = glowMaterial(0xffffff, 0)
    mat.map = dotTex
    const mesh = new THREE.Mesh(flashGeo, mat)
    mesh.visible = false
    group.add(mesh)
    flashes.push({ mesh, life: 0, maxLife: 1, scale: 1 })
  }
  let flashCursor = 0

  /* ---- Ground dust ---- */
  const dustGeo = new THREE.CircleGeometry(0.12, 8)
  const dusts: Spark[] = []
  for (let i = 0; i < DUSTS; i++) {
    const mesh = new THREE.Mesh(dustGeo, glowMaterial(0x9fb4d0, 0.35))
    mesh.visible = false
    mesh.rotation.x = -Math.PI / 2
    group.add(mesh)
    dusts.push({ mesh, vx: 0, vy: 0, vz: 0, spin: 0, life: 0, maxLife: 1 })
  }
  let dustCursor = 0

  /* ---- Projectiles ---- */
  const projGeo = new THREE.CapsuleGeometry(0.14, 0.40, 6, 10)
  const projectiles: THREE.Mesh[] = []
  const projGlows: THREE.Mesh[] = []
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(projGeo, energyMat)
    p.rotation.z = Math.PI / 2
    p.visible = false
    group.add(p)
    projectiles.push(p)

    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8), glowMaterial(0x8be9ff, 0.30))
    halo.visible = false
    group.add(halo)
    projGlows.push(halo)
  }

  /* ---- Trails ---- */
  const trails: [Trail, Trail] = [new Trail(), new Trail()]
  group.add(trails[0].mesh, trails[1].mesh)

  /* ---- Screen state ---- */
  let shake = 0
  let impactLevel = 0
  let flashLevel = 0
  let flashHex = 0xffffff
  let phase = 0
  const shakeVec = new THREE.Vector3()

  function takeSpark(): Spark {
    const s = sparks[sparkCursor]!
    sparkCursor = (sparkCursor + 1) % SPARKS
    return s
  }

  return {
    group,

    emit(events) {
      for (const e of events) {
        const x = fxToFloat(e.x)
        const y = fxToFloat(e.y)
        const z = fxToFloat(e.z)

        const mat = e.parried ? parryMat
          : e.blocked ? blockMat
          : e.kind === DamageKind.Energy ? energyMat : physicalMat
        const heavy = e.damage >= 60 || e.counter
        const count = e.blocked ? 6 : heavy ? 26 : 16

        for (let i = 0; i < count; i++) {
          const s = takeSpark()
          s.mesh.material = mat
          s.mesh.position.set(x, y, z)
          s.mesh.visible = true
          s.mesh.scale.setScalar(1)
          // Fanned in a disc facing the camera plane, with a deterministic
          // spread — random scatter reads as noise, a fan reads as force.
          const a = (i / count) * Math.PI * 2 + phase
          const speed = (e.blocked ? 1.5 : heavy ? 3.6 : 2.5) * (0.55 + ((i * 37) % 11) / 12)
          s.vx = Math.cos(a) * speed
          s.vy = Math.abs(Math.sin(a)) * speed * 0.7 + 0.9
          s.vz = Math.sin(a * 1.7) * speed * 0.45
          s.spin = 6 + (i % 5) * 3
          s.maxLife = e.blocked ? 0.18 : heavy ? 0.38 : 0.28
          s.life = s.maxLife
        }
        phase += 0.61

        // Contact flash.
        const fl = flashes[flashCursor]!
        flashCursor = (flashCursor + 1) % FLASHES
        fl.mesh.position.set(x, y, z)
        fl.mesh.visible = true
        ;(fl.mesh.material as THREE.MeshBasicMaterial).color.copy((mat as THREE.MeshBasicMaterial).color)
        fl.maxLife = 0.15
        fl.life = fl.maxLife
        fl.scale = heavy ? 1.15 : 0.62

        // Shockwave on anything meaningful.
        if (!e.blocked || e.parried) {
          const w = waves[waveCursor]!
          waveCursor = (waveCursor + 1) % SHOCKWAVES
          w.mesh.position.set(x, y, z)
          w.mesh.visible = true
          ;(w.mesh.material as THREE.MeshBasicMaterial).color.copy((mat as THREE.MeshBasicMaterial).color)
          w.maxLife = e.parried ? 0.34 : 0.26
          w.life = w.maxLife
          w.scale = e.parried ? 4.0 : heavy ? 3.2 : 2.0
        }

        // Camera and frame response, scaled by what actually landed.
        const strength = e.parried ? 0.16 : e.blocked ? 0.035 : Math.min(0.30, 0.05 + e.damage / 520)
        shake = Math.max(shake, strength)
        impactLevel = Math.max(impactLevel, e.parried ? 0.5 : e.blocked ? 0.12 : Math.min(0.85, 0.18 + e.damage / 420))
        if (e.parried) { flashLevel = Math.max(flashLevel, 0.14); flashHex = 0xffffff }
        else if (e.counter) { flashLevel = Math.max(flashLevel, 0.10); flashHex = 0xffd479 }
      }
    },

    syncProjectiles(state) {
      state.projectiles.forEach((p, i) => {
        const mesh = projectiles[i]
        const halo = projGlows[i]
        if (!mesh || !halo) return
        const on = p.active === 1
        mesh.visible = on
        halo.visible = on
        if (!on) return
        const x = fxToFloat(p.x)
        const y = fxToFloat(p.y)
        const z = fxToFloat(p.z)
        mesh.position.set(x, y, z)
        halo.position.set(x, y, z)
        const pulse = 1 + 0.16 * Math.sin(p.life * 0.65)
        mesh.scale.set(1.25 * pulse, pulse, pulse)
        halo.scale.setScalar(pulse * (0.85 + 0.15 * Math.sin(p.life * 1.3)))
      })
    },

    feedTrail(slot, point, color, cameraPos) {
      trails[slot].push(point, color, cameraPos)
      trails[slot].fade()
    },

    dust(x, y, z, dir) {
      for (let i = 0; i < 3; i++) {
        const d = dusts[dustCursor]!
        dustCursor = (dustCursor + 1) % DUSTS
        d.mesh.position.set(x, y + 0.03, z)
        d.mesh.visible = true
        d.mesh.scale.setScalar(0.6)
        d.vx = -dir * (1.4 + i * 0.5)
        d.vy = 0.5 + i * 0.2
        d.vz = (i - 1) * 0.5
        d.life = 0.42
        d.maxLife = 0.42
      }
    },

    update(dt, camera) {
      for (const s of sparks) {
        if (s.life <= 0) continue
        s.life -= dt
        if (s.life <= 0) { s.mesh.visible = false; continue }
        s.mesh.position.x += s.vx * dt
        s.mesh.position.y += s.vy * dt
        s.mesh.position.z += s.vz * dt
        s.vy -= 22 * dt
        if (s.mesh.position.y < 0.03) { s.mesh.position.y = 0.03; s.vy *= -0.35; s.vx *= 0.7 }
        const k = s.life / s.maxLife
        s.mesh.scale.setScalar(0.30 + k * 0.85)
        s.mesh.rotation.x += dt * s.spin
        s.mesh.rotation.y += dt * s.spin * 0.8
      }

      for (const d of dusts) {
        if (d.life <= 0) continue
        d.life -= dt
        if (d.life <= 0) { d.mesh.visible = false; continue }
        d.mesh.position.x += d.vx * dt
        d.mesh.position.z += d.vz * dt
        const k = d.life / d.maxLife
        d.mesh.scale.setScalar(0.5 + (1 - k) * 1.6)
        ;(d.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.30
      }

      // Rings and flashes are billboarded so they read the same from any
      // camera angle — a ring seen edge-on is an invisible ring.
      for (const w of waves) {
        if (w.life <= 0) { w.mesh.visible = false; continue }
        w.life -= dt
        const k = Math.max(0, w.life / w.maxLife)
        w.mesh.quaternion.copy(camera.quaternion)
        w.mesh.scale.setScalar(0.4 + (1 - k) * w.scale)
        ;(w.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.42
        if (w.life <= 0) w.mesh.visible = false
      }

      for (const f of flashes) {
        if (f.life <= 0) { f.mesh.visible = false; continue }
        f.life -= dt
        const k = Math.max(0, f.life / f.maxLife)
        f.mesh.quaternion.copy(camera.quaternion)
        f.mesh.scale.setScalar(f.scale * (0.6 + (1 - k) * 0.7))
        ;(f.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.55
        if (f.life <= 0) f.mesh.visible = false
      }

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 1.3)
        phase += dt * 60
        shakeVec.set(
          Math.sin(phase * 2.7) * shake,
          Math.cos(phase * 3.4) * shake * 0.75,
          Math.sin(phase * 1.9) * shake * 0.45,
        )
      } else {
        shakeVec.set(0, 0, 0)
      }

      impactLevel = Math.max(0, impactLevel - dt * 3.2)
      flashLevel = Math.max(0, flashLevel - dt * 4.5)
    },

    shakeOffset() { return shakeVec },
    impact() { return impactLevel },
    flash() { return flashLevel },
    flashColor() { return flashHex },
  }
}
