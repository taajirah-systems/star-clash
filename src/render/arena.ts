/**
 * Arena scenery: floor, holo-grid, boundary walls, breakable consoles, lights.
 */

import * as THREE from 'three'
import type { ArenaDef } from '../core/defs'
import { fxToFloat } from '../core/fx'
import { toonMaterial, withOutline } from './toon'

export interface ArenaView {
  group: THREE.Group
  /** One per breakable, in the arena's declared order. */
  breakables: THREE.Object3D[]
  update(integrity: readonly number[]): void
}

export function buildArena(def: ArenaDef): ArenaView {
  const group = new THREE.Group()
  const hw = fxToFloat(def.halfWidth)
  const hd = fxToFloat(def.halfDepth)

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(hw * 2 + 1.2, 0.3, hd * 2 + 1.2),
    toonMaterial(def.floorColor),
  )
  floor.position.y = -0.15
  floor.receiveShadow = true
  group.add(floor)

  const grid = new THREE.GridHelper(Math.max(hw, hd) * 2, 24, def.gridColor, def.gridColor)
  const gridMat = grid.material as THREE.Material
  gridMat.opacity = 0.28
  gridMat.transparent = true
  grid.position.y = 0.012
  group.add(grid)

  // Only the left and right walls are built. The camera orbits to sit
  // perpendicular to the line between the fighters, which puts it on the Z
  // axis — so a rail along Z would spend most of the match filling the bottom
  // of the screen. The X walls are also the ones that matter to a player,
  // since those are where a wall-splat can happen.
  const railMat = toonMaterial(def.gridColor, def.gridColor)
  for (const x of [hw, -hw]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, hd * 2), railMat)
    rail.position.set(x, 0.45, 0)
    group.add(rail)
  }

  // The depth edges are marked with a flush floor stripe instead of a wall, so
  // the sidestep limit stays legible without blocking the view.
  const stripeMat = new THREE.MeshBasicMaterial({ color: def.gridColor, transparent: true, opacity: 0.45 })
  for (const z of [hd, -hd]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.12), stripeMat)
    stripe.rotation.x = -Math.PI / 2
    stripe.position.set(0, 0.014, z)
    group.add(stripe)
  }

  const breakables: THREE.Object3D[] = def.breakables.map((b) => {
    const console3d = new THREE.Group()
    const body = withOutline(
      new THREE.Mesh(
        new THREE.BoxGeometry(fxToFloat(b.hw) * 2, 0.95, fxToFloat(b.hd) * 2),
        toonMaterial(0x24344f),
      ),
    )
    body.position.y = 0.475
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(fxToFloat(b.hw) * 1.7, 0.1, fxToFloat(b.hd) * 1.7),
      toonMaterial(def.gridColor, def.gridColor),
    )
    panel.position.y = 0.98
    console3d.add(body, panel)
    console3d.position.set(fxToFloat(b.x), 0, fxToFloat(b.z))
    group.add(console3d)
    return console3d
  })

  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(4, 9, 5)
  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.1)
  rim.position.set(-6, 4, -6)
  const fill = new THREE.HemisphereLight(0x9fc4ff, 0x0a0f1a, 0.7)
  group.add(key, rim, fill)

  return {
    group,
    breakables,
    update(integrity) {
      breakables.forEach((obj, i) => {
        const hp = integrity[i] ?? 100
        // A shattered console drops out of the scene rather than vanishing, so
        // the break reads as an event and not as a pop-out.
        obj.visible = hp > 0
        const damaged = hp > 0 && hp < 100
        obj.rotation.z = damaged ? 0.08 : 0
        obj.position.y = damaged ? -0.08 : 0
      })
    },
  }
}
