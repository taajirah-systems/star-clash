/**
 * Hierarchical finite state machine for fighters.
 *
 * The hierarchy is expressed as a parent table rather than as nested objects.
 * A leaf state inherits every property of its ancestors unless it overrides
 * them, so "does gravity apply here?" is answered once on `Airborne` instead of
 * being restated on each of its five children — and adding a sixth child later
 * cannot forget to answer it.
 */

export const enum St {
  Root,

  Grounded,
  Idle,
  WalkForward,
  WalkBack,
  SidestepLeft,
  SidestepRight,
  Crouch,
  DashForward,
  DashBack,
  GuardStand,
  GuardCrouch,
  Parry,
  AttackGround,
  ThrowStartup,
  ThrowConnected,
  MeterBurst,

  Airborne,
  JumpRise,
  JumpFall,
  AttackAir,
  AirRecovery,

  Reeling,
  HitStun,
  BlockStun,
  Stagger,
  Juggle,
  Knockdown,
  Wakeup,
  Paralyzed,

  Defeated,

  _Count,
}

export const enum SF {
  None = 0,
  /** May begin a new action this frame. */
  Actionable = 1 << 0,
  /** Gravity and ground contact are integrated. */
  Gravity = 1 << 1,
  Grounded = 1 << 2,
  Airborne = 1 << 3,
  /** Incoming attacks of a matching height are blocked. */
  Guarding = 1 << 4,
  /** In stun; input is ignored except for tech and recovery. */
  Reeling = 1 << 5,
  /** Cannot be hit at all. */
  Invulnerable = 1 << 6,
  /** Uses the shorter crouching hurtbox and ducks highs. */
  Crouching = 1 << 7,
  /** Running a MoveDef timeline. */
  Attacking = 1 << 8,
  /** A grab can connect. */
  Grabbable = 1 << 9,
  /** Walks or dashes translate the fighter this frame. */
  Mobile = 1 << 10,
  /** Counts as airborne for juggle purposes. */
  Juggleable = 1 << 11,
}

interface Node {
  parent: St
  /** Flags added at this level. */
  add: SF
  /** Flags stripped from the inherited set at this level. */
  remove: SF
  name: string
}

const N: Node[] = new Array(St._Count)

function def(s: St, parent: St, name: string, add: SF = SF.None, remove: SF = SF.None): void {
  N[s] = { parent, add, remove, name }
}

def(St.Root, St.Root, 'Root', SF.Grabbable)

def(St.Grounded, St.Root, 'Grounded', SF.Grounded | SF.Actionable)
def(St.Idle, St.Grounded, 'Idle')
def(St.WalkForward, St.Grounded, 'WalkForward', SF.Mobile)
def(St.WalkBack, St.Grounded, 'WalkBack', SF.Mobile)
def(St.SidestepLeft, St.Grounded, 'SidestepLeft', SF.Mobile)
def(St.SidestepRight, St.Grounded, 'SidestepRight', SF.Mobile)
def(St.Crouch, St.Grounded, 'Crouch', SF.Crouching)
def(St.DashForward, St.Grounded, 'DashForward', SF.Mobile, SF.Actionable)
def(St.DashBack, St.Grounded, 'DashBack', SF.Mobile | SF.Invulnerable, SF.Actionable)
def(St.GuardStand, St.Grounded, 'GuardStand', SF.Guarding)
def(St.GuardCrouch, St.Grounded, 'GuardCrouch', SF.Guarding | SF.Crouching)
def(St.Parry, St.Grounded, 'Parry', SF.Guarding, SF.Actionable)
def(St.AttackGround, St.Grounded, 'AttackGround', SF.Attacking, SF.Actionable)
def(St.ThrowStartup, St.Grounded, 'ThrowStartup', SF.Attacking, SF.Actionable)
def(St.ThrowConnected, St.Grounded, 'ThrowConnected', SF.Attacking | SF.Invulnerable, SF.Actionable)
def(St.MeterBurst, St.Grounded, 'MeterBurst', SF.Invulnerable, SF.Actionable | SF.Grabbable)

def(St.Airborne, St.Root, 'Airborne', SF.Airborne | SF.Gravity | SF.Juggleable, SF.Grabbable)
def(St.JumpRise, St.Airborne, 'JumpRise')
def(St.JumpFall, St.Airborne, 'JumpFall')
def(St.AttackAir, St.Airborne, 'AttackAir', SF.Attacking)
def(St.AirRecovery, St.Airborne, 'AirRecovery', SF.Invulnerable)

def(St.Reeling, St.Root, 'Reeling', SF.Reeling, SF.Actionable)
def(St.HitStun, St.Reeling, 'HitStun', SF.Grounded)
def(St.BlockStun, St.Reeling, 'BlockStun', SF.Grounded | SF.Guarding)
def(St.Stagger, St.Reeling, 'Stagger', SF.Grounded)
def(St.Juggle, St.Reeling, 'Juggle', SF.Airborne | SF.Gravity | SF.Juggleable, SF.Grabbable)
def(St.Knockdown, St.Reeling, 'Knockdown', SF.Grounded | SF.Invulnerable, SF.Grabbable)
def(St.Wakeup, St.Reeling, 'Wakeup', SF.Grounded | SF.Invulnerable, SF.Grabbable)
def(St.Paralyzed, St.Reeling, 'Paralyzed', SF.Grounded)

def(St.Defeated, St.Root, 'Defeated', SF.Invulnerable, SF.Actionable | SF.Grabbable)

/** Flags resolved through the ancestor chain, computed once at module load. */
const RESOLVED: SF[] = new Array(St._Count)

function resolve(s: St): SF {
  const node = N[s]
  if (!node) return SF.None
  const inherited = s === St.Root ? SF.None : resolve(node.parent)
  return ((inherited | node.add) & ~node.remove) as SF
}

for (let s = 0 as St; s < St._Count; s++) {
  RESOLVED[s] = resolve(s)
}

export function flags(s: St): SF {
  return RESOLVED[s] ?? SF.None
}

export function has(s: St, f: SF): boolean {
  return (flags(s) & f) !== 0
}

/** True when `s` is `ancestor` or sits underneath it in the hierarchy. */
export function isIn(s: St, ancestor: St): boolean {
  let cur = s
  for (let guard = 0; guard < 16; guard++) {
    if (cur === ancestor) return true
    const node = N[cur]
    if (!node || cur === St.Root) return false
    cur = node.parent
  }
  return false
}

export function stateName(s: St): string {
  return N[s]?.name ?? `St(${s})`
}
