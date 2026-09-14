/**
 * Post-processing chain.
 *
 * Bloom is doing most of the work: every emissive in the scene — rim lights,
 * wall strips, visors, energy trails, hit sparks — only reads as *light*
 * rather than as bright paint once it blooms. A vignette and a subtle
 * chromatic split finish the frame and give impacts somewhere to push.
 *
 * The whole chain degrades to a plain render if the context cannot support it,
 * because a missing effect should never mean a black screen.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * Vignette plus a radial chromatic split. The split is driven per-frame by
 * impact strength, so a counter-hit visibly tears the edges of the frame.
 */
const ImpactShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAberration: { value: 0 },
    uVignette: { value: 0.82 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(0xffffff) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    varying vec2 vUv;

    void main() {
      vec2 centred = vUv - 0.5;
      float dist = length(centred);

      // Split the channels along the radius, strongest at the edges, so the
      // centre of the action stays readable even at full strength.
      vec2 offset = centred * uAberration * dist;
      vec4 c;
      c.r = texture2D(tDiffuse, vUv + offset).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - offset).b;
      c.a = 1.0;

      float vig = smoothstep(0.95, uVignette * 0.42, dist);
      c.rgb *= mix(0.55, 1.0, vig);
      c.rgb += uFlashColor * uFlash;

      gl_FragColor = c;
    }
  `,
}

export interface PostChain {
  composer: EffectComposer
  setSize(w: number, h: number, pixelRatio: number): void
  /** 0..1 — drives chromatic aberration for one frame. */
  setImpact(v: number): void
  /** 0..1 — full-screen flash, for KOs and burst activations. */
  setFlash(v: number, color?: number): void
  render(): void
  dispose(): void
}

export function buildPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostChain | null {
  try {
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))

    const size = renderer.getSize(new THREE.Vector2())
    // Low strength, high threshold: bloom belongs on emissives — visors, energy,
    // sparks, wall strips — not on every lit surface in the scene.
    const bloom = new UnrealBloomPass(size, 0.42, 0.55, 0.82)
    composer.addPass(bloom)

    const impact = new ShaderPass(ImpactShader)
    composer.addPass(impact)
    // Grabbed once: ShaderPass types the uniform map loosely, and reaching
    // through it every frame costs an optional-chain per write.
    const u = impact.uniforms as unknown as typeof ImpactShader.uniforms
    composer.addPass(new OutputPass())

    const flashColor = new THREE.Color()

    return {
      composer,
      setSize(w, h, pixelRatio) {
        composer.setPixelRatio(pixelRatio)
        composer.setSize(w, h)
        bloom.setSize(w, h)
      },
      setImpact(v) {
        u.uAberration.value = v * 0.014
      },
      setFlash(v, color = 0xffffff) {
        u.uFlash.value = v
        flashColor.setHex(color)
        u.uFlashColor.value = flashColor
      },
      render() {
        composer.render()
      },
      dispose() {
        composer.dispose()
      },
    }
  } catch {
    // No composer is survivable; a black screen is not.
    return null
  }
}
