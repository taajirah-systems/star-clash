/**
 * Character select: a rotating 3D preview per fighter, stat charts, and the
 * two players' cursors on one grid.
 */

import * as THREE from 'three'
import { ROSTER, characterAt } from '../data/roster'
import { buildFighter, type FighterView } from '../render/fighter'
import { St } from '../core/fsm'
import { Btn, pressed, type InputFrame } from '../core/input'

const STAT_KEYS = ['power', 'speed', 'defense', 'range'] as const

export interface SelectResult {
  p1: number
  p2: number
}

export class CharacterSelect {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50)
  private readonly renderer: THREE.WebGLRenderer
  private readonly views: FighterView[] = []
  private readonly cards: HTMLElement[] = []
  private readonly statBars: HTMLElement[][] = []
  private cursor: [number, number] = [0, 1]
  private locked: [boolean, boolean] = [false, false]
  private prevInput: [InputFrame, InputFrame] = [0, 0]
  private spin = 0
  private done: ((r: SelectResult) => void) | null = null

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly root: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)

    this.scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x101828, 1.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.0)
    key.position.set(3, 6, 6)
    this.scene.add(key)

    // Previews are laid out on the same X spacing as the DOM cards below, so
    // the model always sits over its own card.
    ROSTER.forEach((def) => {
      const view = buildFighter(def)
      this.scene.add(view.group)
      this.views.push(view)
    })
    this.camera.position.set(0, 0.35, 6.4)
    this.camera.lookAt(0, 0.05, 0)
    this.layoutPreviews()

    this.buildDom()
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  private buildDom(): void {
    this.root.innerHTML = ''
    const grid = document.createElement('div')
    grid.className = 'select-grid'
    this.root.appendChild(grid)

    ROSTER.forEach((def) => {
      const card = document.createElement('div')
      card.className = 'select-card'
      card.style.setProperty('--accent', `#${def.accent.toString(16).padStart(6, '0')}`)
      card.style.setProperty('--base', `#${def.color.toString(16).padStart(6, '0')}`)

      const name = document.createElement('div')
      name.className = 'select-name'
      name.textContent = def.name
      const title = document.createElement('div')
      title.className = 'select-title'
      title.textContent = def.title
      const arch = document.createElement('div')
      arch.className = 'select-arch'
      arch.textContent = def.archetype

      const stats = document.createElement('div')
      stats.className = 'select-stats'
      const bars: HTMLElement[] = []
      for (const key of STAT_KEYS) {
        const row = document.createElement('div')
        row.className = 'stat-row'
        const label = document.createElement('span')
        label.className = 'stat-label'
        label.textContent = key.slice(0, 3).toUpperCase()
        const track = document.createElement('div')
        track.className = 'stat-track'
        const fill = document.createElement('div')
        fill.className = 'stat-fill'
        fill.style.width = `${(def.stats[key] / 10) * 100}%`
        track.appendChild(fill)
        row.append(label, track)
        stats.appendChild(row)
        bars.push(fill)
      }

      const tag = document.createElement('div')
      tag.className = 'select-cursors'

      card.append(name, title, arch, stats, tag)
      grid.appendChild(card)
      this.cards.push(card)
      this.statBars.push(bars)
    })

    const hint = document.createElement('div')
    hint.className = 'select-hint'
    hint.innerHTML =
      '<b>P1</b> A/D move · J confirm &nbsp;&nbsp; <b>P2</b> ←/→ move · Numpad1 confirm' +
      '<br><span class="dim">Both players confirm to begin. Pick the same fighter for a mirror match.</span>'
    this.root.appendChild(hint)
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || 380
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.layoutPreviews()
  }

  /**
   * Spaces the previews across whatever the camera can actually see, so each
   * model stays over its own card instead of drifting as the window resizes.
   */
  private layoutPreviews(): void {
    const dist = this.camera.position.z
    const visibleH = 2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)
    const visibleW = visibleH * this.camera.aspect
    const column = visibleW / ROSTER.length
    this.views.forEach((view, i) => {
      view.group.position.x = (i - (ROSTER.length - 1) / 2) * column
      view.group.position.y = -0.95
    })
    // Scale the models to the column so four of them never overlap on a
    // narrow window and never look lost on a wide one.
    this.previewScale = Math.min(1.05, Math.max(0.45, column / 2.6))
  }

  private previewScale = 0.82

  /** Resolves once both players have locked in. */
  waitForChoice(): Promise<SelectResult> {
    return new Promise((resolve) => {
      this.done = resolve
    })
  }

  update(inputs: readonly [InputFrame, InputFrame], dt: number): void {
    this.spin += dt

    for (let p = 0 as 0 | 1; p < 2; p = (p + 1) as 0 | 1) {
      const cur = inputs[p] ?? 0
      const prev = this.prevInput[p]
      if (!this.locked[p]) {
        if (pressed(cur, prev, Btn.Left)) {
          this.cursor[p] = (this.cursor[p] + ROSTER.length - 1) % ROSTER.length
        }
        if (pressed(cur, prev, Btn.Right)) {
          this.cursor[p] = (this.cursor[p] + 1) % ROSTER.length
        }
        if (pressed(cur, prev, Btn.Light) || pressed(cur, prev, Btn.Heavy)) {
          this.locked[p] = true
        }
      } else if (pressed(cur, prev, Btn.Guard) || pressed(cur, prev, Btn.Throw)) {
        this.locked[p] = false
      }
      this.prevInput[p] = cur
    }

    this.cards.forEach((card, i) => {
      const p1Here = this.cursor[0] === i
      const p2Here = this.cursor[1] === i
      card.classList.toggle('p1', p1Here)
      card.classList.toggle('p2', p2Here)
      card.classList.toggle('locked', (p1Here && this.locked[0]) || (p2Here && this.locked[1]))
      const tag = card.querySelector('.select-cursors')
      if (tag) {
        const marks: string[] = []
        if (p1Here) marks.push(this.locked[0] ? 'P1 ✔' : 'P1')
        if (p2Here) marks.push(this.locked[1] ? 'P2 ✔' : 'P2')
        tag.textContent = marks.join('  ')
      }
    })

    this.views.forEach((view, i) => {
      const selected = this.cursor[0] === i || this.cursor[1] === i
      // The highlighted fighter turns to face the player; the rest idle away.
      view.group.rotation.y = selected
        ? Math.sin(this.spin * 1.1) * 0.5
        : Math.PI * 0.32 + Math.sin(this.spin * 0.4 + i) * 0.12
      view.group.position.y = selected ? -0.85 + Math.sin(this.spin * 2.2) * 0.03 : -0.95
      void i
      view.setPose(selected ? St.Idle : St.GuardStand, this.spin * 60, null, 0, false, false)
      view.group.scale.setScalar(this.previewScale * (selected ? 1.12 : 0.95))
    })

    this.renderer.render(this.scene, this.camera)

    if (this.locked[0] && this.locked[1] && this.done) {
      const resolve = this.done
      this.done = null
      resolve({ p1: this.cursor[0], p2: this.cursor[1] })
    }
  }

  reset(): void {
    this.locked = [false, false]
    this.prevInput = [0, 0]
  }

  dispose(): void {
    for (const v of this.views) v.dispose()
    this.renderer.dispose()
    void characterAt
  }
}
