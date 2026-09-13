/**
 * Match HUD.
 *
 * Built from DOM rather than drawn into the canvas: text stays crisp at any
 * DPI, the layout is a flexbox instead of hand-computed pixel maths, and it
 * costs the WebGL context nothing.
 */

import { Phase, type MatchState } from '../core/state'
import { characterAt } from '../data/roster'
import type { CharacterDef } from '../core/defs'

const METER_LABEL: Record<string, string> = {
  guard: 'CALCULUS',
  offense: 'COMMAND',
  punished: 'RAGE',
  adaptive: 'ADAPTATION',
}

interface Side {
  root: HTMLElement
  health: HTMLElement
  healthTrail: HTMLElement
  meter: HTMLElement
  meterLabel: HTMLElement
  special: HTMLElement
  status: HTMLElement
  combo: HTMLElement
  pips: HTMLElement
}

function el(tag: string, cls: string, parent?: HTMLElement): HTMLElement {
  const node = document.createElement(tag)
  node.className = cls
  parent?.appendChild(node)
  return node
}

function buildSide(parent: HTMLElement, def: CharacterDef, mirrored: boolean): Side {
  const root = el('div', `hud-side ${mirrored ? 'mirror' : ''}`, parent)

  const head = el('div', 'hud-head', root)
  const name = el('div', 'hud-name', head)
  name.textContent = def.name
  const title = el('div', 'hud-title', head)
  title.textContent = def.title
  const pips = el('div', 'hud-pips', head)

  const healthWrap = el('div', 'bar health-wrap', root)
  const healthTrail = el('div', 'bar-fill trail', healthWrap)
  const health = el('div', 'bar-fill health', healthWrap)
  health.style.background = `linear-gradient(90deg, #${def.color.toString(16).padStart(6, '0')}, #${def.accent.toString(16).padStart(6, '0')})`

  const meterWrap = el('div', 'bar meter-wrap', root)
  const meter = el('div', 'bar-fill meter', meterWrap)
  const meterLabel = el('div', 'bar-label', meterWrap)
  meterLabel.textContent = METER_LABEL[def.meterRule.kind] ?? 'METER'

  const specialWrap = el('div', 'bar special-wrap', root)
  const special = el('div', 'bar-fill special', specialWrap)
  const specialLabel = el('div', 'bar-label', specialWrap)
  specialLabel.textContent = 'SP'

  const status = el('div', 'hud-status', root)
  const combo = el('div', 'hud-combo', root)

  return { root, health, healthTrail, meter, meterLabel, special, status, combo, pips }
}

export class Hud {
  private readonly sides: Side[]
  private readonly timer: HTMLElement
  private readonly banner: HTMLElement
  /** Health the trail bar is easing toward, so a big hit reads as a big hit. */
  private readonly trailValue: number[] = [1, 1]

  constructor(root: HTMLElement, charIndices: readonly number[]) {
    root.innerHTML = ''
    const top = el('div', 'hud-top', root)
    this.sides = [
      buildSide(top, characterAt(charIndices[0] ?? 0).def, false),
      buildSide(top, characterAt(charIndices[1] ?? 1).def, true),
    ]
    const centre = el('div', 'hud-centre', top)
    this.timer = el('div', 'hud-timer', centre)
    this.banner = el('div', 'hud-banner', root)
    // The centre column is inserted after both sides, so put it back between.
    top.insertBefore(centre, this.sides[1]!.root)
  }

  update(state: MatchState, roundsToWin: number): void {
    state.fighters.forEach((f, i) => {
      const side = this.sides[i]
      if (!side) return
      const def = characterAt(f.charIndex).def
      const hp = Math.max(0, f.health) / def.health
      side.health.style.width = `${hp * 100}%`

      // The trail lags the real bar, then catches up.
      const t = this.trailValue[i] ?? 1
      this.trailValue[i] = hp < t ? Math.max(hp, t - 0.008) : hp
      side.healthTrail.style.width = `${(this.trailValue[i] ?? hp) * 100}%`

      side.meter.style.width = `${Math.min(1, f.meter / def.meterMax) * 100}%`
      side.meter.classList.toggle('full', f.meter >= def.meterMax)
      side.special.style.width = `${Math.min(1, f.special / def.specialMax) * 100}%`

      const parts: string[] = []
      if (f.payloadFrames > 0) parts.push(`${METER_LABEL[def.meterRule.kind] ?? 'BURST'} ACTIVE`)
      if (f.shieldFrames > 0) parts.push(f.shieldKind === 1 ? 'ENERGY IMMUNE' : 'PHYSICAL IMMUNE')
      if (f.dilatedFrames > 0) parts.push('SLOWED')
      if (f.meter >= def.meterMax && f.payloadFrames === 0 && def.meterRule.kind !== 'adaptive') {
        parts.push('GUARD + SPECIAL READY')
      }
      side.status.textContent = parts.join('  ·  ')

      const opponentCombo = state.fighters[i === 0 ? 1 : 0]?.comboCount ?? 0
      side.combo.textContent = opponentCombo >= 2 ? `${opponentCombo} HIT` : ''
      side.combo.classList.toggle('visible', opponentCombo >= 2)

      const won = state.roundsWon[i] ?? 0
      if (side.pips.childElementCount !== roundsToWin) {
        side.pips.innerHTML = ''
        for (let p = 0; p < roundsToWin; p++) el('span', 'pip', side.pips)
      }
      Array.from(side.pips.children).forEach((pip, p) => {
        pip.classList.toggle('on', p < won)
      })
    })

    this.timer.textContent = String(Math.ceil(state.roundTimerFrames / 60)).padStart(2, '0')

    let banner = ''
    switch (state.phase) {
      case Phase.Intro:
        banner = state.phaseFrame > 60 ? 'FIGHT' : `ROUND ${state.round}`
        break
      case Phase.KO:
        banner = 'K.O.'
        break
      case Phase.RoundEnd:
        banner = ''
        break
      case Phase.MatchEnd:
        // The result overlay owns this message; printing it here too shows it
        // twice, once blurred behind the overlay.
        banner = ''
        break
      default:
        banner = ''
    }
    this.banner.textContent = banner
    this.banner.classList.toggle('visible', banner !== '')
  }
}
