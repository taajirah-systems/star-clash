# Star Clash: Concord vs. Verge

A 3D arena fighter prototype — Tekken-style framing, frame-data-driven combat,
and a deterministic simulation built for rollback netcode.

Four fighters, local versus and training modes, playable in a browser with no
engine install. Original characters; no licensed IP.

```bash
npm install
npm run dev        # http://localhost:5178
npm test           # 67 tests
npm run build      # typecheck + production bundle
```

---

## Controls

|            | Player 1              | Player 2                |
| ---------- | --------------------- | ----------------------- |
| Move       | `W` `A` `S` `D`       | Arrow keys              |
| Light      | `J`                   | `Numpad1`               |
| Heavy      | `K`                   | `Numpad2`               |
| Special    | `L`                   | `Numpad3`               |
| Throw      | `U`                   | `Numpad4`               |
| Jump       | `I`                   | `Numpad5`               |
| Guard      | `H`                   | `Numpad6`               |

Gamepads and arcade sticks are picked up automatically (pad 0 → P1, pad 1 → P2).
Sticks are quantised to a digital cross so a pad and a keyboard produce
byte-identical input frames — replays and netcode stay device-agnostic.

- **Left/Right** — approach and retreat. Double-tap to dash. Holding away guards.
- **Up/Down** — sidestep along the depth axis.
- **Down + Special** — the character's second signature move.
- **Guard + Special** — spend a full signature meter (except Echo-Nine, whose
  adaptation triggers itself).
- **F1** — draw the sim's live hitboxes and hurtboxes. **F2** — frame-time readout.

---

## Roster

| Fighter | Archetype | Meter fills on | Burst |
| --- | --- | --- | --- |
| **Aurel Vance** — The Calculus | Precision / counter | Blocks and parries | Slows the opponent's animations to 2/3 speed for 5s |
| **Dax Corren** — The Vanguard | Rushdown / momentum | Landing hits, forward pressure | +25% speed, shorter recovery, 8s |
| **Vorn Kalash** — The Ironclad | Heavy brawler | Damage taken | Armour against light attacks, double heavy damage, 7s |
| **Echo-Nine** — The Reclaimed | Setplay / zone control | Blocking one damage kind | Total immunity to that kind for 6s, automatic |

Each has two signature moves (standing Special and Down+Special), a light, a
heavy, a crouching light, an air normal, and a throw. All of it is data in
`src/data/characters/` — startup, active, recovery, hitboxes, cancels, meter
gain. Editing a number there changes the game with no code change, and the F1
overlay shows the result immediately.

---

## Architecture

```
src/core/          the simulation — no three.js, no DOM, no floats
  fx.ts            Q16.16 fixed-point arithmetic
  input.ts         device abstraction → one 16-bit bitmask per frame
  fsm.ts           hierarchical state machine
  defs.ts          frame data, move and character types
  state.ts         match state, snapshot/restore, checksum
  collision.ts     facing-relative box transforms and overlap
  sim.ts           advanceFrame(state, inputs, config)
  rollback.ts      local and rollback sessions
src/data/          the roster and arenas, as pure data
src/render/        three.js: cel shading, rig, effects, camera
src/ui/            HUD and character select (DOM)
```

The load-bearing constraint is that **`advanceFrame` is a pure function of
(state, inputs)**. It reads no clock, calls no `Math.random`, and stores no
floating-point value. Three things follow:

- **Rollback is possible.** Re-simulating a frame lands on the same state a
  remote peer reached, so a late input can be corrected by rewinding and
  replaying. `RollbackSession` implements GGPO-style prediction; the tests
  assert it converges bit-for-bit with a session that never mispredicted.
- **The tests can be exact.** They assert on checksums, not tolerances.
- **Replays are free.** A match is its seed plus its input stream.

Fixed point is the price. Positions, velocities, and pushback are integers in
Q16.16, so `fxMul` and friends have to be right — an early overflow bug in
`fxMul` made `1.5 × 2 = 2.0`, which the fixed-point tests caught before it
reached the game.

Rendering interpolates between the two most recent simulated frames, so the
60 Hz sim looks smooth on a 144 Hz display. Input is polled immediately before
each tick rather than once per animation frame.

---

## What is and isn't here

**Working:** the full loop — character select → arena → combat → win/loss →
rematch. Six-axis movement with sidestep and dashes, frame-data hitboxes,
combo cancels with damage scaling, blocking by height, parries, throws with
techs, counter-hits, juggles, wall-splats, breakable scenery, all four meters
and bursts, projectiles, hitstop, round and match flow, training mode.

**Deliberately not here:**

- **Art and audio.** The fighters are shaded primitives posed from sim state.
  Rigged models, animation retargeting, phaser VFX, and music need an art
  pipeline or licensed assets; the render layer is separated from the sim so
  swapping them in touches only `src/render/`.
- **Netcode transport.** The rollback *machinery* is built and tested, but
  there is no matchmaking, socket layer, or frame-delay negotiation.
- **The performance and latency targets are unverified.** "60 FPS with zero
  drops under heavy particles" and "<16 ms input latency" cannot be measured
  against placeholder geometry and no particle budget. F2 shows real frame
  times; treat the targets as open until there are real assets on real
  target hardware.

Porting the core to Unity C# is mostly mechanical — it has no web dependencies,
and the fixed-point layer exists precisely so the arithmetic does not change
meaning when the host does.
