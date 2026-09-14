/**
 * Fighter rig and posing.
 *
 * Still built from primitives — there is no art pipeline here — but composed
 * into an actual character rather than a capsule: two-segment limbs with real
 * elbows and knees, armour, a helm, a coat, and a weapon where the character
 * carries one.
 *
 * Poses are driven straight from the sim's state and move progress rather than
 * from animation clips, so a change to frame data is visible immediately and
 * the silhouette can never disagree with the hitboxes. What the clips would
 * normally buy you — anticipation, snap, follow-through — is done here with
 * easing curves over the move's own startup / active / recovery split.
 */

import * as THREE from 'three'
import type { CharacterDef, MoveDef } from '../core/defs'
import { Guard } from '../core/defs'
import { St, SF, has } from '../core/fsm'
import { fxToFloat } from '../core/fx'
import { toonMaterial, withOutline, glowMaterial } from './toon'
import { silhouetteFor, type Silhouette } from './silhouette'

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
  /** 0..1 white flash on impact. */
  setFlash(v: number): void
  /** World-space tip of the striking limb, for trail rendering. */
  strikeTip(out: THREE.Vector3): THREE.Vector3
  dispose(): void
}

interface Joint {
  pivot: THREE.Group
  /** Child joint, for two-segment limbs. */
  lower?: THREE.Group
  tip?: THREE.Object3D
}

interface Rig {
  root: THREE.Group
  body: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  head: THREE.Group
  armL: Joint
  armR: Joint
  legL: Joint
  legR: Joint
  aura: THREE.Mesh
  shield: THREE.Mesh
  weapon: THREE.Object3D | null
  flashTargets: THREE.MeshToonMaterial[]
}

/* ------------------------------------------------------------------ */
/* Construction                                                         */
/* ------------------------------------------------------------------ */

function segment(
  length: number,
  rTop: number,
  rBottom: number,
  color: number,
  rim: number,
  out: THREE.MeshToonMaterial[],
): { pivot: THREE.Group; end: THREE.Object3D; mesh: THREE.Mesh } {
  const pivot = new THREE.Group()
  const mat = toonMaterial(color, { rimColor: rim, rimStrength: 0.34 })
  out.push(mat)
  // Tapered: limbs that narrow toward the joint read as limbs rather than
  // as tubes, which is most of the difference between a figure and a doll.
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, 10, 1)
  const mesh = withOutline(new THREE.Mesh(geo, mat), 0.02)
  mesh.castShadow = true
  mesh.position.y = -length / 2
  pivot.add(mesh)

  // Joint cap, so a bent elbow does not show a seam.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(rBottom * 1.02, 10, 8), mat)
  cap.position.y = -length
  pivot.add(cap)

  const end = new THREE.Object3D()
  end.position.y = -length
  pivot.add(end)
  return { pivot, end, mesh }
}

function buildLimb(
  upperLen: number,
  lowerLen: number,
  rTop: number,
  rMid: number,
  rEnd: number,
  color: number,
  rim: number,
  out: THREE.MeshToonMaterial[],
): Joint {
  const upper = segment(upperLen, rTop, rMid, color, rim, out)
  const lower = segment(lowerLen, rMid, rEnd, color, rim, out)
  upper.end.add(lower.pivot)
  return { pivot: upper.pivot, lower: lower.pivot, tip: lower.end }
}

