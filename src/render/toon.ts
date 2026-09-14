/**
 * Cel-shading.
 *
 * three.js ships MeshToonMaterial, which handles the banded diffuse ramp. Two
 * things it does not give you are what actually make a cel-shaded figure read
 * on a dark stage: an ink outline, and a rim light along the silhouette edge.
 * Both are added here.
 */

import * as THREE from 'three'

let gradient: THREE.DataTexture | null = null

/**
 * A hard 4-step ramp with a deliberately dark first band, so the shadow side
 * of a fighter separates from the lit side rather than washing into it.
 * Nearest filtering is what keeps the bands crisp instead of gradients.
 */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const steps = new Uint8Array([26, 92, 178, 255])
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  gradient = tex
  return tex
}

export interface ToonOptions {
  /** Colour of the fresnel edge light. */
  rimColor?: number
  /** 0 disables the rim. Around 0.6-1.0 reads well on a dark stage. */
  rimStrength?: number
  /** Higher is a tighter band hugging the silhouette. */
  rimPower?: number
  emissive?: number
  emissiveIntensity?: number
}

/**
 * Every rim-lit material made this frame, so the rim can be driven at runtime
 * (a fighter flashes on impact, pulses while a burst is active).
 */
const rimUniforms: { value: number }[] = []

/**
 * Toon material with a fresnel rim injected into the shader.
 *
 * The rim is what separates a dark fighter from a dark background without
 * having to light the whole stage flat. It is done through onBeforeCompile
 * rather than a custom ShaderMaterial so the material keeps three.js lighting,
 * fog, and shadows for free.
 */
export function toonMaterial(color: number, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const {
    rimColor = 0x9fd8ff,
    // Deliberately restrained. A strong rim on a tight power reads as an edge
    // light; a strong rim on a loose power just tints the whole surface, and
    // with bloom on top it washes every fighter to pale grey.
    rimStrength = 0.30,
    rimPower = 4.0,
    emissive = 0x000000,
    emissiveIntensity = 0.45,
  } = opts

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    emissive,
    emissiveIntensity,
  })

  const strength = { value: rimStrength }
  rimUniforms.push(strength)

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(rimColor) }
    shader.uniforms.uRimStrength = strength
    shader.uniforms.uRimPower = { value: rimPower }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRimNormal;\nvarying vec3 vRimView;')
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
         vRimNormal = normalize(normalMatrix * objectNormal);
         vRimView = normalize(-(modelViewMatrix * vec4(transformed, 1.0)).xyz);`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vRimNormal;
         varying vec3 vRimView;
         uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uRimPower;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float rim = 1.0 - clamp(dot(normalize(vRimNormal), normalize(vRimView)), 0.0, 1.0);
         rim = pow(rim, uRimPower);
         gl_FragColor.rgb += uRimColor * rim * uRimStrength;`,
      )
  }

  return mat
}

const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x04060b,
  side: THREE.BackSide,
})

/**
 * Wraps a mesh in its own outline via the inverted-hull trick: a slightly
 * inflated copy rendered back-faces-only in near-black.
 *
 * The outline is a child of the mesh, so it inherits every transform and
 * cannot drift out of register. Thickness is relative to the part's own size,
 * so a thin finger gets a thin line and the torso does not wear a halo.
 */
export function withOutline(mesh: THREE.Mesh, thickness = 0.03): THREE.Mesh {
  const outline = new THREE.Mesh(mesh.geometry, OUTLINE_MATERIAL)
  mesh.geometry.computeBoundingSphere()
  const r = mesh.geometry.boundingSphere?.radius ?? 1
  outline.scale.setScalar(1 + thickness / Math.max(r, 0.07))
  outline.renderOrder = -1
  outline.castShadow = false
  mesh.add(outline)
  return mesh
}

/** Unlit, additive material for energy — trails, projectiles, sparks. */
export function glowMaterial(color: number, opacity = 0.9): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
}
