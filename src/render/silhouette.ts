/**
 * Per-character build specs for the fighter rig.
 *
 * Lives in the render layer, not in the roster data, because none of it
 * affects the simulation — two fighters with identical frame data and
 * different silhouettes play identically. Keeping it here means the sim and
 * its tests never have to know what a pauldron is.
 *
 * The point of the spec is readable silhouettes. In a fighting game you
 * identify the character and read their state from the outline alone, at
 * speed, often at the edge of your vision — so the shapes are deliberately
 * exaggerated and deliberately different from each other.
 */

export type Helm = 'swept' | 'crest' | 'horned' | 'hood'
export type Weapon = 'none' | 'glaive' | 'gauntlet'

export interface Silhouette {
  /** Torso width multiplier. Vorn is a wall; Echo is a blade. */
  bulk: number
  /** Shoulder armour radius, as a fraction of height. 0 for none. */
  pauldron: number
  /** Raised plate across the chest. */
  chestPlate: boolean
  helm: Helm
  /** Coat-tail length as a fraction of height. 0 for none. */
  coat: number
  weapon: Weapon
  /** Glowing visor band across the eyes. */
  visor: boolean
  /** Belt/waist block. */
  belt: boolean
  /** Limb thickness multiplier. */
  limb: number
}

const DEFAULT: Silhouette = {
  bulk: 1,
  pauldron: 0,
  chestPlate: false,
  helm: 'swept',
  coat: 0,
  weapon: 'none',
  visor: false,
  belt: true,
  limb: 1,
}

const BY_ID: Record<string, Partial<Silhouette>> = {
  // Tall, narrow, formal. A long coat is the read: this is the one who stands
  // still and waits for you.
  aurel: { bulk: 0.92, coat: 0.30, helm: 'swept', limb: 0.92, pauldron: 0.030 },

  // Athletic and front-heavy, epaulettes and a crest. Reads as forward motion
  // even when standing still.
  dax: { bulk: 1.0, pauldron: 0.055, helm: 'crest', belt: true, limb: 1.0, chestPlate: true },

  // Enormous. Horned helm, heavy plate, and a glaive that doubles his
  // outline — you should be able to tell you are outranged from across the
  // stage without reading a health bar.
  vorn: { bulk: 1.28, pauldron: 0.085, chestPlate: true, helm: 'horned', weapon: 'glaive', limb: 1.22 },

  // Lean and asymmetric: a hood, a visor, and one oversized arm apparatus.
  // The asymmetry is the tell for which side the projectile comes from.
  echo: { bulk: 0.90, helm: 'hood', weapon: 'gauntlet', visor: true, limb: 0.90, coat: 0.16 },
}

export function silhouetteFor(id: string): Silhouette {
  return { ...DEFAULT, ...(BY_ID[id] ?? {}) }
}