export function buildFighter(def: CharacterDef): FighterView {
  const s = silhouetteFor(def.id)
  const h = fxToFloat(def.height)
  const flash: THREE.MeshToonMaterial[] = []

  const hipY = h * 0.50
  const shoulderY = h * 0.80
  const armUpper = h * 0.20
  const armLower = h * 0.19
  const legUpper = h * 0.26
  const legLower = h * 0.25

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const hips = new THREE.Group()
  hips.position.y = hipY
  body.add(hips)

  const spine = new THREE.Group()
  hips.add(spine)

  const bodyMat = toonMaterial(def.color, { rimColor: def.accent, rimStrength: 0.42 })
  const trimMat = toonMaterial(def.accent, { rimColor: def.accent, rimStrength: 0.50, emissive: def.accent, emissiveIntensity: 0.18 })
  const darkMat = toonMaterial(0x141b28, { rimColor: def.accent, rimStrength: 0.35 })
  flash.push(bodyMat, trimMat, darkMat)

  /* Torso: a tapered box reads as a chest far better than a capsule. */
  const torsoW = h * 0.30 * s.bulk
  const torsoD = h * 0.19 * s.bulk
  const torsoH = shoulderY - hipY
  const torso = withOutline(
    new THREE.Mesh(new THREE.CylinderGeometry(torsoW * 0.44, torsoW * 0.36, torsoH, 8, 1), bodyMat),
    0.03,
  )
  torso.scale.z = (torsoD / torsoW) * 1.35
  torso.position.y = torsoH / 2
  torso.castShadow = true
  spine.add(torso)

  if (s.chestPlate) {
    const plate = withOutline(
      new THREE.Mesh(new THREE.CylinderGeometry(torsoW * 0.46, torsoW * 0.40, torsoH * 0.52, 8, 1), trimMat),
      0.025,
    )
    plate.scale.z = (torsoD / torsoW) * 1.2
    plate.position.set(h * 0.012, torsoH * 0.66, 0)
    spine.add(plate)
  }

  if (s.belt) {
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(torsoW * 0.40, torsoW * 0.40, h * 0.045, 8, 1), darkMat)
    belt.scale.z = (torsoD / torsoW) * 1.3
    belt.position.y = h * 0.02
    spine.add(belt)
  }

  /* Coat tails: cheap, and they carry a huge amount of motion. */
  const coatTails: THREE.Mesh[] = []
  if (s.coat > 0) {
    for (const zOff of [-torsoD * 0.30, 0, torsoD * 0.30]) {
      const tail = new THREE.Mesh(
        new THREE.BoxGeometry(h * 0.02, h * s.coat, torsoD * 0.34),
        bodyMat,
      )
      tail.position.set(-torsoW * 0.30, -h * s.coat * 0.5 + h * 0.03, zOff)
      spine.add(tail)
      coatTails.push(tail)
    }
  }

  /* Head, helm, visor. */
  const head = new THREE.Group()
  head.position.y = torsoH + h * 0.055
  spine.add(head)

  const skull = withOutline(new THREE.Mesh(new THREE.SphereGeometry(h * 0.085, 14, 12), bodyMat), 0.025)
  skull.scale.set(1.05, 1.12, 1)
  skull.castShadow = true
  head.add(skull)

  const jaw = new THREE.Mesh(new THREE.BoxGeometry(h * 0.10, h * 0.05, h * 0.11), darkMat)
  jaw.position.set(h * 0.02, -h * 0.055, 0)
  head.add(jaw)

  /*
   * Face.
   *
   * Every head gets a brow, a recessed face plate, and an eye band. Without
   * them a head is a sphere, and a sphere looks identical from the front and
   * the back — which made the select-screen previews read as facing away even
   * when they were measurably facing the camera. The eye band is the single
   * feature doing most of that work.
   */
  const faceMat = toonMaterial(0x0d1420, { rimColor: def.accent, rimStrength: 0.25 })
  flash.push(faceMat)

  const facePlate = new THREE.Mesh(new THREE.BoxGeometry(h * 0.028, h * 0.075, h * 0.125), faceMat)
  facePlate.position.set(h * 0.068, -h * 0.004, 0)
  head.add(facePlate)

  const brow = new THREE.Mesh(new THREE.BoxGeometry(h * 0.045, h * 0.022, h * 0.145), bodyMat)
  brow.position.set(h * 0.060, h * 0.036, 0)
  head.add(brow)

  // Eye band: emissive on everyone, brighter on the characters whose spec asks
  // for a full visor.
  const eyeGlow = s.visor ? 1.0 : 0.62
  const eyes = new THREE.Mesh(
    new THREE.BoxGeometry(h * 0.018, h * 0.020, h * 0.115),
    glowMaterial(def.accent, eyeGlow),
  )
  eyes.position.set(h * 0.082, h * 0.012, 0)
  head.add(eyes)

  // Cheek struts, so the face plate has structure rather than floating.
  for (const z of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(h * 0.030, h * 0.055, h * 0.016), darkMat)
    strut.position.set(h * 0.055, -h * 0.010, z * h * 0.058)
    head.add(strut)
  }

  switch (s.helm) {
    case 'crest': {
      const crest = new THREE.Mesh(new THREE.BoxGeometry(h * 0.16, h * 0.045, h * 0.018), trimMat)
      crest.position.y = h * 0.085
      head.add(crest)
      break
    }
    case 'horned': {
      for (const z of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(h * 0.022, h * 0.16, 6), trimMat)
        horn.position.set(-h * 0.01, h * 0.055, z * h * 0.075)
        horn.rotation.x = z * -0.5
        horn.rotation.z = 0.35
        head.add(horn)
      }
      break
    }
    case 'hood': {
      // Open at the front. A full dome reads as a featureless black ball and
      // loses the visor, which is the character's whole tell.
      const hood = withOutline(
        new THREE.Mesh(
          new THREE.SphereGeometry(h * 0.108, 14, 10, Math.PI * 0.35, Math.PI * 1.3, 0, Math.PI * 0.58),
          darkMat,
        ),
        0.025,
      )
      hood.position.y = h * 0.016
      hood.rotation.z = -0.14
      head.add(hood)
      // Cowl at the back of the neck, so the hood has somewhere to sit.
      const cowl = new THREE.Mesh(new THREE.TorusGeometry(h * 0.075, h * 0.022, 6, 12), darkMat)
      cowl.rotation.x = Math.PI / 2
      cowl.position.set(-h * 0.02, -h * 0.05, 0)
      head.add(cowl)
      break
    }
    default: {
      // Swept: a low back-slanted crest, formal rather than martial.
      const swept = new THREE.Mesh(new THREE.BoxGeometry(h * 0.115, h * 0.028, h * 0.10), darkMat)
      swept.position.set(-h * 0.022, h * 0.068, 0)
      swept.rotation.z = 0.30
      head.add(swept)
    }
  }

  if (s.visor) {
    // Full wraparound band, on top of the eye slit every character gets.
    const band = new THREE.Mesh(new THREE.TorusGeometry(h * 0.088, h * 0.011, 6, 16, Math.PI), glowMaterial(def.accent, 0.8))
    band.rotation.y = Math.PI / 2
    band.rotation.z = -Math.PI / 2
    band.position.set(h * 0.012, h * 0.014, 0)
    head.add(band)
  }

  /* Arms. */
  const limbR = h * 0.050 * s.limb
  // Both arms in body colour. Colouring the lead arm with the accent made it
  // read as a separate object rather than as part of the fighter.
  const armL = buildLimb(armUpper, armLower, limbR, limbR * 0.86, limbR * 0.78, def.color, def.accent, flash)
  const armR = buildLimb(armUpper, armLower, limbR, limbR * 0.86, limbR * 0.78, def.color, def.accent, flash)
  armL.pivot.position.set(0, torsoH, -torsoW * 0.50)
  armR.pivot.position.set(0, torsoH, torsoW * 0.50)
  spine.add(armL.pivot, armR.pivot)

  if (s.pauldron > 0) {
    for (const [joint, z] of [[armL, -1], [armR, 1]] as const) {
      const pad = withOutline(
        new THREE.Mesh(new THREE.SphereGeometry(h * s.pauldron, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), trimMat),
        0.028,
      )
      pad.rotation.z = z * 0.22
      pad.position.y = h * 0.012
      joint.pivot.add(pad)
    }
  }

  // Hands, with an accent cuff so the striking limb still catches the eye.
  for (const joint of [armL, armR]) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(limbR * 1.8, limbR * 2.1, limbR * 1.6), darkMat)
    hand.position.y = -limbR * 0.7
    joint.tip?.add(hand)
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(limbR * 1.05, limbR * 1.05, limbR * 0.7, 8), trimMat)
    cuff.position.y = limbR * 0.15
    joint.tip?.add(cuff)
  }

  /* Legs. */
  const legR0 = h * 0.062 * s.limb
  const legL = buildLimb(legUpper, legLower, legR0, legR0 * 0.82, legR0 * 0.70, def.color, def.accent, flash)
  const legR = buildLimb(legUpper, legLower, legR0, legR0 * 0.82, legR0 * 0.70, def.color, def.accent, flash)
  legL.pivot.position.set(0, 0, -torsoW * 0.26)
  legR.pivot.position.set(0, 0, torsoW * 0.26)
  hips.add(legL.pivot, legR.pivot)

  for (const joint of [legL, legR]) {
    const boot = withOutline(
      new THREE.Mesh(new THREE.BoxGeometry(legR0 * 3.0, legR0 * 1.5, legR0 * 1.9), darkMat),
      0.022,
    )
    boot.position.set(legR0 * 0.5, -legR0 * 0.6, 0)
    boot.castShadow = true
    joint.tip?.add(boot)
  }

  /* Weapon. */
  let weapon: THREE.Object3D | null = null
  if (s.weapon === 'glaive') {
    weapon = new THREE.Group()
    const shaft = withOutline(
      new THREE.Mesh(new THREE.CylinderGeometry(h * 0.015, h * 0.015, h * 0.92, 8), darkMat),
      0.02,
    )
    weapon.add(shaft)
    for (const dir of [1, -1]) {
      const blade = withOutline(
        new THREE.Mesh(new THREE.ConeGeometry(h * 0.048, h * 0.24, 4), trimMat),
        0.025,
      )
      blade.position.y = dir * h * 0.49
      blade.rotation.z = Math.PI / 4
      if (dir < 0) blade.rotation.x = Math.PI
      weapon.add(blade)
    }
    weapon.rotation.x = Math.PI / 2
    weapon.position.set(0, -h * 0.02, 0)
    armR.tip?.add(weapon)
  } else if (s.weapon === 'gauntlet') {
    weapon = new THREE.Group()
    const casing = withOutline(
      new THREE.Mesh(new THREE.CylinderGeometry(h * 0.075, h * 0.055, h * 0.26, 8), darkMat),
      0.028,
    )
    casing.position.y = -h * 0.02
    weapon.add(casing)
    const emitter = new THREE.Mesh(new THREE.TorusGeometry(h * 0.05, h * 0.012, 8, 14), glowMaterial(def.accent, 0.95))
    emitter.position.y = -h * 0.13
    emitter.rotation.x = Math.PI / 2
    weapon.add(emitter)
    armR.tip?.add(weapon)
  }

  /* Contact shadow.
   *
   * A blob rather than a shadow-mapped one. In a fighting game the shadow is
   * read as information — how high is that juggle, is this cross-up in front
   * of me or behind — so it needs to be crisp and always visible, which a
   * soft mapped shadow at this camera distance is not.
   */
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(h * 0.30, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }),
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = 0.035
  blob.renderOrder = -2
  root.add(blob)

  /* Ground ring and shield bubble. */
  const aura = new THREE.Mesh(
    new THREE.RingGeometry(h * 0.26, h * 0.40, 32),
    glowMaterial(def.accent, 0),
  )
  aura.rotation.x = -Math.PI / 2
  aura.position.y = 0.02
  root.add(aura)

  const shield = new THREE.Mesh(
    new THREE.IcosahedronGeometry(h * 0.58, 1),
    new THREE.MeshBasicMaterial({
      color: def.accent, wireframe: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  shield.position.y = h * 0.55
  root.add(shield)

  const rig: Rig = {
    root, body, hips, spine, head,
    armL, armR, legL, legR,
    aura, shield, weapon, flashTargets: flash,
  }

  const tipWorld = new THREE.Vector3()

  return {
    group: root,

    setPose(state, stateFrame, move, moveFrame, payloadActive, shieldActive) {
      pose(rig, def, s, h, state, stateFrame, move, moveFrame)

      // The blob stays on the floor while the fighter leaves it, shrinking and
      // fading with altitude. It is parented to the root, so cancelling the
      // root's own height is what pins it to the ground; the altitude that
      // matters is the fighter's world y, not the pose offset.
      const altitude = Math.max(0, root.position.y)
      const k = Math.max(0, 1 - altitude / (h * 1.1))
      blob.position.y = 0.035 - root.position.y
      blob.scale.setScalar(0.55 + k * 0.5)
      ;(blob.material as THREE.MeshBasicMaterial).opacity = 0.10 + k * 0.34

      const auraMat = rig.aura.material as THREE.MeshBasicMaterial
      auraMat.opacity = payloadActive ? 0.42 + 0.22 * Math.sin(stateFrame * 0.22) : 0
      rig.aura.scale.setScalar(payloadActive ? 1 + 0.06 * Math.sin(stateFrame * 0.18) : 1)

      const shieldMat = rig.shield.material as THREE.MeshBasicMaterial
      shieldMat.opacity = shieldActive ? 0.26 + 0.10 * Math.sin(stateFrame * 0.2) : 0
      if (shieldActive) rig.shield.rotation.y += 0.02

      for (const tail of coatTails) {
        // Coat trails the body's motion by a frame's worth of lean.
        tail.rotation.z = -rig.body.rotation.y * 0.5 - 0.10 - rig.body.position.x * 1.2
      }
    },

    setFlash(v) {
      // Deliberately capped well below white. Driving emissive to 1.0 erased
      // the character entirely — a hit should read as a flash on the fighter,
      // not replace them with a silhouette-shaped light.
      const k = v * 0.42
      for (const mat of rig.flashTargets) {
        mat.emissive.setRGB(k, k * 0.92, k * 0.80)
        mat.emissiveIntensity = v > 0 ? 1 : 0.45
      }
    },

    strikeTip(out) {
      const src = rig.armR.tip ?? rig.armR.pivot
      // The pose was applied this frame but three.js only refreshes world
      // matrices inside render(), so reading the world position here without
      // forcing an update returns the PREVIOUS frame's transform — which put
      // the trail's samples somewhere near the shoulder instead of the hand
      // and turned the ribbon into disconnected slivers.
      src.updateWorldMatrix(true, false)
      src.getWorldPosition(tipWorld)
      return out.copy(tipWorld)
    },

    dispose() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
      })
    },
  }
}

