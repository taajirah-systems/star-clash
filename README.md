# Star Clash: Concord vs. Verge

A 3D arena fighter prototype — Tekken-style framing, frame-data-driven combat,
and a deterministic simulation built for rollback netcode.

Four fighters, an arcade ladder against a CPU opponent, local versus, and
training mode — playable in a browser with no engine install. Original
characters; no licensed IP.

```bash
npm install
npm run dev        # http://localhost:5178
npm test           # 95 tests
npm run build      # typecheck + production bundle
```

---

## Controls

|            | Player 1              | Player 2                        |
| ---------- | --------------------- | ------------------------------- |
| Move       | `W` `A` `S` `D`       | Arrow keys                      |
| Light      | `J`                   | `;` *(or `Numpad1`)*            |
| Heavy      | `K`                   | `'` *(or `Numpad2`)*            |
| Special    | `L`                   | `[` *(or `Numpad3`)*            |
| Throw      | `U`                   | `]` *(or `Numpad4`)*            |
| Jump       | `I`                   | `/` *(or `Numpad5`)*            |
| Guard      | `H`                   | `.` *(or `Numpad6`)*            |

Player two has two bindings for every button. The numpad set is the arcade-style
layout for a full desktop keyboard; the punctuation set exists because laptops —
MacBooks included — have no numeric keypad, which previously left player two
with no way to attack at all.

Gamepads and arcade sticks are picked up automatically (pad 0 → P1, pad 1 → P2).
Sticks are quantised to a digital cross so a pad and a keyboard produce
byte-identical input frames — replays and netcode stay device-agnostic.

- **Left/Right** — approach and retreat. Double-tap to dash. Holding away guards.
- **Up/Down** — sidestep along the depth axis.
- **Down + Special** — the character's second signature move.
- **Guard + Special** — spend a full signature meter (except Echo-Nine, whose
  adaptation triggers itself).
- **`B`** *(or `F1`)* — draw the sim's live hitboxes and hurtboxes.
- **`N`** *(or `F2`)* — frame-time readout.
- **`M`** *(or `Tab`)* — cycle Versus / Arcade / Training.

The letter alternatives exist because on macOS the function row is media and
brightness control unless `Fn` is held, so an `F1`-only binding is no binding
at all for most laptop users.

## Modes

**Arcade** — one player against the CPU. The ladder runs every other fighter in
a seeded order and finishes with a mirror of your own character, always at
Elite. Difficulty ramps one tier across the run. Losing offers a ten-second
continue.

**Versus** — two players at one keyboard, or two pads.

**Training** — health and special regenerate, rounds never end.

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
  ai.ts            CPU opponent
src/data/          the roster and arenas, as pure data
src/game/          arcade ladder
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

**The CPU emits an InputFrame and nothing else.** It never writes to match
state, never calls into the sim, and never reads anything a player could not
see. Because its output goes down the same path as a pad, it is structurally
incapable of doing something a human could not — no cancelling out of recovery,
no reacting on the frame a hitbox spawns unless its reaction budget allows it.
It is deterministic too, so an arcade match replays like any other.

Camera framing is a pure function (`solveCameraFraming`) rather than something
that mutates a three.js camera in place. It is solved iteratively, because the
orbit angle, the distance, and the wall clearance all depend on each other —
placing the camera in one pass produced two separate bugs that only showed up
on screen. It now has its own regression tests over every position two fighters
can reach at six viewport shapes.

---

## What is and isn't here

**Working:** the full loop — character select → arena → combat → win/loss →
rematch, plus an arcade ladder with a CPU opponent at three difficulty tiers.
Six-axis movement with sidestep and dashes, frame-data hitboxes, combo cancels
with damage scaling, blocking by height, parries, throws with techs,
counter-hits, juggles, wall-splats, breakable scenery, all four meters and
bursts, projectiles, hitstop, round and match flow, training mode.

**Deliberately not here:**

- **Art and audio.** The fighters are shaded primitives posed from sim state.
  Rigged models, animation retargeting, phaser VFX, and music need an art
  pipeline or licensed assets; the render layer is separated from the sim so
  swapping them in touches only `src/render/`.
- **Netcode transport.** The rollback *machinery* is built and tested, but
  there is no matchmaking, socket layer, or frame-delay negotiation.
- **Two dead states.** `St.AirRecovery` and `St.ThrowConnected` are declared in
  the state machine but nothing transitions into them yet.
- **The performance and latency targets are unverified.** "60 FPS with zero
  drops under heavy particles" and "<16 ms input latency" cannot be measured
  against placeholder geometry and no particle budget. F2 shows real frame
  times; treat the targets as open until there are real assets on real
  target hardware.

Porting the core to Unity C# is mostly mechanical — it has no web dependencies,
and the fixed-point layer exists precisely so the arithmetic does not change
meaning when the host does.
