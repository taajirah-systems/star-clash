/**
 * Stage construction: floor, holo-grid, walls, breakables, sky, lighting.
 *
 * A fighting stage has one job beyond looking good — it must never compete
 * with the fighters. So the detail here is deliberately pushed to the edges
 * and the distance: a deep starfield, low rails, light strips along the side
 * walls, and a floor dark enough that a rim-lit silhouette pops off it.
 */

import * as THREE from 'three'
import type { ArenaDef } from '../core/defs'
import { fxToFloat } from '../core/fx'
import { toonMaterial, withOutline, glowMaterial } from './toon'

export interface ArenaView {
  group: THREE.Group
  breakables: THREE.Object3D[]
  update(integrity: readonly number[], time: number): void
}

/** Deterministic scatter so the starfield is identical on every machine. */
function makeRng(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 0xffffffff
  }
}

/** A soft round dot. Point sprites are square by default, which reads as grit. */
function starTexture(): THREE.Texture {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

function buildStarfield(rng: () => number, count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const tint = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // Shell, not a cube — a cube's corners read as denser patches of sky.
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const r = 60 + rng() * 40
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r
    positions[i * 3 + 1] = Math.abs(Math.cos(phi)) * r * 0.7 + 4
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r

    // Most stars near-white, a few blue and amber, so the sky has temperature.
    const pick = rng()
    if (pick > 0.92) tint.setHSL(0.09, 0.7, 0.72)
    else if (pick > 0.78) tint.setHSL(0.58, 0.6, 0.76)
    else tint.setHSL(0.6, 0.12, 0.72 + rng() * 0.28)
    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
    sizes[i] = 0.25 + rng() * 0.75
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  const mat = new THREE.PointsMaterial({
    size: 0.9,
    map: starTexture(),
    alphaTest: 0.01,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geo, mat)
  // Fog would eat the sky, and the sky is the only thing giving the stage
  // depth beyond the rails.
  points.material.fog = false
  return points
}

/** Soft coloured cloud behind the action, built from a few big additive discs. */
function buildNebula(rng: () => number, color: number): THREE.Group {
  const g = new THREE.Group()
  for (let i = 0; i < 5; i++) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(14 + rng() * 16, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.018 + rng() * 0.022,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    )
    disc.position.set((rng() - 0.5) * 70, 10 + rng() * 26, -56 - rng() * 26)
    g.add(disc)
  }
  return g
}

export function buildArena(def: ArenaDef): ArenaView {
  const group = new THREE.Group()
  const hw = fxToFloat(def.halfWidth)
  const hd = fxToFloat(def.halfDepth)
  const rng = makeRng(0x5eed1234)

  /* ---- Sky ---- */
  group.add(buildStarfield(rng, 1400))
  group.add(buildNebula(rng, def.gridColor))

  /* ---- Floor ---- */
  const floorMat = toonMaterial(def.floorColor, { rimColor: def.gridColor, rimStrength: 0.25 })
  const floor = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.4, 0.35, hd * 2 + 1.4), floorMat)
  floor.position.y = -0.175
  floor.receiveShadow = true
  group.add(floor)

  // Inset deck panel: a second, slightly brighter plate gives the floor an
  // edge to catch light instead of reading as one flat slab.
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(hw * 2 - 0.3, 0.06, hd * 2 - 0.3),
    toonMaterial(def.floorColor, { rimColor: def.gridColor, rimStrength: 0.5, emissive: def.floorColor, emissiveIntensity: 0.10 }),
  )
  deck.position.y = 0.01
  deck.receiveShadow = true
  group.add(deck)

  const grid = new THREE.GridHelper(Math.max(hw, hd) * 2, 26, def.gridColor, def.gridColor)
  const gridMat = grid.material as THREE.Material
  gridMat.opacity = 0.20
  gridMat.transparent = true
  grid.position.y = 0.05
  group.add(grid)

  // Centre marking — gives the eye a reference for how far the fighters have
  // been pushed, which is otherwise surprisingly hard to judge.
  const centre = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.56, 48), glowMaterial(def.gridColor, 0.30))
  centre.rotation.x = -Math.PI / 2
  centre.position.y = 0.055
  group.add(centre)

  /* ---- Side walls (the wall-splat boundaries) ---- */
  const wallMat = toonMaterial(0x15203a, { rimColor: def.gridColor, rimStrength: 0.8 })
  const strips: THREE.Mesh[] = []
  for (const x of [hw, -hw]) {
    const rail = withOutline(new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.05, hd * 2), wallMat), 0.03)
    rail.position.set(x, 0.52, 0)
    rail.castShadow = true
    rail.receiveShadow = true
    group.add(rail)

    // Light strip along the top of each wall — reads the boundary at a glance
    // and gives the bloom pass something to bite on.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, hd * 2 - 0.2), glowMaterial(def.gridColor, 0.85))
    strip.position.set(x, 1.06, 0)
    group.add(strip)
    strips.push(strip)

    // Support ribs, for a bit of architecture rather than a bare slab.
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.16), wallMat)
      rib.position.set(x, 0.42, (i * hd) / 2.4)
      group.add(rib)
    }
  }

  // Depth edges get a flush floor stripe instead of a wall, so the sidestep
  // limit is legible without anything standing between camera and fight.
  for (const z of [hd, -hd]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.14), glowMaterial(def.gridColor, 0.4))
    stripe.rotation.x = -Math.PI / 2
    stripe.position.set(0, 0.06, z)
    group.add(stripe)
  }

  /* ---- Breakable consoles ---- */
  const breakables: THREE.Object3D[] = def.breakables.map((b) => {
    const console3d = new THREE.Group()
    const HEIGHT = 0.55
    const body = withOutline(
      new THREE.Mesh(
        new THREE.BoxGeometry(fxToFloat(b.hw) * 2, HEIGHT, fxToFloat(b.hd) * 2),
        toonMaterial(0x24344f, { rimColor: def.gridColor, rimStrength: 0.7 }),
      ),
      0.03,
    )
    body.position.y = HEIGHT / 2
    body.castShadow = true
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(fxToFloat(b.hw) * 1.7, 0.07, fxToFloat(b.hd) * 1.7),
      glowMaterial(def.gridColor, 0.8),
    )
    panel.position.y = HEIGHT + 0.03
    console3d.add(body, panel)
    console3d.position.set(fxToFloat(b.x), 0, fxToFloat(b.z))
    group.add(console3d)
    return console3d
  })

  /* ---- Lighting ---- */
  // Three-point: a warm key, a cold rim from behind, and a dim hemisphere so
  // the shadow side is readable rather than black.
  const key = new THREE.DirectionalLight(0xfff0dd, 2.8)
  key.position.set(5, 11, 7)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = -12
  key.shadow.camera.right = 12
  key.shadow.camera.top = 12
  key.shadow.camera.bottom = -12
  key.shadow.camera.far = 40
  key.shadow.bias = -0.0015
  group.add(key)

  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.0)
  rim.position.set(-7, 5, -8)
  group.add(rim)

  const fill = new THREE.HemisphereLight(0x8fb4ff, 0x080c14, 0.30)
  group.add(fill)

  // Floor bounce under the action, so fighters are not silhouetted into mush
  // when they stand still.
  const bounce = new THREE.PointLight(def.gridColor, 4.5, 14, 2)
  bounce.position.set(0, 0.4, 0)
  group.add(bounce)

  return {
    group,
    breakables,
    update(integrity, time) {
      breakables.forEach((obj, i) => {
        const hp = integrity[i] ?? 100
        obj.visible = hp > 0
        const damaged = hp > 0 && hp < 100
        obj.rotation.z = damaged ? 0.1 : 0
        obj.position.y = damaged ? -0.1 : 0
      })
      // Slow pulse on the boundary strips; enough motion to keep the stage
      // alive, not enough to pull the eye off the fighters.
      const pulse = 0.72 + 0.16 * Math.sin(time * 1.1)
      for (const strip of strips) {
        ;(strip.material as THREE.MeshBasicMaterial).opacity = pulse
      }
    },
  }
}
