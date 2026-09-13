/**
 * Cel-shading helpers.
 *
 * three.js ships MeshToonMaterial, which handles the banded diffuse ramp. What
 * it does not give you is the ink outline that makes cel-shading read as cel
 * -shading, so that is done with the classic inverted-hull trick: a slightly
 * inflated copy of the mesh rendered back-faces-only in black, sitting behind
 * the real one.
 */

import * as THREE from 'three'

let gradient: THREE.DataTexture | null = null

/** A hard 4-step ramp. Nearest filtering is what keeps the bands crisp. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const steps = new Uint8Array([60, 130, 200, 255])
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  gradient = tex
  return tex
}

export function toonMaterial(color: number, emissive = 0x000000): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive,
    emissiveIntensity: 0.6,
  })
}

const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x05070c,
  side: THREE.BackSide,
})

/**
 * Wraps a mesh in its own outline. The outline is a child of the mesh, so it
 * inherits every transform automatically and cannot drift out of register.
 */
export function withOutline(mesh: THREE.Mesh, thickness = 0.035): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, OUTLINE_MATERIAL)
  // Scale is relative to the part's own size, so thin limbs get a thin line
  // and the torso does not end up wearing a halo.
  mesh.geometry.computeBoundingSphere()
  const r = mesh.geometry.boundingSphere?.radius ?? 1
  const s = 1 + thickness / Math.max(r, 0.08)
  outline.scale.setScalar(s)
  outline.renderOrder = -1
  mesh.add(outline)
  return mesh
}

export function glowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
}