/* ------------------------------------------------------------------ */
/* Posing                                                               */
/* ------------------------------------------------------------------ */

/** Fast out, slow in — the shape of a strike. */
function easeOutCubic(t: number): number {
  const c = 1 - t
  return 1 - c * c * c
}

/** Slow out, fast in — the shape of a wind-up. */
function easeInCubic(t: number): number {
  return t * t * t
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Where a move is in its own timeline, as three eased 0..1 values.
 *
 * Driving the pose off these rather than off raw frame counts is what gives
 * the animation anticipation and snap without any authored clips: the wind-up
 * eases in over startup, the strike eases out hard across the active frames,
 * and the recovery eases back.
 */
function phaseOf(move: MoveDef, frame: number): { wind: number; strike: number; settle: number } {
  const s = move.startup
  const a = move.active
  const r = Math.max(1, move.recovery)
  if (frame < s) return { wind: easeInCubic(clamp01(s === 0 ? 1 : frame / s)), strike: 0, settle: 0 }
  if (frame < s + a) return { wind: 1, strike: easeOutCubic(clamp01(a === 0 ? 1 : (frame - s) / a)), settle: 0 }
  return { wind: 1, strike: 1, settle: easeOutCubic(clamp01((frame - s - a) / r)) }
}

function resetPose(rig: Rig): void {
  rig.body.position.set(0, 0, 0)
  rig.body.rotation.set(0, 0, 0)
  rig.body.scale.set(1, 1, 1)
  rig.hips.rotation.set(0, 0, 0)
  rig.spine.rotation.set(0, 0, 0)
  rig.head.rotation.set(0, 0, 0)
  for (const j of [rig.armL, rig.armR, rig.legL, rig.legR]) {
    j.pivot.rotation.set(0, 0, 0)
    j.lower?.rotation.set(0, 0, 0)
  }
}

/** A limb's two joints in one call. Positive swings forward (+x). */
function setLimb(j: Joint, shoulder: number, elbow: number, spread = 0): void {
  j.pivot.rotation.z = shoulder
  j.pivot.rotation.x = spread
  if (j.lower) j.lower.rotation.z = elbow
}

function pose(
  rig: Rig,
  def: CharacterDef,
  s: Silhouette,
  h: number,
  state: St,
  stateFrame: number,
  move: MoveDef | null,
  moveFrame: number,
): void {
  resetPose(rig)
  const t = stateFrame

  if (has(state, SF.Attacking) && move) {
    poseAttack(rig, s, h, move, moveFrame)
    return
  }

  switch (state) {
    case St.Idle: {
      // A fighting stance, not a standing pose: bladed hips, guard up, weight
      // low. Breathing is a slow sine on the spine rather than the whole body,
      // so the feet stay planted.
      const breathe = Math.sin(t * 0.075)
      rig.body.position.y = breathe * 0.012
      rig.spine.rotation.y = -0.34
      rig.hips.rotation.y = -0.22
      setLimb(rig.armL, 0.62 + breathe * 0.05, -1.05, 0.16)
      setLimb(rig.armR, 0.40 + breathe * 0.05, -1.25, -0.20)
      setLimb(rig.legL, 0.24, -0.34)
      setLimb(rig.legR, -0.20, -0.26)
      rig.head.rotation.y = 0.26
      break
    }

    case St.WalkForward:
    case St.WalkBack: {
      const back = state === St.WalkBack
      const swing = Math.sin(t * 0.26) * (back ? 0.34 : 0.46)
      rig.spine.rotation.y = -0.30
      rig.body.position.y = Math.abs(Math.sin(t * 0.26)) * 0.02
      setLimb(rig.legL, swing, -Math.max(0, swing) * 0.9 - 0.12)
      setLimb(rig.legR, -swing, -Math.max(0, -swing) * 0.9 - 0.12)
      // Guard stays up while walking; only a slight counter-sway in the arms.
      setLimb(rig.armL, 0.60 - swing * 0.18, -1.02, 0.16)
      setLimb(rig.armR, 0.42 + swing * 0.18, -1.22, -0.20)
      break
    }

    case St.SidestepLeft:
    case St.SidestepRight: {
      const dir = state === St.SidestepLeft ? -1 : 1
      const k = Math.min(1, t / 6)
      rig.body.rotation.x = dir * 0.30 * k
      rig.body.position.z = dir * 0.05 * k
      setLimb(rig.legL, 0.18, -0.30, dir * 0.42 * k)
      setLimb(rig.legR, -0.18, -0.30, dir * 0.42 * k)
      setLimb(rig.armL, 0.55, -0.95, 0.30 * dir)
      setLimb(rig.armR, 0.40, -1.15, 0.30 * dir)
      break
    }

    case St.DashForward:
    case St.DashBack: {
      const fwd = state === St.DashForward ? 1 : -1
      const k = easeOutCubic(Math.min(1, t / 5))
      rig.body.rotation.y = -0.55 * fwd * k
      rig.body.position.y = -h * 0.05 * k
      rig.body.position.x = fwd * 0.07 * k
      rig.spine.rotation.z = fwd * 0.22 * k
      setLimb(rig.legL, 0.95 * fwd * k, -0.5)
      setLimb(rig.legR, -0.65 * fwd * k, -0.9)
      setLimb(rig.armL, -0.7 * fwd * k, -0.7)
      setLimb(rig.armR, 0.7 * fwd * k, -0.7)
      break
    }

    case St.Crouch:
    case St.GuardCrouch: {
      const deep = h * 0.20
      rig.body.position.y = -deep
      rig.spine.rotation.z = 0.24
      rig.spine.rotation.y = -0.38
      setLimb(rig.legL, 0.85, -1.55)
      setLimb(rig.legR, 0.55, -1.30)
      if (state === St.GuardCrouch) {
        setLimb(rig.armL, 1.35, -1.55, 0.20)
        setLimb(rig.armR, 1.15, -1.70, -0.18)
      } else {
        setLimb(rig.armL, 0.70, -1.10, 0.18)
        setLimb(rig.armR, 0.55, -1.30, -0.18)
      }
      break
    }

    case St.GuardStand:
    case St.BlockStun: {
      // Shoulders square to the incoming hit, arms crossed high, weight back.
      const shove = state === St.BlockStun ? easeOutCubic(Math.min(1, t / 4)) : 0
      rig.spine.rotation.y = -0.62
      rig.body.rotation.y = -0.18
      rig.body.position.x = -0.06 - shove * 0.09
      rig.body.position.y = -h * 0.02
      setLimb(rig.armL, 1.42, -1.75, 0.26)
      setLimb(rig.armR, 1.20, -1.95, -0.24)
      setLimb(rig.legL, 0.34, -0.42)
      setLimb(rig.legR, -0.30, -0.34)
      if (shove > 0) rig.head.rotation.z = -0.18 * shove
      break
    }

    case St.Parry: {
      // A deflection, not a block: one arm sweeps across, body opens.
      const k = easeOutCubic(Math.min(1, t / 4))
      rig.spine.rotation.y = -0.20 + 0.55 * k
      setLimb(rig.armR, 1.70 * k, -0.55, -0.85 * k)
      setLimb(rig.armL, 0.70, -1.30, 0.20)
      rig.body.rotation.y = 0.30 * k
      break
    }

    case St.MeterBurst: {
      const k = easeOutCubic(Math.min(1, t / 8))
      rig.body.position.y = h * 0.06 * k
      rig.spine.rotation.z = -0.35 * k
      setLimb(rig.armL, -1.9 * k, -0.35, 0.55 * k)
      setLimb(rig.armR, -1.9 * k, -0.35, -0.55 * k)
      setLimb(rig.legL, 0.30, -0.45)
      setLimb(rig.legR, -0.25, -0.40)
      rig.head.rotation.z = -0.30 * k
      break
    }

    case St.JumpRise:
    case St.AirRecovery: {
      const k = Math.min(1, t / 6)
      rig.spine.rotation.z = -0.18
      setLimb(rig.legL, 1.15 * k, -1.5 * k)
      setLimb(rig.legR, 0.55 * k, -1.0 * k)
      setLimb(rig.armL, -1.15 * k, -0.5)
      setLimb(rig.armR, -0.95 * k, -0.6)
      break
    }

    case St.JumpFall: {
      rig.spine.rotation.z = 0.14
      setLimb(rig.legL, 0.40, -0.55)
      setLimb(rig.legR, 0.10, -0.35)
      setLimb(rig.armL, -0.85, -0.45)
      setLimb(rig.armR, -0.70, -0.55)
      break
    }

    case St.HitStun:
    case St.Stagger: {
      // Snap back hard on frame one, then wobble — the recoil is the read.
      const k = easeOutCubic(Math.min(1, t / 3))
      const wobble = Math.sin(t * 0.9) * 0.05 * (1 - Math.min(1, t / 20))
      rig.body.rotation.y = (0.70 + wobble) * k
      rig.body.position.x = -0.17 * k
      rig.spine.rotation.z = -0.30 * k
      rig.head.rotation.z = -0.55 * k
      rig.head.rotation.y = 0.35 * k
      setLimb(rig.armL, -0.95 * k, -0.9, 0.5 * k)
      setLimb(rig.armR, -0.30 * k, -1.4, -0.4 * k)
      setLimb(rig.legL, -0.35 * k, -0.30)
      setLimb(rig.legR, 0.45 * k, -0.55)
      // Squash on the impact frames, easing out. Sells weight at no cost.
      const squash = 1 - 0.10 * (1 - Math.min(1, t / 5))
      rig.body.scale.set(1 / squash, squash, 1 / squash)
      break
    }

    case St.Paralyzed: {
      const jitter = Math.sin(t * 2.3) * 0.04
      rig.body.rotation.z = 0.10 + jitter
      rig.spine.rotation.y = -0.2
      setLimb(rig.armL, 0.18 + jitter, -0.35)
      setLimb(rig.armR, -0.14 - jitter, -0.30)
      rig.head.rotation.z = 0.32
      break
    }

    case St.Juggle: {
      const spin = Math.min(1.5, t * 0.10)
      rig.body.rotation.z = spin
      rig.body.rotation.y = 0.5
      setLimb(rig.legL, 0.85, -0.7)
      setLimb(rig.legR, 0.35, -0.4)
      setLimb(rig.armL, -1.5, -0.6)
      setLimb(rig.armR, -1.1, -0.9)
      break
    }

    case St.Knockdown:
    case St.Defeated: {
      const k = easeOutCubic(Math.min(1, t / 8))
      rig.body.rotation.z = (Math.PI / 2) * k
      rig.body.position.y = -h * 0.40 * k
      rig.body.position.x = -h * 0.12 * k
      setLimb(rig.armL, -0.55, -0.35)
      setLimb(rig.armR, 0.35, -0.25)
      setLimb(rig.legL, 0.30, -0.55)
      setLimb(rig.legR, -0.15, -0.30)
      break
    }

    case St.Wakeup: {
      const k = 1 - easeOutCubic(Math.min(1, t / 16))
      rig.body.rotation.z = (Math.PI / 2) * k
      rig.body.position.y = -h * 0.40 * k
      setLimb(rig.legL, 0.70 * k + 0.2, -0.9 * k - 0.2)
      setLimb(rig.armL, 0.5, -0.9)
      setLimb(rig.armR, 0.4, -1.1)
      break
    }

    default:
      break
  }

  void def
}

/**
 * Attack posing.
 *
 * Every attack gets the same three-beat shape — coil away, snap through,
 * settle back — scaled by the move's own frame data. A 7-frame jab barely
 * coils; an 18-frame heavy winds up visibly, which is exactly the tell a
 * player needs in order to react to it.
 */
function poseAttack(rig: Rig, s: Silhouette, h: number, move: MoveDef, frame: number): void {
  const { wind, strike, settle } = phaseOf(move, frame)
  // Net extension: negative while coiling, 1 at full reach, easing back after.
  const ext = strike > 0 ? strike * (1 - settle * 0.85) : -0.30 * wind
  const coil = wind * (1 - strike)

  const low = move.guard === Guard.Low
  const high = move.guard === Guard.High
  const grab = move.reaction === 4 /* Reaction.Paralyze */ || move.guard === Guard.Command

  // Hips and spine lead the strike — rotation through the body is what makes
  // a punch look thrown rather than poked.
  rig.hips.rotation.y = -0.30 + 0.55 * ext
  rig.spine.rotation.y = -0.45 + 1.05 * ext - 0.25 * coil
  rig.body.position.x = 0.13 * Math.max(ext, 0)
  rig.body.position.y = -h * 0.02 * coil

  if (low) {
    // Drop into a sweep: body low, lead leg extended, trailing hand planted.
    rig.body.position.y = -h * (0.16 + 0.10 * Math.max(ext, 0))
    rig.spine.rotation.z = 0.30 + 0.22 * ext
    setLimb(rig.legR, 1.55 * ext + 0.35, -0.25 - 0.9 * coil)
    setLimb(rig.legL, 0.65, -1.45)
    setLimb(rig.armL, 1.20, -1.35, 0.25)
    setLimb(rig.armR, -0.45, -1.10, -0.2)
  } else if (high && !grab) {
    // Airborne kick: whole body commits, trailing leg tucked.
    rig.body.position.y = h * (0.10 + 0.14 * Math.max(ext, 0))
    rig.body.rotation.z = -0.55 * ext
    setLimb(rig.legR, 1.85 * ext + 0.25, -0.20 - 1.1 * coil)
    setLimb(rig.legL, -0.55, -1.55)
    setLimb(rig.armL, -1.0, -0.55, 0.35)
    setLimb(rig.armR, -0.75, -0.70, -0.35)
  } else if (grab) {
    // Both hands reach, palms forward, body upright and closing.
    setLimb(rig.armL, 1.55 * ext - 0.15 * coil, -0.35 - 0.9 * coil, 0.30 - 0.22 * ext)
    setLimb(rig.armR, 1.60 * ext - 0.15 * coil, -0.30 - 0.9 * coil, -0.30 + 0.22 * ext)
    setLimb(rig.legL, 0.40, -0.50)
    setLimb(rig.legR, -0.25, -0.35)
  } else if (s.weapon === 'glaive') {
    // Wide arc: the weapon carries the silhouette, so the arms stay wide and
    // the spine does the work.
    const arc = ext * Math.PI * 0.95
    setLimb(rig.armR, -0.75 + arc, -0.30 - 0.55 * coil, -0.25 + 0.30 * ext)
    setLimb(rig.armL, -0.30 + arc * 0.55, -0.85, 0.30)
    rig.spine.rotation.z = -0.18 * ext
    setLimb(rig.legL, 0.45 + 0.25 * ext, -0.50)
    setLimb(rig.legR, -0.35, -0.40)
  } else {
    // Straight lead: shoulder drives, elbow extends last.
    const elbow = -1.45 * (1 - Math.max(ext, 0)) - 0.15
    setLimb(rig.armR, 1.62 * ext - 0.30 * coil, elbow, -0.22 + 0.20 * ext)
    setLimb(rig.armL, 0.55 + 0.35 * coil, -1.30, 0.22)
    setLimb(rig.legL, 0.42 + 0.30 * ext, -0.48)
    setLimb(rig.legR, -0.30, -0.36)
    rig.spine.rotation.z = -0.10 * ext
  }

  rig.head.rotation.y = 0.30 - 0.22 * ext
  // A touch of stretch on the strike frames, the counterpart to the squash on
  // the receiving end.
  const stretch = 1 + 0.05 * Math.max(0, strike - settle)
  rig.body.scale.set(stretch, 1 / stretch, 1 / stretch)
}
